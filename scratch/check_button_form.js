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
      console.log('[CONSOLE]', msg.params.message.text);
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

  // Inspect the DOM elements and form property of the submit button
  const buttonInspection = await send('Runtime.evaluate', {
    expression: `(() => {
      const modal = document.querySelector('div.fixed.inset-0');
      const submitBtn = modal.querySelector('button[type="submit"]');
      const outerForm = document.querySelector('form.space-y-6');
      const modalForm = modal.querySelector('form');
      
      return {
        buttonExists: Boolean(submitBtn),
        buttonFormIsOuterForm: submitBtn.form === outerForm,
        buttonFormIsModalForm: submitBtn.form === modalForm,
        buttonFormId: submitBtn.form ? submitBtn.form.className : null,
        outerFormAction: outerForm?.action,
        outerFormMethod: outerForm?.method,
        modalFormAction: modalForm?.action,
        modalFormMethod: modalForm?.method
      };
    })()`,
    returnByValue: true
  });
  console.log('Button & Form inspection:', JSON.stringify(buttonInspection.result?.value, null, 2));

  chrome.kill();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
