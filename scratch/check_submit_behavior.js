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
  let navigations = [];

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
    if (msg.method === 'Page.frameNavigated') {
      navigations.push(msg.params.frame.url);
      console.log('[PAGE NAVIGATED]', msg.params.frame.url);
    }
    if (msg.method === 'Network.requestWillBeSent') {
      const req = msg.params.request;
      console.log(`[REQ] ${req.method} ${req.url}`);
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

  // Open login and authenticate
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

  // Navigate to settings
  await send('Page.navigate', { url: 'http://localhost:5173/settings' });
  await new Promise(r => setTimeout(r, 2500));

  // Inspect the DOM: how many forms are there, and is modal form inside SiteSettings form?
  const formHierarchy = await send('Runtime.evaluate', {
    expression: `(() => {
      const allForms = Array.from(document.querySelectorAll('form'));
      // Open modal first
      const editBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Edit');
      if (editBtn) editBtn.click();
      return {
        formCountBefore: allForms.length
      };
    })()`,
    returnByValue: true
  });
  console.log('Form count before:', formHierarchy.result?.value);
  await new Promise(r => setTimeout(r, 800));

  // Inspect form hierarchy while modal is open
  const formHierarchyOpen = await send('Runtime.evaluate', {
    expression: `(() => {
      const allForms = Array.from(document.querySelectorAll('form'));
      const outerForm = document.querySelector('form.space-y-6');
      const modalForm = document.querySelector('div.fixed.inset-0 form');
      const isModalInsideOuter = outerForm && modalForm ? outerForm.contains(modalForm) : null;
      
      return {
        totalForms: allForms.length,
        isModalInsideOuter,
        outerFormTag: outerForm?.tagName,
        modalFormTag: modalForm?.tagName,
        modalButtons: Array.from(document.querySelectorAll('div.fixed.inset-0 button')).map(b => ({
          text: b.innerText,
          type: b.type
        }))
      };
    })()`,
    returnByValue: true
  });
  console.log('Form hierarchy with modal open:', JSON.stringify(formHierarchyOpen.result?.value, null, 2));

  // Add event listener to trace submit on window, document, outerForm, and modalForm
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.__submitEvents = [];
      const outerForm = document.querySelector('form.space-y-6');
      const modalForm = document.querySelector('div.fixed.inset-0 form');
      
      window.addEventListener('submit', (e) => {
        window.__submitEvents.push({
          target: e.target?.tagName,
          defaultPrevented: e.defaultPrevented,
          targetClass: e.target?.className
        });
      }, true);

      if (outerForm) {
        outerForm.addEventListener('submit', (e) => {
          window.__submitEvents.push({
            listener: 'outerForm',
            defaultPrevented: e.defaultPrevented
          });
        });
      }

      if (modalForm) {
        modalForm.addEventListener('submit', (e) => {
          window.__submitEvents.push({
            listener: 'modalForm',
            defaultPrevented: e.defaultPrevented
          });
        });
      }
    })()`
  });

  // Now click the submit button
  console.log('Clicking Update Location button in modal...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const modal = document.querySelector('div.fixed.inset-0');
      const updateBtn = Array.from(modal.querySelectorAll('button')).find(b => b.innerText.includes('Update Location'));
      if (updateBtn) updateBtn.click();
    })()`
  });

  await new Promise(r => setTimeout(r, 2000));

  const submitTrace = await send('Runtime.evaluate', {
    expression: 'window.__submitEvents',
    returnByValue: true
  });
  console.log('Submit trace:', submitTrace.result?.value);
  console.log('Navigations recorded:', navigations);

  chrome.kill();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
