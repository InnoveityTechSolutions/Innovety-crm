const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9229;

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
  const userDataDir = path.join(__dirname, 'chrome_diff_profile');
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

  const img1Base64 = fs.readFileSync('C:/Users/Luffy/.gemini/antigravity-ide/brain/dcbd3b14-1f45-45b1-a648-686b6369a1dd/.tempmediaStorage/media_1791625225683.png').toString('base64');
  const img2Base64 = fs.readFileSync('C:/Users/Luffy/.gemini/antigravity-ide/brain/dcbd3b14-1f45-45b1-a648-686b6369a1dd/.tempmediaStorage/media_1791625697770.png').toString('base64');

  const diffResult = await send('Runtime.evaluate', {
    expression: `
      (async () => {
        function loadImg(b64) {
          return new Promise(resolve => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.src = 'data:image/png;base64,' + b64;
          });
        }
        const img1 = await loadImg("${img1Base64}");
        const img2 = await loadImg("${img2Base64}");

        const canvas1 = document.createElement('canvas');
        canvas1.width = img1.width; canvas1.height = img1.height;
        const ctx1 = canvas1.getContext('2d');
        ctx1.drawImage(img1, 0, 0);
        const data1 = ctx1.getImageData(0, 0, img1.width, img1.height).data;

        const canvas2 = document.createElement('canvas');
        canvas2.width = img2.width; canvas2.height = img2.height;
        const ctx2 = canvas2.getContext('2d');
        ctx2.drawImage(img2, 0, 0);
        const data2 = ctx2.getImageData(0, 0, img2.width, img2.height).data;

        let diffPixels = 0;
        let diffBox = { minX: 9999, minY: 9999, maxX: 0, maxY: 0 };
        for (let y = 0; y < img1.height; y++) {
          for (let x = 0; x < img1.width; x++) {
            const idx = (y * img1.width + x) * 4;
            const rDiff = Math.abs(data1[idx] - data2[idx]);
            const gDiff = Math.abs(data1[idx+1] - data2[idx+1]);
            const bDiff = Math.abs(data1[idx+2] - data2[idx+2]);
            if (rDiff > 10 || gDiff > 10 || bDiff > 10) {
              diffPixels++;
              if (x < diffBox.minX) diffBox.minX = x;
              if (y < diffBox.minY) diffBox.minY = y;
              if (x > diffBox.maxX) diffBox.maxX = x;
              if (y > diffBox.maxY) diffBox.maxY = y;
            }
          }
        }

        return {
          width: img1.width,
          height: img1.height,
          diffPixels,
          diffPercent: (diffPixels / (img1.width * img1.height) * 100).toFixed(2),
          diffBox
        };
      })()
    `,
    awaitPromise: true,
    returnByValue: true
  });

  console.log('DIFF RESULT:\n', JSON.stringify(diffResult?.result?.value, null, 2));

  chromeProc.kill();
  process.exit(0);
}

main().catch(console.error);
