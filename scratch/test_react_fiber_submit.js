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

  // Inspect React Fiber on the modal form & button
  const fiberInspect = await send('Runtime.evaluate', {
    expression: `(() => {
      const modal = document.querySelector('div.fixed.inset-0');
      const form = modal.querySelector('form');
      const button = modal.querySelector('button[type="submit"]');

      // Find fiber
      const formKey = Object.keys(form).find(k => k.startsWith('__reactFiber'));
      const formPropsKey = Object.keys(form).find(k => k.startsWith('__reactProps'));
      const btnPropsKey = Object.keys(button).find(k => k.startsWith('__reactProps'));

      const formProps = formPropsKey ? form[formPropsKey] : null;
      const btnProps = btnPropsKey ? button[btnPropsKey] : null;

      return {
        formPropsKeys: formProps ? Object.keys(formProps) : [],
        hasOnSubmit: Boolean(formProps?.onSubmit),
        formPropsMethod: formProps?.method,
        btnPropsKeys: btnProps ? Object.keys(btnProps) : [],
        btnType: button.type
      };
    })()`,
    returnByValue: true
  });
  console.log('React Fiber Inspection:', fiberInspect.result?.value);

  // Now intercept window.addEventListener to see what happens when we prevent native navigation on submit
  await send('Runtime.evaluate', {
    expression: `(() => {
      const modal = document.querySelector('div.fixed.inset-0');
      const form = modal.querySelector('form');
      
      // Let's prevent default on the modal form's native submit to see if React handler runs!
      form.addEventListener('submit', (e) => {
        console.log('[Native modal form submit listener firing, preventDefault called]');
        e.preventDefault();
      });
    })()`
  });

  // Now click Update Location
  console.log('Clicking Update Location with native preventDefault in place...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const modal = document.querySelector('div.fixed.inset-0');
      const button = modal.querySelector('button[type="submit"]');
      button.click();
    })()`
  });

  await new Promise(r => setTimeout(r, 3000));

  chrome.kill();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
