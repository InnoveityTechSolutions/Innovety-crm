const { spawn } = require('child_process');
const axios = require('../backend/node_modules/axios');

async function test() {
  const loginRes = await axios.post('http://localhost:5000/api/auth/login', {
    userId: 'superadmin@enterprise-crm.com',
    password: 'Admin123!'
  });
  const token = loginRes.data.token;
  const user = loginRes.data.user;

  const chromeProc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--remote-debugging-port=9236', '--disable-gpu', '--no-first-run', 'about:blank'
  ]);
  await new Promise(r => setTimeout(r, 1500));
  const res = await fetch('http://localhost:9236/json');
  const targets = await res.json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 1;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const curId = id++;
    const h = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === curId) { ws.removeEventListener('message', h); resolve(m.result); }
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: curId, method, params }));
  });
  const evaluate = (expr) => send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(r => r?.result?.value);
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:5173' });
  await new Promise(r => setTimeout(r, 1000));
  await evaluate(`
    localStorage.setItem('token', ${JSON.stringify(token)});
    localStorage.setItem('user', JSON.stringify(${JSON.stringify(user)}));
    localStorage.setItem('mrf_selected_company_id', 'cmu43zvwm0000exne7d53m25e');
  `);
  await send('Page.navigate', { url: 'http://localhost:5173/company-documents' });
  await new Promise(r => setTimeout(r, 2000));

  const initial = await evaluate(`
    (() => {
      const select = document.querySelector('#global-company-scope-selector');
      const docs = Array.from(document.querySelectorAll('tbody tr td:first-child')).map(td => td.innerText.trim());
      return { val: select?.value, docs };
    })()
  `);
  console.log('1. Initial (Company A):', initial);

  // Switch to Company B using native descriptor setter
  await evaluate(`
    (() => {
      const select = document.querySelector('#global-company-scope-selector');
      const proto = Object.getPrototypeOf(select);
      const set = Object.getOwnPropertyDescriptor(proto, 'value').set;
      set.call(select, 'cmu5e48x30001bv4bpytsye40');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()
  `);
  await new Promise(r => setTimeout(r, 1500));

  const afterB = await evaluate(`
    (() => {
      const select = document.querySelector('#global-company-scope-selector');
      const docs = Array.from(document.querySelectorAll('tbody tr td:first-child')).map(td => td.innerText.trim());
      return { val: select?.value, docs };
    })()
  `);
  console.log('2. After switch to B:', afterB);

  // Switch back to Company A using native descriptor setter
  await evaluate(`
    (() => {
      const select = document.querySelector('#global-company-scope-selector');
      const proto = Object.getPrototypeOf(select);
      const set = Object.getOwnPropertyDescriptor(proto, 'value').set;
      set.call(select, 'cmu43zvwm0000exne7d53m25e');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()
  `);
  await new Promise(r => setTimeout(r, 1500));

  const afterA = await evaluate(`
    (() => {
      const select = document.querySelector('#global-company-scope-selector');
      const docs = Array.from(document.querySelectorAll('tbody tr td:first-child')).map(td => td.innerText.trim());
      return { val: select?.value, docs };
    })()
  `);
  console.log('3. After switch back to A:', afterA);

  ws.close();
  chromeProc.kill();
}
test().catch(console.error);
