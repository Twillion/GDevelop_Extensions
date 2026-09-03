import { spawn } from 'node:child_process';

const SCENARIOS = [
  'ocean',
  'gerstner',
  'buoyancy',
  'sph',
  'lighting',
  'postfx',
  'material',
  'shore'
];

async function runScenario(scenario) {
  const server = spawn('node', ['gdjs-harness/serve.js'], { stdio: 'pipe' });
  await new Promise(resolve => setTimeout(resolve, 600));

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const debuggingPort = 9222 + Math.floor(Math.random() * 100);
  const chrome = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${debuggingPort}`,
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--no-first-run',
    '--no-default-browser-check',
    `http://localhost:8140/?scenario=${scenario}`
  ]);

  await new Promise(resolve => setTimeout(resolve, 1500));

  let panelText = '';
  let badLines = [];
  let uncaughtErrors = [];

  try {
    const res = await fetch(`http://127.0.0.1:${debuggingPort}/json`);
    const pages = await res.json();
    const targetPage = pages.find(p => p.type === 'page' && p.url.includes('localhost:8140')) || pages.find(p => p.type === 'page');
    
    if (targetPage && targetPage.webSocketDebuggerUrl) {
      const ws = new WebSocket(targetPage.webSocketDebuggerUrl);
      ws.onopen = () => {
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
        ws.send(JSON.stringify({ id: 2, method: 'Console.enable' }));
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.method === 'Runtime.exceptionThrown') {
          uncaughtErrors.push(msg.params.exceptionDetails?.text || 'Uncaught error');
        }
      };

      // Allow 3 seconds for scenario report
      await new Promise(resolve => setTimeout(resolve, 3000));

      const evalId = 100;
      ws.send(JSON.stringify({
        id: evalId,
        method: 'Runtime.evaluate',
        params: {
          // Return the panel text AND every line a scenario marked as a failed expectation.
          expression: 'JSON.stringify({ text: document.getElementById("panel") ? document.getElementById("panel").innerText : "NO PANEL", bad: Array.from(document.querySelectorAll("#panel .bad")).map(function (e) { return e.textContent; }) })'
        }
      }));

      await new Promise(resolve => {
        const origOnMessage = ws.onmessage;
        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data);
          if (msg.id === evalId) {
            try {
              const parsed = JSON.parse(msg.result?.result?.value || '{}');
              panelText = parsed.text || '';
              badLines = parsed.bad || [];
            } catch (e) { panelText = msg.result?.result?.value || ''; }
            resolve();
          } else if (origOnMessage) {
            origOnMessage(event);
          }
        };
      });

      ws.close();
    }
  } catch (err) {
    uncaughtErrors.push(err.message);
  } finally {
    chrome.kill();
    server.kill();
  }

  return { scenario, panelText, uncaughtErrors, badLines };
}

async function main() {
  console.log('====================================================');
  console.log('  RUNNING ALL GDJS HARNESS SCENARIOS IN REAL ENGINE ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  for (const s of SCENARIOS) {
    process.stdout.write(`Testing scenario: ${s.padEnd(12)} ... `);
    const res = await runScenario(s);

    const hasDone = res.panelText.includes('DONE');
    // A scenario marks a failed expectation by logging it with the "bad" class. Reaching DONE
    // without throwing is NOT the same as behaving correctly — the buoyancy scenario reached DONE
    // while launching the boat to Z=46765.
    const badLines = res.badLines || [];
    const hasUncaught = res.uncaughtErrors.length > 0 || res.panelText.includes('UNCAUGHT:');
    const hasBad = badLines.length > 0;
    const isOk = hasDone && !hasUncaught && !hasBad;

    if (isOk) {
      console.log('✅ PASS');
      passed++;
    } else {
      console.log('❌ FAIL');
      if (hasBad) for (const b of badLines) console.log('       ↳ ' + b);
      if (!hasDone) console.log('       ↳ scenario never reached DONE');
      console.log('--- Output ---');
      console.log(res.panelText);
      if (res.uncaughtErrors.length) console.log('Errors:', res.uncaughtErrors);
      failed++;
    }
  }

  console.log('\n====================================================');
  console.log(`  RESULT: ${passed} passed, ${failed} failed (${SCENARIOS.length} total)`);
  console.log('====================================================\n');

  if (failed > 0) process.exit(1);
}

main();
