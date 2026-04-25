import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const outputDir = path.resolve(repoRoot, 'video/public/screens');
const port = process.env.VAULTMARK_CAPTURE_PORT || '3100';
const baseUrl = process.env.VAULTMARK_CAPTURE_URL || `http://127.0.0.1:${port}`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set to capture screenshots against a real vault`);
  return value;
}

async function waitForServer(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // Server is not up yet.
    }
    await wait(750);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function screenshot(page, name) {
  await page.screenshot({
    path: path.join(outputDir, `${name}.png`),
    fullPage: false,
  });
}

async function gotoApp(page, pathName = '/') {
  await page.goto(`${baseUrl}${pathName}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4_800);
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  const server = spawn(
    'pnpm',
    ['--filter', '@vaultmark/web', 'exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', port],
    {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        VAULT_BUCKET: requiredEnv('VAULT_BUCKET'),
        VAULT_PREFIX: process.env.VAULT_PREFIX || '',
        VAULT_REGION: process.env.VAULT_REGION || 'us-east-1',
        NEXT_TELEMETRY_DISABLED: '1',
      },
    },
  );

  server.stdout.on('data', (data) => process.stdout.write(data));
  server.stderr.on('data', (data) => process.stderr.write(data));

  let browser;
  try {
    await waitForServer(baseUrl);
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

    await gotoApp(page);
    await screenshot(page, 'home');

    await page.getByRole('button', { name: /ask anything/i }).click();
    await page.waitForTimeout(600);
    await screenshot(page, 'ask-wiki');

    await gotoApp(page);
    await page.getByRole('button', { name: /upload markdown/i }).first().click();
    await page.waitForTimeout(600);
    await screenshot(page, 'upload');

    await gotoApp(page);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
    await page.waitForTimeout(350);
    await page.keyboard.type('index');
    await page.waitForTimeout(3_000);
    await screenshot(page, 'search');

    await gotoApp(page);
    await page.getByTitle('New page').click();
    await page.waitForTimeout(600);
    await screenshot(page, 'editor');

    await gotoApp(page, '/dev/parity');
    await screenshot(page, 'parity');
  } finally {
    await browser?.close().catch(() => {});
    server.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
