const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9230;

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
  const userDataDir = path.join(__dirname, 'chrome_deep_dive_profile');
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--disable-gpu',
    '--window-size=1440,900',
    'http://localhost:5173/login'
  ]);

  let wsUrl = null;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    try {
      wsUrl = await getWsUrl();
      if (wsUrl) break;
    } catch (e) {}
  }

  if (!wsUrl) {
    console.error('Failed to connect to Chrome debugging port.');
    chromeProc.kill();
    process.exit(1);
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
  await send('DOM.enable');

  await sleep(1000);

  // 1. Authenticate Admin
  await send('Runtime.evaluate', {
    expression: `
      (async () => {
        const res = await fetch('http://localhost:5000/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'admin@enterprise-crm.com', password: 'password123', organizationSlug: 'innoveity' })
        });
        const data = await res.json();
        if (data.token) {
          localStorage.setItem('token', data.token);
          localStorage.setItem('user', JSON.stringify(data.user));
          return true;
        }
        return false;
      })()
    `,
    awaitPromise: true
  });

  // 2. Navigate
  await send('Page.navigate', { url: 'http://localhost:5173/attendance-audit' });
  
  // Wait for table to be loaded
  let loaded = false;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const check = await send('Runtime.evaluate', {
      expression: `
        (() => {
          const rows = document.querySelectorAll('table tbody tr');
          return { url: window.location.href, rowCount: rows.length };
        })()
      `,
      returnByValue: true
    });
    if (check?.result?.value?.rowCount > 0) {
      console.log('Page loaded with', check.result.value.rowCount, 'rows at', check.result.value.url);
      loaded = true;
      break;
    }
  }

  // 3. Open Modal
  const clickRes = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const rows = Array.from(document.querySelectorAll('table tbody tr'));
        const rowWithClockIn = rows.find(r => r.innerText.includes('AM') || r.innerText.includes('PM'));
        if (rowWithClockIn) {
          const btn = rowWithClockIn.querySelector('button[title="View Attendance Details"]');
          if (btn) {
            btn.click();
            return { clicked: true, text: rowWithClockIn.innerText.substring(0, 50) };
          }
        }
        return { clicked: false, totalRows: rows.length };
      })()
    `,
    returnByValue: true
  });
  console.log('Clicked row result:', clickRes?.result?.value);
  await sleep(1500);

  // 4. Perform Detailed DOM and Computed Style Diagnostics
  const report = await send('Runtime.evaluate', {
    expression: `
      (() => {
        function analyzeElement(el, name) {
          if (!el) return { name, exists: false };
          const rect = el.getBoundingClientRect();
          const cs = window.getComputedStyle(el);
          return {
            name,
            exists: true,
            tagName: el.tagName,
            id: el.id,
            className: el.className,
            rect: {
              top: rect.top,
              bottom: rect.bottom,
              left: rect.left,
              right: rect.right,
              width: rect.width,
              height: rect.height
            },
            scrollDimensions: {
              clientHeight: el.clientHeight,
              scrollHeight: el.scrollHeight,
              clientWidth: el.clientWidth,
              scrollWidth: el.scrollWidth,
              offsetHeight: el.offsetHeight,
              offsetWidth: el.offsetWidth,
              scrollTop: el.scrollTop,
              scrollLeft: el.scrollLeft
            },
            overflowY: cs.overflowY,
            overflowX: cs.overflowX,
            display: cs.display,
            flexDirection: cs.flexDirection,
            flexGrow: cs.flexGrow,
            flexShrink: cs.flexShrink,
            flexBasis: cs.flexBasis,
            position: cs.position,
            boxSizing: cs.boxSizing,
            padding: {
              top: cs.paddingTop,
              bottom: cs.paddingBottom,
              left: cs.paddingLeft,
              right: cs.paddingRight
            },
            margin: {
              top: cs.marginTop,
              bottom: cs.marginBottom,
              left: cs.marginLeft,
              right: cs.marginRight
            },
            maxHeight: cs.maxHeight,
            minHeight: cs.minHeight,
            height: cs.height,
            isScrollableY: el.scrollHeight > el.clientHeight,
            isScrollableX: el.scrollWidth > el.clientWidth,
            hasVisibleVerticalScrollbar: (el.scrollHeight > el.clientHeight) && (cs.overflowY === 'auto' || cs.overflowY === 'scroll')
          };
        }

        const backdrop = document.querySelector('.fixed.inset-0.z-50');
        const modalDialog = backdrop ? backdrop.querySelector('.bg-card.shadow-2xl') : null;
        const header = modalDialog ? modalDialog.querySelector('.border-b') : null;
        const summary = modalDialog ? modalDialog.querySelector('.grid.grid-cols-2') : null;
        const contentWrapper = modalDialog ? modalDialog.querySelector('.flex-1') : null;
        const grid = modalDialog ? modalDialog.querySelector('.grid.grid-cols-1') : null;
        const cards = grid ? Array.from(grid.children) : [];
        const clockInCard = cards[0];
        const clockOutCard = cards[1];
        const footer = modalDialog ? modalDialog.querySelector('.border-t') : null;
        const closeBtn = footer ? footer.querySelector('button') : null;

        // Background main container and root
        const main = document.querySelector('main');
        const body = document.body;
        const html = document.documentElement;
        const toast = document.querySelector('.fixed.bottom-5.right-5');

        // Check if footer overlaps content wrapper or cards
        let footerOverlapsContent = false;
        let footerOverlapsCards = false;
        if (footer && contentWrapper) {
          const fRect = footer.getBoundingClientRect();
          const cRect = contentWrapper.getBoundingClientRect();
          footerOverlapsContent = (fRect.top < cRect.bottom);
        }
        if (footer && clockInCard) {
          const fRect = footer.getBoundingClientRect();
          const cardRect = clockInCard.getBoundingClientRect();
          footerOverlapsCards = (fRect.top < cardRect.bottom);
        }

        // Check clipping: Is any child overflowing its parent without scrolling?
        let isContentClippedByModal = false;
        if (modalDialog && contentWrapper) {
          const mRect = modalDialog.getBoundingClientRect();
          const cRect = contentWrapper.getBoundingClientRect();
          isContentClippedByModal = (cRect.bottom > mRect.bottom);
        }

        return {
          window: {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio
          },
          html: analyzeElement(html, 'html'),
          body: analyzeElement(body, 'body'),
          main: analyzeElement(main, 'main (page behind modal)'),
          backdrop: analyzeElement(backdrop, 'backdrop'),
          modalDialog: analyzeElement(modalDialog, 'modalDialog'),
          header: analyzeElement(header, 'header'),
          summary: analyzeElement(summary, 'summary'),
          contentWrapper: analyzeElement(contentWrapper, 'contentWrapper'),
          grid: analyzeElement(grid, 'grid'),
          clockInCard: analyzeElement(clockInCard, 'clockInCard'),
          clockOutCard: analyzeElement(clockOutCard, 'clockOutCard'),
          footer: analyzeElement(footer, 'footer'),
          closeBtn: analyzeElement(closeBtn, 'closeBtn'),
          toast: analyzeElement(toast, 'toastAlert'),
          overlapAnalysis: {
            footerOverlapsContent,
            footerOverlapsCards,
            isContentClippedByModal,
            modalRect: modalDialog ? modalDialog.getBoundingClientRect() : null,
            contentWrapperRect: contentWrapper ? contentWrapper.getBoundingClientRect() : null,
            footerRect: footer ? footer.getBoundingClientRect() : null,
            closeBtnRect: closeBtn ? closeBtn.getBoundingClientRect() : null,
            toastRect: toast ? toast.getBoundingClientRect() : null,
            toastOverlapsCloseBtn: Boolean(toast && closeBtn && (() => {
              const t = toast.getBoundingClientRect();
              const c = closeBtn.getBoundingClientRect();
              return !(t.right < c.left || t.left > c.right || t.bottom < c.top || t.top > c.bottom);
            })())
          }
        };
      })()
    `,
    returnByValue: true
  });

  console.log('DETAILED DIAGNOSTIC REPORT:\n', JSON.stringify(report?.result?.value, null, 2));

  chromeProc.kill();
  process.exit(0);
}

main().catch(console.error);
