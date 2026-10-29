const { spawn } = require('child_process');
const http = require('http');

async function loginAdmin() {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      email: 'admin@enterprise-crm.com',
      password: 'password123'
    });

    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  console.log('====================================================');
  console.log('STARTING LOCAL MAP TILE REFERRER POLICY VERIFICATION');
  console.log('====================================================\n');

  console.log('Step 1: Authenticating as Admin via Local API...');
  const loginRes = await loginAdmin();
  if (!loginRes.token) {
    console.error('Failed to log in as admin:', loginRes);
    process.exit(1);
  }
  const token = loginRes.token;
  const user = loginRes.user;
  console.log(`[PASS] Admin authenticated: ${user.name} (${user.email})\n`);

  console.log('Step 2: Launching Chrome with CDP Remote Debugging...');
  const chromeProc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-port=9223',
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=1440,900',
    'about:blank'
  ]);

  await new Promise(r => setTimeout(r, 2000));

  const list = await new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9223/json', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  const pageTarget = list.find(t => t.type === 'page');
  if (!pageTarget) {
    console.error('No page target found!');
    chromeProc.kill();
    return;
  }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let id = 1;
  const pending = new Map();
  const tileRequests = [];
  const consoleMessages = [];

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Network.requestWillBeSent') {
      const req = msg.params.request;
      if (req.url && req.url.includes('tile.openstreetmap.org')) {
        tileRequests.push({
          url: req.url,
          headers: req.headers,
          referrerPolicy: req.referrerPolicy
        });
      }
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      consoleMessages.push(msg.params.args.map(a => a.value).join(' '));
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  };

  const send = (method, params = {}) => new Promise((resolve) => {
    const reqId = id++;
    pending.set(reqId, resolve);
    ws.send(JSON.stringify({ id: reqId, method, params }));
  });

  await new Promise(r => ws.onopen = r);

  console.log('Step 3: Enabling CDP Network, Page, and Runtime domains...');
  await send('Network.enable');
  await send('Page.enable');
  await send('Runtime.enable');

  console.log('Step 4: Injecting Admin Authentication Token into Local Storage...');
  await send('Page.navigate', { url: 'http://localhost:5173/login' });
  await new Promise(r => setTimeout(r, 2500));

  await send('Runtime.evaluate', {
    expression: `
      localStorage.setItem('token', ${JSON.stringify(token)});
      localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))});
      localStorage.setItem('role', 'ADMIN');
      true;
    `
  });

  console.log('Step 5: Navigating to Settings Page (http://localhost:5173/settings)...');
  await send('Page.navigate', { url: 'http://localhost:5173/settings' });
  await new Promise(r => setTimeout(r, 3500));

  console.log('Step 6: Triggering "Add Location" modal to render LeafletMapPicker...');
  const clickResult = await send('Runtime.evaluate', {
    expression: `
      (() => {
        // Find Add Location button
        const buttons = Array.from(document.querySelectorAll('button'));
        const addBtn = buttons.find(b => b.innerText && b.innerText.includes('Add Location'));
        if (addBtn) {
          addBtn.click();
          return { clicked: true, text: addBtn.innerText };
        }
        return { clicked: false, availableButtons: buttons.map(b => b.innerText).filter(Boolean) };
      })()
    `,
    returnByValue: true
  });
  console.log('Add Location button click result:', clickResult.result?.value);

  // Wait 4 seconds for map tiles to load
  await new Promise(r => setTimeout(r, 4000));

  console.log('\nStep 7: Inspecting Leaflet DOM and Tile Image Properties...');
  const domInspect = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const metaReferrer = document.querySelector('meta[name="referrer"]')?.getAttribute('content');
        const tileImages = Array.from(document.querySelectorAll('img.leaflet-tile'));
        const mapContainer = document.querySelector('.leaflet-container');
        
        return {
          documentMetaReferrer: metaReferrer,
          hasMapContainer: !!mapContainer,
          tileCount: tileImages.length,
          tileSamples: tileImages.slice(0, 3).map(img => ({
            src: img.src,
            referrerPolicyAttr: img.getAttribute('referrerpolicy'),
            referrerPolicyProp: img.referrerPolicy,
            complete: img.complete,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight
          }))
        };
      })()
    `,
    returnByValue: true
  });

  console.log('DOM Inspection Results:');
  console.log(JSON.stringify(domInspect.result?.value, null, 2));

  console.log('\nStep 8: Inspecting Network Tile Requests...');
  console.log(`Captured ${tileRequests.length} tile requests to tile.openstreetmap.org:`);
  tileRequests.slice(0, 3).forEach((tr, i) => {
    console.log(`\n[Tile Request #${i + 1}]`);
    console.log(`  URL: ${tr.url}`);
    console.log(`  CDP ReferrerPolicy: ${tr.referrerPolicy}`);
    console.log(`  Request Referer Header: ${tr.headers.Referer || tr.headers.referer || '(none)'}`);
  });

  const domValue = domInspect.result?.value;
  let allPass = true;

  if (domValue?.documentMetaReferrer === 'strict-origin-when-cross-origin') {
    console.log('\n[PASS] index.html has <meta name="referrer" content="strict-origin-when-cross-origin">');
  } else {
    console.error('\n[FAIL] Missing or unexpected meta referrer:', domValue?.documentMetaReferrer);
    allPass = false;
  }

  const sampleTile = domValue?.tileSamples?.[0];
  if (sampleTile && sampleTile.referrerPolicyProp === 'strict-origin-when-cross-origin') {
    console.log('[PASS] Leaflet tile <img> elements have referrerPolicy = "strict-origin-when-cross-origin"');
  } else {
    console.error('[FAIL] Leaflet tile missing referrerPolicy property:', sampleTile);
    allPass = false;
  }

  if (sampleTile && sampleTile.complete && sampleTile.naturalWidth === 256) {
    console.log('[PASS] Tile loaded successfully as 256x256 image');
  } else {
    console.error('[FAIL] Tile failed to load as 256x256 image:', sampleTile);
    allPass = false;
  }

  console.log('\n====================================================');
  console.log(`VERIFICATION SUMMARY: ${allPass ? 'ALL CHECKS PASSED SUCCESSFULLY' : 'VERIFICATION FAILED'}`);
  console.log('====================================================\n');

  chromeProc.kill();
  process.exit(allPass ? 0 : 1);
}

main().catch(err => {
  console.error('Verification error:', err);
  process.exit(1);
});
