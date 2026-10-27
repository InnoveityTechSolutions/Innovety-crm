const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9231;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getWsUrl() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${DEBUG_PORT}/json`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const list = JSON.parse(data);
          const page = list.find((t) => t.type === 'page');
          if (page && page.webSocketDebuggerUrl) {
            resolve(page.webSocketDebuggerUrl);
          } else {
            reject(new Error('No page target found'));
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  const userDataDir = path.join(__dirname, 'chrome_crop_profile');
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--disable-gpu',
    'about:blank'
  ]);

  let wsUrl = null;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    try {
      wsUrl = await getWsUrl();
      if (wsUrl) break;
    } catch (e) {}
  }

  const ws = new WebSocket(wsUrl);
  let id = 1;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  };

  const send = (method, params = {}) => {
    const msgId = id++;
    return new Promise((resolve) => {
      pending.set(msgId, resolve);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  };

  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable');
  await send('Runtime.enable');

  const imgB64 = fs.readFileSync('C:/Users/Luffy/.gemini/antigravity-ide/brain/dcbd3b14-1f45-45b1-a648-686b6369a1dd/.tempmediaStorage/media_1791625697770.png').toString('base64');

  // Crop right side of modal and bottom of modal
  const crops = await send('Runtime.evaluate', {
    expression: `
      (async () => {
        function loadImg(b64) {
          return new Promise(resolve => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.src = 'data:image/png;base64,' + b64;
          });
        }
        const img = await loadImg("${imgB64}");

        // 1. Right side of modal: x from 1150 to 1250, y from 100 to 750
        const c1 = document.createElement('canvas');
        c1.width = 150; c1.height = 650;
        const ctx1 = c1.getContext('2d');
        ctx1.drawImage(img, 1150, 100, 150, 650, 0, 0, 150, 650);
        const rightEdgeB64 = c1.toDataURL('image/png').split(',')[1];

        // 2. Bottom of modal: x from 180 to 1250, y from 600 to 800
        const c2 = document.createElement('canvas');
        c2.width = 1070; c2.height = 200;
        const ctx2 = c2.getContext('2d');
        ctx2.drawImage(img, 180, 600, 1070, 200, 0, 0, 1070, 200);
        const bottomEdgeB64 = c2.toDataURL('image/png').split(',')[1];

        // 3. Far right edge of screen: x from 1380 to 1418, y from 0 to 802
        const c3 = document.createElement('canvas');
        c3.width = 38; c3.height = 802;
        const ctx3 = c3.getContext('2d');
        ctx3.drawImage(img, 1380, 0, 38, 802, 0, 0, 38, 802);
        const screenRightEdgeB64 = c3.toDataURL('image/png').split(',')[1];

        return { rightEdgeB64, bottomEdgeB64, screenRightEdgeB64 };
      })()
    `,
    awaitPromise: true,
    returnByValue: true
  });

  if (crops?.result?.value) {
    fs.writeFileSync(path.join(__dirname, 'crop_modal_right.png'), Buffer.from(crops.result.value.rightEdgeB64, 'base64'));
    fs.writeFileSync(path.join(__dirname, 'crop_modal_bottom.png'), Buffer.from(crops.result.value.bottomEdgeB64, 'base64'));
    fs.writeFileSync(path.join(__dirname, 'crop_screen_right.png'), Buffer.from(crops.result.value.screenRightEdgeB64, 'base64'));
    console.log('Saved crops!');
  }

  chromeProc.kill();
  process.exit(0);
}

main().catch(console.error);
