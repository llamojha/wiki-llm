#!/usr/bin/env node
// Visual parity harness. Drives prototype + port through matching states with
// Playwright, screenshots both, diffs with pixelmatch. Outputs to
// parity-visual/{proto,port,diff}/. Run from repo root:
//
//   pnpm visual
//
// Assumes Next.js is built (or running). Spawns its own static server for
// portal/ and its own next-start subprocess for web/.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const OUT_DIR = join(root, 'parity-visual');
const PROTO_PORT = 8088;
const PORT_PORT = 3088;
const VIEWPORT = { width: 1440, height: 900 };
// Pixelmatch tolerance. The prototype loads webfonts via Google Fonts CDN
// while the port uses next/font self-hosted — same family, weights, and
// rendered layout, but glyphs differ by a few grayscale values per pixel
// (sub-pixel anti-aliasing). Bytes-per-glyph diff is invisible to the eye but
// shows up as ~2-4% mismatch on text-heavy screens. 5% threshold keeps real
// layout drift catchable while accepting font-binary noise. Re-tighten if we
// ever align font sources (e.g. ship next/font in the prototype too).
const PIXEL_THRESHOLD = 0.2;
const MAX_DIFF_RATIO = 0.05;

// ─── Determinism: stubs injected into both apps before any script runs ───────
const INIT_SCRIPT = `
  (function () {
    // Fixed date for HomeView's toDateString().
    const FIXED_DATE = new Date('2026-05-06T12:00:00Z');
    const _toDateString = Date.prototype.toDateString;
    const _Date = Date;
    const FixedDate = function (...args) {
      if (args.length === 0) return new _Date(FIXED_DATE);
      return new _Date(...args);
    };
    FixedDate.prototype = _Date.prototype;
    FixedDate.now = () => FIXED_DATE.getTime();
    FixedDate.parse = _Date.parse;
    FixedDate.UTC = _Date.UTC;
    globalThis.Date = FixedDate;

    // Deterministic Math.random for any inline hash generation.
    let seed = 0xdeadbeef;
    Math.random = function () {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    // Disable transitions/animations once DOM is ready.
    function disableMotion() {
      const style = document.createElement('style');
      style.textContent = '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; }';
      document.head.appendChild(style);
      // Hide tweaks panel + dev affordances that the port doesn't have.
      const hide = document.createElement('style');
      hide.textContent = '.tweaks, .tweaks-panel, .tweaks-toggle, .tweaks-fab, [data-tweaks] { display: none !important; }';
      document.head.appendChild(hide);
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', disableMotion);
    } else {
      disableMotion();
    }
  })();
`;

