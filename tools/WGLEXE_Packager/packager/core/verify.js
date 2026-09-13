'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Launches the assembled build once with WGLEXE_VERIFY set to a report path.
 * The injected code writes JSON there and exits.
 *
 * The report is a file rather than stdout because Electron on Windows is built
 * as a GUI-subsystem binary: its stdout is not connected when another process
 * spawns it, so anything written there is simply lost.
 *
 * The point of all this is that the packager never claims success on a build it
 * has not actually run.
 */

/**
 * The environment the assembled game is launched with.
 *
 * Electron-specific variables must not be inherited. ELECTRON_RUN_AS_NODE in
 * particular would make the game's own electron.exe start as plain Node and exit
 * without ever opening a window — which is exactly what happens when the
 * packager itself is running under it, as the portable build does when driving
 * the headless CLI.
 */
function childEnv(reportPath) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('ELECTRON_') || key.startsWith('WGLEXE_')) delete env[key];
  }
  env.WGLEXE_VERIFY = reportPath;
  return env;
}

function runBuild(exePath, timeoutMs = 40000) {
  const reportPath = path.join(
    os.tmpdir(),
    `wglexe-verify-${process.pid}-${Date.now()}.json`
  );

  return new Promise((resolve) => {
    let settled = false;
    let child;

    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(poll);
      try {
        if (child) child.kill();
      } catch {
        /* already gone */
      }
      try {
        if (fs.existsSync(reportPath)) fs.unlinkSync(reportPath);
      } catch {
        /* best effort */
      }
    };

    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const readReport = () => {
      if (!fs.existsSync(reportPath)) return false;
      let raw;
      try {
        raw = fs.readFileSync(reportPath, 'utf8');
      } catch {
        return false; // still being written
      }
      if (!raw) return false;
      try {
        const report = JSON.parse(raw);
        finish(report.error ? { ok: false, error: report.error } : { ok: true, report });
      } catch (error) {
        finish({ ok: false, error: `Unreadable verification report: ${error.message}` });
      }
      return true;
    };

    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          error:
            `The build did not report within ${timeoutMs / 1000}s. It either failed to ` +
            'start or never finished loading the game.',
        }),
      timeoutMs
    );
    const poll = setInterval(readReport, 250);

    try {
      child = spawn(exePath, [], {
        cwd: path.dirname(exePath),
        env: childEnv(reportPath),
        windowsHide: true,
        stdio: 'ignore',
      });
    } catch (error) {
      finish({ ok: false, error: error.message });
      return;
    }

    child.on('error', (error) => finish({ ok: false, error: error.message }));
    child.on('close', () => {
      // Give the report a moment to land, then report the exit as a failure.
      setTimeout(() => {
        if (!readReport()) {
          finish({ ok: false, error: 'The build exited before reporting any result.' });
        }
      }, 400);
    });
  });
}

/** Turns the raw report into the pass/fail rows the UI shows. */
function assess(report, settings) {
  const checks = [];
  const wantSab = settings.security.sharedArrayBuffer !== 'off';

  checks.push({
    label: 'SharedArrayBuffer available',
    ok: wantSab ? report.sharedArrayBuffer === true : true,
    detail: report.sharedArrayBuffer ? 'yes' : 'no',
    critical: wantSab,
  });

  if (settings.security.sharedArrayBuffer === 'isolation') {
    checks.push({
      label: 'Cross-origin isolated',
      ok: report.crossOriginIsolated === true,
      detail: report.crossOriginIsolated ? 'yes' : 'no',
      critical: true,
    });
  }

  const disableFeatures = (report.switches && report.switches.disableFeatures) || '';
  checks.push({
    label: 'Steam Input gamepad fix intact',
    ok: disableFeatures.includes('EnableWindowsGamingInputDataFetcher'),
    detail: disableFeatures || '(empty)',
    critical: true,
  });

  if (settings.steam.enabled && settings.steam.overlayCompat) {
    checks.push({
      label: 'Steam overlay switch applied',
      ok: report.switches && report.switches.inProcessGpu === true,
      detail: report.switches && report.switches.inProcessGpu ? '--in-process-gpu' : 'missing',
      critical: true,
    });
  }

  checks.push({
    label: 'Game loaded',
    ok: typeof report.href === 'string' && report.href.length > 0,
    detail: report.href || '(none)',
    critical: true,
  });

  const failed = checks.filter((check) => !check.ok && check.critical);
  return { ok: failed.length === 0, checks };
}

module.exports = { runBuild, assess };
