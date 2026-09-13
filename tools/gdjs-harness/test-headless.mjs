import { spawn } from 'node:child_process';
import http from 'node:http';

async function main() {
  const scenario = process.argv[2] || 'ocean';
  const server = spawn('node', ['gdjs-harness/serve.js'], { stdio: 'pipe' });
  await new Promise(resolve => setTimeout(resolve, 800));

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const debuggingPort = 9222;
  const chrome = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${debuggingPort}`,
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--no-first-run',
    '--no-default-browser-check',
    `http://localhost:8140/?scenario=${scenario}${process.argv[3] ? '&' + process.argv[3] : ''}`
  ]);

  await new Promise(resolve => setTimeout(resolve, 1500));

  try {
    const res = await fetch(`http://127.0.0.1:${debuggingPort}/json`);
    const pages = await res.json();
    console.log('Discovered targets:', pages.map(p => ({ title: p.title, url: p.url, type: p.type })));
    
    const targetPage = pages.find(p => p.type === 'page' && p.url.includes('localhost:8140')) || pages.find(p => p.type === 'page');
    if (!targetPage || !targetPage.webSocketDebuggerUrl) {
      console.error('No suitable target page found');
      cleanup();
      return;
    }

    const ws = new WebSocket(targetPage.webSocketDebuggerUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
      ws.send(JSON.stringify({ id: 2, method: 'Console.enable' }));
      ws.send(JSON.stringify({ id: 3, method: 'Page.enable' }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map(a => a.value !== undefined ? a.value : (a.description || JSON.stringify(a))).join(' ');
        console.log(`[BROWSER ${msg.params.type}]`, text);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        console.error('[BROWSER EXCEPTION]', msg.params.exceptionDetails?.text, msg.params.exceptionDetails?.exception?.description);
      }
    };

    // Wait for scene to boot and scenario to run
    await new Promise(resolve => setTimeout(resolve, 3800));

    // Capture screenshot
    const shotId = 200;
    ws.send(JSON.stringify({ id: shotId, method: 'Page.captureScreenshot', params: { format: 'png' } }));

    await new Promise(resolve => {
      const origOnMessage = ws.onmessage;
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id === shotId && msg.result?.data) {
          import('node:fs').then(fs => {
            fs.writeFileSync(`gdjs-harness/preview_${scenario}.png`, Buffer.from(msg.result.data, 'base64'));
            console.log(`Screenshot saved to gdjs-harness/preview_${scenario}.png`);
            resolve();
          });
        } else if (origOnMessage) {
          origOnMessage(event);
        }
      };
    });

    // Evaluate panel textContent
    const evalId = 100;
    ws.send(JSON.stringify({
      id: evalId,
      method: 'Runtime.evaluate',
      params: {
        expression: 'document.getElementById("panel") ? document.getElementById("panel").innerText : "NO PANEL FOUND"'
      }
    }));

    await new Promise(resolve => {
      const origOnMessage = ws.onmessage;
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id === evalId) {
          console.log('\n=== PANEL INNER TEXT ===\n' + msg.result?.result?.value);
          resolve();
        } else if (origOnMessage) {
          origOnMessage(event);
        }
      };
    });

    ws.close();
  } catch (err) {
    console.error('Error connecting to Chrome CDP:', err);
  } finally {
    cleanup();
  }

  function cleanup() {
    chrome.kill();
    server.kill();
  }
}

main();
