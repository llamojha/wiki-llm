#!/usr/bin/env node
/**
 * Seed the in-memory mock S3 vault with the repo's own `openwiki/` docs.
 *
 * The mock store (`MOCK_S3=1`) starts empty, so a local dev server shows an
 * empty portal until it is seeded. This script loads every `openwiki/**\/*.md`
 * file into the mock bucket so the portal renders Canopy's own documentation
 * as a real vault — handy for demos and manual QA.
 *
 * The `openwiki/` prefix is stripped, so the top-level folders (`architecture`,
 * `testing`, `operations`, `workflows`) plus the root `quickstart.md` become the
 * vault's spaces. With no `_system/structure.json` and no `generated/`/
 * `authored/` roots, the server sniffs **folders mode** — the zero-config
 * on-ramp the docs themselves describe.
 *
 * Usage:
 *   1. Start a dev server in mock mode:  MOCK_S3=1 pnpm dev   (or `pnpm dev:mock`)
 *   2. Seed it:                          pnpm seed:openwiki
 *
 * Env:
 *   SEED_BASE_URL   target server (default http://localhost:3000)
 *   --dry           print the keys that would be seeded, POST nothing
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const OPENWIKI_DIR = join(REPO_ROOT, 'openwiki');
const BASE_URL = process.env.SEED_BASE_URL ?? 'http://localhost:3000';
const DRY = process.argv.includes('--dry');

/** Recursively collect all `.md` and `.html` files under `dir`. */
function walkDocs(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkDocs(full));
    } else if (entry.endsWith('.md') || entry.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

function buildSeed() {
  const files = walkDocs(OPENWIKI_DIR);
  const seed = {};
  for (const file of files) {
    // Strip the `openwiki/` prefix and normalize to forward-slash S3 keys.
    const key = relative(OPENWIKI_DIR, file).split(sep).join('/');
    seed[key] = readFileSync(file, 'utf8');
  }
  return seed;
}

async function main() {
  const seed = buildSeed();
  const keys = Object.keys(seed).sort();
  if (!keys.length) {
    console.error(`No .md/.html files found under ${OPENWIKI_DIR}`);
    process.exit(1);
  }

  if (DRY) {
    console.log(`Would seed ${keys.length} openwiki docs into the mock vault:`);
    for (const k of keys) console.log(`  ${k}`);
    return;
  }

  const url = `${BASE_URL}/api/test-seed`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed }),
    });
  } catch (err) {
    console.error(`Could not reach ${url} — is a mock dev server running?`);
    console.error(`  Start one with:  MOCK_S3=1 pnpm dev   (or pnpm dev:mock)`);
    console.error(String(err));
    process.exit(1);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`Seed failed: ${res.status} ${text}`);
    if (res.status === 404) {
      console.error('  The seed endpoint is mock-only — start the server with MOCK_S3=1.');
    }
    process.exit(1);
  }

  const body = await res.json();
  console.log(`Seeded ${body.count ?? keys.length} openwiki docs into the mock vault at ${BASE_URL}`);
  console.log('Open the portal — the top-level folders are the openwiki sections.');
}

main();
