const { spawn } = require('child_process');
const http = require('http');

async function main() {
  console.log('Spawning Chrome with remote debugging on 9222...');
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
  const networkLogs = [];
  const consoleLogs = [];

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
    if (msg.method === 'Console.messageAdded') {
      const txt = msg.params.message.text;
      consoleLogs.push(txt);
      console.log('[BROWSER CONSOLE]', txt);
    }
    if (msg.method === 'Network.requestWillBeSent') {
      const req = msg.params.request;
      if (req.url.includes('/api/attendance-locations')) {
        const item = { method: req.method, url: req.url, postData: req.postData };
        networkLogs.push(item);
        console.log(`[NETWORK REQ] ${req.method} ${req.url}`, req.postData ? `| Payload: ${req.postData}` : '');
      }
    }
    if (msg.method === 'Network.responseReceived') {
      const res = msg.params.response;
      if (res.url.includes('/api/attendance-locations')) {
        console.log(`[NETWORK RES] ${res.status} ${res.url}`);
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
  await send('Console.enable');
  await send('Log.enable');
  await send('Runtime.enable');

  console.log('Navigating to http://localhost:5173/login ...');
  await send('Page.navigate', { url: 'http://localhost:5173/login' });
  await new Promise(r => setTimeout(r, 1200));

  console.log('Logging in via API (Admin)...');
  const loginRes = await send('Runtime.evaluate', {
    expression: `(async () => {
      const res = await fetch('http://localhost:5000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@enterprise-crm.com', password: 'password123' })
      });
      const data = await res.json();
      if (data.token) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        return { success: true, user: data.user };
      }
      return { success: false, data };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  console.log('Login result:', loginRes.result?.value);

  console.log('Navigating to http://localhost:5173/settings ...');
  await send('Page.navigate', { url: 'http://localhost:5173/settings' });
  await new Promise(r => setTimeout(r, 3000));

  // Inspect page
  const pageState = await send('Runtime.evaluate', {
    expression: `(() => {
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4')).map(h => h.innerText);
      const buttons = Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim());
      return { headings, buttons: buttons.filter(b => b.length > 0) };
    })()`,
    returnByValue: true
  });
  console.log('Buttons on settings page:', pageState.result?.value?.buttons?.filter(b => b.includes('Location') || b.includes('Add') || b.includes('Save') || b.includes('Edit')));

  // ==========================================
  // REPRODUCE OPERATION 1: Add New Location
  // ==========================================
  console.log('\n==========================================');
  console.log('TESTING OPERATION 1: Add Attendance Location');
  console.log('==========================================');

  // Click "+ Add Location" button
  const openModalRes = await send('Runtime.evaluate', {
    expression: `(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Add Location') || b.innerText.includes('New Location'));
      if (btn) {
        btn.click();
        return { clicked: true, text: btn.innerText };
      }
      return { clicked: false };
    })()`,
    returnByValue: true
  });
  console.log('Clicked Add Location button:', openModalRes.result?.value);
  await new Promise(r => setTimeout(r, 1000));

  // Check modal contents
  const modalState1 = await send('Runtime.evaluate', {
    expression: `(() => {
      const modal = document.querySelector('div.fixed.inset-0 form');
      if (!modal) return { hasModal: false };
      const nameInput = modal.querySelector('input[placeholder*="MRF Innovation Park" i], input[type="text"]');
      const customRadiusInput = modal.querySelector('input[type="number"][min="10"]');
      const submitBtn = modal.querySelector('button[type="submit"]');
      return {
        hasModal: true,
        nameValue: nameInput ? nameInput.value : null,
        radiusValue: customRadiusInput ? customRadiusInput.value : null,
        submitBtnText: submitBtn ? submitBtn.innerText : null
      };
    })()`,
    returnByValue: true
  });
  console.log('Add Modal State:', modalState1.result?.value);

  // Type a name if empty: "MCC MRF Testing Park"
  console.log('Setting location name to "MCC MRF Testing Park"...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const modal = document.querySelector('div.fixed.inset-0 form');
      const nameInput = modal.querySelector('input[placeholder*="MRF Innovation Park" i], input[type="text"]');
      if (nameInput) {
        // Use native setter for React input
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(nameInput, 'MCC MRF Testing Park');
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        nameInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`
  });
  await new Promise(r => setTimeout(r, 500));

  // Now click "Save Location"
  console.log('Clicking "Save Location" button...');
  const clickSaveRes = await send('Runtime.evaluate', {
    expression: `(() => {
      const modal = document.querySelector('div.fixed.inset-0 form');
      const submitBtn = modal ? modal.querySelector('button[type="submit"]') : null;
      if (submitBtn) {
        submitBtn.click();
        return { clicked: true, text: submitBtn.innerText };
      }
      return { clicked: false };
    })()`,
    returnByValue: true
  });
  console.log('Click Save Location result:', clickSaveRes.result?.value);
  await new Promise(r => setTimeout(r, 3000));

  // Check outcome of Add Location
  const addOutcome = await send('Runtime.evaluate', {
    expression: `(() => {
      const modalStillOpen = Boolean(document.querySelector('div.fixed.inset-0 form'));
      const errorDiv = document.querySelector('.bg-rose-500\\\\/10, [class*="rose"], [class*="error" i]');
      const alertDiv = document.querySelector('[class*="alert" i], [class*="toast" i]');
      const cardsText = document.body.innerText;
      return {
        modalStillOpen,
        errorMessage: errorDiv ? errorDiv.innerText : null,
        alertText: alertDiv ? alertDiv.innerText : null,
        foundInDOM: cardsText.includes('MCC MRF Testing Park')
      };
    })()`,
    returnByValue: true
  });
  console.log('Add Location Outcome:', addOutcome.result?.value);

  // ==========================================
  // REPRODUCE OPERATION 2: Edit Existing Location (250m -> 300m)
  // ==========================================
  console.log('\n==========================================');
  console.log('TESTING OPERATION 2: Edit Attendance Location (250m -> 300m)');
  console.log('==========================================');

  // Close create modal if still open
  await send('Runtime.evaluate', {
    expression: `(() => {
      const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Cancel'));
      if (cancelBtn) cancelBtn.click();
    })()`
  });
  await new Promise(r => setTimeout(r, 1000));

  // Find Edit button for existing location
  const clickEditRes = await send('Runtime.evaluate', {
    expression: `(() => {
      const editButtons = Array.from(document.querySelectorAll('button')).filter(b => b.innerText.trim() === 'Edit');
      if (editButtons.length > 0) {
        editButtons[0].click();
        return { clicked: true, count: editButtons.length };
      }
      return { clicked: false, count: 0 };
    })()`,
    returnByValue: true
  });
  console.log('Click Edit result:', clickEditRes.result?.value);
  await new Promise(r => setTimeout(r, 1000));

  // Inspect Edit Modal state
  const editModalState = await send('Runtime.evaluate', {
    expression: `(() => {
      const modal = document.querySelector('div.fixed.inset-0 form');
      if (!modal) return { hasModal: false };
      const nameInput = modal.querySelector('input[placeholder*="MRF Innovation Park" i], input[type="text"]');
      const radiusInput = modal.querySelector('input[type="number"][min="10"]');
      const submitBtn = modal.querySelector('button[type="submit"]');
      return {
        hasModal: true,
        name: nameInput ? nameInput.value : null,
        radius: radiusInput ? radiusInput.value : null,
        submitBtnText: submitBtn ? submitBtn.innerText : null
      };
    })()`,
    returnByValue: true
  });
  console.log('Edit Modal Initial State:', editModalState.result?.value);

  // Change Radius to 300m via custom radius input
  console.log('Changing Custom Radius to 300m...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const modal = document.querySelector('div.fixed.inset-0 form');
      const radiusInput = modal ? modal.querySelector('input[type="number"][min="10"]') : null;
      if (radiusInput) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(radiusInput, '300');
        radiusInput.dispatchEvent(new Event('input', { bubbles: true }));
        radiusInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`
  });
  await new Promise(r => setTimeout(r, 500));

  // Click "Update Location"
  console.log('Clicking "Update Location" button...');
  const clickUpdateRes = await send('Runtime.evaluate', {
    expression: `(() => {
      const modal = document.querySelector('div.fixed.inset-0 form');
      const submitBtn = modal ? modal.querySelector('button[type="submit"]') : null;
      if (submitBtn) {
        submitBtn.click();
        return { clicked: true, text: submitBtn.innerText };
      }
      return { clicked: false };
    })()`,
    returnByValue: true
  });
  console.log('Click Update Location result:', clickUpdateRes.result?.value);
  await new Promise(r => setTimeout(r, 3000));

  // Check outcome of Edit Location
  const editOutcome = await send('Runtime.evaluate', {
    expression: `(() => {
      const modalStillOpen = Boolean(document.querySelector('div.fixed.inset-0 form'));
      const errorDiv = document.querySelector('.bg-rose-500\\\\/10, [class*="rose"], [class*="error" i]');
      const alertDiv = document.querySelector('[class*="alert" i], [class*="toast" i]');
      const cardsText = document.body.innerText;
      return {
        modalStillOpen,
        errorMessage: errorDiv ? errorDiv.innerText : null,
        alertText: alertDiv ? alertDiv.innerText : null,
        has300mText: cardsText.includes('300m') || cardsText.includes('300 m') || cardsText.includes('300 meters'),
        has250mText: cardsText.includes('250m') || cardsText.includes('250 m') || cardsText.includes('250 meters')
      };
    })()`,
    returnByValue: true
  });
  console.log('Edit Location Outcome:', editOutcome.result?.value);

  chrome.kill();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