// ─── Static server for portal/ (the prototype is plain HTML+CDN scripts) ─────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jsx': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function startStaticServer(rootDir, port) {
  const server = createServer((req, res) => {
    let path = decodeURIComponent((req.url || '/').split('?')[0]);
    if (path === '/') path = '/index.html';
    const fp = join(rootDir, path);
    if (!existsSync(fp) || !statSync(fp).isFile()) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.setHeader('Content-Type', MIME[extname(fp)] || 'application/octet-stream');
    res.end(readFileSync(fp));
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

async function waitForUrl(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return; // 404 is fine — server is up
    } catch {
      // not ready
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

// ─── State list. Each state defines how to drive both the prototype and the
//     port to the same visual configuration. ─────────────────────────────────
const STATES = [
  {
    name: '01-default-doc-incident',
    setup: async () => {
      // App boots on doc-prod-incident; nothing to do.
    },
  },
  {
    name: '02-home',
    setup: async (page) => {
      await page.locator('.sidebar .nav-row', { hasText: 'Home' }).first().click();
      await sleep(150);
    },
  },
  {
    name: '03-home-light',
    setup: async (page) => {
      await page.locator('.sidebar .nav-row', { hasText: 'Home' }).first().click();
      await sleep(50);
      await page.locator('.icon-btn[title="Toggle theme"]').click();
      await sleep(150);
    },
  },
  {
    name: '04-doc-postgres-failover',
    setup: async (page) => {
      // postgres-failover.md is under platform/runbooks which is open by default.
      await page.locator('.nav-label', { hasText: 'postgres-failover.md' }).click();
      await sleep(150);
    },
  },
  {
    name: '05-doc-billing',
    setup: async (page) => {
      await page.locator('.nav-label', { hasText: 'billing-service.md' }).click();
      await sleep(150);
    },
  },
  {
    name: '06-doc-personal-planning',
    setup: async (page) => {
      await page.locator('.scope-switch button', { hasText: 'My wiki' }).click();
      await sleep(50);
      await page.locator('.nav-label', { hasText: 'q2-planning.md' }).click();
      await sleep(150);
    },
  },
  {
    name: '07-palette-empty',
    setup: async (page) => {
      await page.keyboard.press('ControlOrMeta+KeyK');
      await sleep(300);
    },
  },
  {
    name: '08-palette-query',
    setup: async (page) => {
      await page.keyboard.press('ControlOrMeta+KeyK');
      await sleep(150);
      await page.locator('.palette input').fill('incident');
      await sleep(150);
    },
  },
  {
    name: '09-chat-greeting',
    setup: async (page) => {
      await page.keyboard.press('ControlOrMeta+Shift+KeyA');
      await sleep(300);
    },
  },
];

// ─── Driver ────────────────────────────────────────────────────────────────
async function captureState(browser, baseUrl, state, label) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  await ctx.addInitScript(INIT_SCRIPT);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`  [${label}/${state.name}] page error:`, e.message));
  await page.goto(baseUrl, { waitUntil: 'load' });
  // Wait for the sidebar to be present (signals app boot).
  await page.locator('.sidebar').waitFor({ timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await sleep(400);
  await state.setup(page);
  await page.evaluate(() => document.fonts.ready);
  await sleep(150);
  const buf = await page.screenshot({ fullPage: false });
  await ctx.close();
  return buf;
}

function diffPng(aBuf, bBuf, outPath) {
  const a = PNG.sync.read(aBuf);
  const b = PNG.sync.read(bBuf);
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const diff = new PNG({ width: w, height: h });
  const mismatch = pixelmatch(a.data, b.data, diff.data, w, h, {
    threshold: PIXEL_THRESHOLD,
    diffMask: false,
    alpha: 0.4,
  });
  writeFileSync(outPath, PNG.sync.write(diff));
  return { mismatch, total: w * h };
}

async function main() {
  console.log('Visual parity harness');
  console.log('────────────────────────────────────────────────────────────');

  // Reset output dir
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
  for (const sub of ['proto', 'port', 'diff']) mkdirSync(join(OUT_DIR, sub), { recursive: true });

  // Boot prototype static server
  console.log(`booting prototype on :${PROTO_PORT}…`);
  const protoServer = await startStaticServer(join(root, 'portal'), PROTO_PORT);

  // Boot port (next start)
  console.log(`booting port (next start) on :${PORT_PORT}…`);
  const portProc = spawn(
    'pnpm',
    ['--filter', '@vaultmark/web', 'exec', 'next', 'start', '-p', String(PORT_PORT)],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  portProc.stdout.on('data', (d) => process.stdout.write(`  [port] ${d}`));
  portProc.stderr.on('data', (d) => process.stderr.write(`  [port-err] ${d}`));
  await waitForUrl(`http://localhost:${PORT_PORT}/`);

  const browser = await chromium.launch();
  let totalFailed = 0;

  try {
    console.log('\nstate                           proto-bytes  port-bytes  mismatch  ratio   verdict');
    console.log('───────────────────────────────────────────────────────────────────────────────────');
    for (const state of STATES) {
      const protoBuf = await captureState(browser, `http://localhost:${PROTO_PORT}/`, state, 'proto');
      const portBuf = await captureState(browser, `http://localhost:${PORT_PORT}/`, state, 'port');
      writeFileSync(join(OUT_DIR, 'proto', `${state.name}.png`), protoBuf);
      writeFileSync(join(OUT_DIR, 'port', `${state.name}.png`), portBuf);
      const { mismatch, total } = diffPng(protoBuf, portBuf, join(OUT_DIR, 'diff', `${state.name}.png`));
      const ratio = mismatch / total;
      const ok = ratio <= MAX_DIFF_RATIO;
      if (!ok) totalFailed += 1;
      console.log(
        `${state.name.padEnd(32)} ${String(protoBuf.length).padStart(10)}  ${String(portBuf.length).padStart(10)}  ${String(mismatch).padStart(8)}  ${(ratio * 100).toFixed(2).padStart(5)}%  ${ok ? '[32mOK  [0m' : '[31mDRIFT[0m'}`,
      );
    }
    console.log('───────────────────────────────────────────────────────────────────────────────────');
  } finally {
    await browser.close();
    portProc.kill('SIGTERM');
    protoServer.close();
  }

  console.log(`\nOutput: ${OUT_DIR}`);
  if (totalFailed > 0) {
    console.log(`[31m${totalFailed} state(s) drifted beyond ${(MAX_DIFF_RATIO * 100).toFixed(2)}%.[0m`);
    process.exit(1);
  } else {
    console.log('[32mAll states match within tolerance.[0m');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
