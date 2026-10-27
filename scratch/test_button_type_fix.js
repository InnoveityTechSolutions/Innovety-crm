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
  const netEvents = [];

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
    if (msg.method === 'Console.messageAdded') {
      console.log('[BROWSER CONSOLE]', msg.params.message.text);
    }
    if (msg.method === 'Network.requestWillBeSent') {
      const req = msg.params.request;
      if (req.url.includes('/api/attendance-locations')) {
        netEvents.push({ type: 'REQ', method: req.method, url: req.url, postData: req.postData });
        console.log(`[NET REQ] ${req.method} ${req.url} | ${req.postData || ''}`);
      }
    }
    if (msg.method === 'Network.responseReceived') {
      const res = msg.params.response;
      if (res.url.includes('/api/attendance-locations')) {
        netEvents.push({ type: 'RES', status: res.status, url: res.url });
        console.log(`[NET RES] ${res.status} ${res.url}`);
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

  // ==========================================
  // TEST: Edit Location with fixed button / form event
  // ==========================================
  console.log('\n--- Opening Edit Modal ---');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const editBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Edit');
      if (editBtn) editBtn.click();
    })()`
  });
  await new Promise(r => setTimeout(r, 1000));

  // Inspect radius value before change
  const beforeState = await send('Runtime.evaluate', {
    expression: `(() => {
      const modal = document.querySelector('div.fixed.inset-0');
      const radiusInput = modal.querySelector('input[type="number"][min="10"]');
      return { radiusBefore: radiusInput.value };
    })()`,
    returnByValue: true
  });
  console.log('Edit Modal before:', beforeState.result?.value);

  // Change radius to 300m
  console.log('Changing radius to 300m...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const modal = document.querySelector('div.fixed.inset-0');
      const radiusInput = modal.querySelector('input[type="number"][min="10"]');
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(radiusInput, '300');
      radiusInput.dispatchEvent(new Event('input', { bubbles: true }));
      radiusInput.dispatchEvent(new Event('change', { bubbles: true }));
    })()`
  });
  await new Promise(r => setTimeout(r, 500));

  // Prevent default on modal form native submit (simulating fix)
  await send('Runtime.evaluate', {
    expression: `(() => {
      const modal = document.querySelector('div.fixed.inset-0');
      const form = modal.querySelector('form');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
      });
    })()`
  });

  // Click Update Location button
  console.log('Clicking Update Location button...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const modal = document.querySelector('div.fixed.inset-0');
      const submitBtn = modal.querySelector('button[type="submit"]');
      submitBtn.click();
    })()`
  });

  await new Promise(r => setTimeout(r, 3000));

  // Check DOM for 300m
  const afterState = await send('Runtime.evaluate', {
    expression: `(() => {
      const text = document.body.innerText;
      return {
        modalStillOpen: Boolean(document.querySelector('div.fixed.inset-0')),
        has300m: text.includes('300m') || text.includes('300 m'),
        has250m: text.includes('250m') || text.includes('250 m')
      };
    })()`,
    returnByValue: true
  });
  console.log('After Update Location click:', afterState.result?.value);

  // Restore 250m in DB for clean test state
  const resetRes = await send('Runtime.evaluate', {
    expression: `(async () => {
      const token = localStorage.getItem('token');
      const locs = await (await fetch('http://localhost:5000/api/attendance-locations', {
        headers: { Authorization: 'Bearer ' + token }
      })).json();
      const loc = locs.locations && locs.locations[0];
      if (loc) {
        await fetch('http://localhost:5000/api/attendance-locations/' + loc.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ radiusMeters: 250 })
        });
      }
    })()`,
    awaitPromise: true
  });

  chrome.kill();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
