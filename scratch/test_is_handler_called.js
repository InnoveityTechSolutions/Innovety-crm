const { spawn } = require('child_process');
const http = require('http');

async function main() {
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--disable-gpu',
    '--window-size=1440,900',
    'about:blank'
  ]);

  await new Promise(r => setTimeout(r, 1500));

  const list = await new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);

  let msgId = 1;
  const pending = new Map();

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
    if (msg.method === 'Console.messageAdded') {
      console.log('[BROWSER]', msg.params.message.text);
    }
    if (msg.method === 'Network.requestWillBeSent') {
      const req = msg.params.request;
      if (req.url.includes('/api/attendance-locations')) {
        console.log(`[NET REQ] ${req.method} ${req.url} | ${req.postData || ''}`);
      }
    }
  };

  const send = (method, params = {}) => {
    const id = msgId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  await new Promise(r => ws.onopen = r);
  await send('Page.enable');
  await send('Network.enable');
  await send('Runtime.enable');
  await send('Console.enable');

  await send('Page.navigate', { url: 'http://localhost:5173/login' });
  await new Promise(r => setTimeout(r, 1000));

  await send('Runtime.evaluate', {
    expression: `(async () => {
      const res = await fetch('http://localhost:5000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@enterprise-crm.com', password: 'password123' })
      });
      const data = await res.json();
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
    })()`,
    awaitPromise: true
  });

  await send('Page.navigate', { url: 'http://localhost:5173/settings' });
  await new Promise(r => setTimeout(r, 2500));

  // Open Edit modal
  await send('Runtime.evaluate', {
    expression: `(() => {
      const editBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Edit');
      if (editBtn) editBtn.click();
    })()`
  });
  await new Promise(r => setTimeout(r, 1000));

  // Test what happens when we call the React onSubmit directly vs clicking the button
  const callResult = await send('Runtime.evaluate', {
    expression: `(() => {
      const modal = document.querySelector('div.fixed.inset-0');
      const form = modal.querySelector('form');
      const formPropsKey = Object.keys(form).find(k => k.startsWith('__reactProps'));
      const onSubmit = form[formPropsKey]?.onSubmit;

      console.log('Testing direct invocation of onSubmit: type is ' + typeof onSubmit);
      let prevented = false;
      const fakeEvent = {
        preventDefault: () => { prevented = true; console.log('[fakeEvent.preventDefault CALLED]'); },
        stopPropagation: () => { console.log('[fakeEvent.stopPropagation CALLED]'); }
      };

      try {
        onSubmit(fakeEvent);
        return { called: true, prevented };
      } catch (err) {
        return { called: false, error: err.message, stack: err.stack };
      }
    })()`,
    returnByValue: true
  });
  console.log('Direct onSubmit result:', JSON.stringify(callResult.result?.value, null, 2));

  await new Promise(r => setTimeout(r, 2000));

  chrome.kill();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
