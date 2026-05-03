#!/usr/bin/env node
// Per-icon SVG content parity. Extracts each icon's inner SVG markup from
// portal/data.jsx and web/lib/icons.tsx, normalizes whitespace, and compares
// byte-for-byte. Catches drift in path data, attributes, or sub-element order.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (p) => readFileSync(join(root, p), 'utf-8');

const PROTO = read('portal/data.jsx');
const PORT = read('web/lib/icons.tsx');

// Strip whitespace inside tags and between tags.
function normalize(s) {
  return s
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .replace(/\s+\/>/g, '/>')
    .replace(/\s+>/g, '>')
    .trim();
}

// Extract from prototype: each icon is a single line `name: <svg ...>...</svg>,`
function extractProto(src) {
  const block = src.match(/const ICONS = \{([\s\S]*?)\n\};/)[1];
  const out = {};
  // Match lines like `  name: <svg ...>...</svg>,`
  const re = /^\s+(\w+):\s+(<svg[\s\S]*?<\/svg>),?\s*$/gm;
  let m;
  while ((m = re.exec(block)) !== null) {
    out[m[1]] = normalize(m[2]);
  }
  return out;
}

// Extract from port: each icon is `  name: (\n    <svg ...>...</svg>\n  ),`
function extractPort(src) {
  const block = src.match(/export const ICONS: Record<IconKey, ReactNode> = \{([\s\S]*?)\n\};/)[1];
  const out = {};
  // Match `  name: (\n    <svg ...>...</svg>\n  ),`
  const re = /^\s{2}(\w+):\s*\(\s*(<svg[\s\S]*?<\/svg>)\s*\),?\s*$/gm;
  let m;
  while ((m = re.exec(block)) !== null) {
    out[m[1]] = normalize(m[2]);
  }
  return out;
}

const proto = extractProto(PROTO);
const port = extractPort(PORT);

const protoKeys = new Set(Object.keys(proto));
const portKeys = new Set(Object.keys(port));
const allKeys = [...new Set([...protoKeys, ...portKeys])].sort();

let failed = 0;
console.log('Icon SVG content parity');
console.log('────────────────────────────────────────────────────────────');
for (const k of allKeys) {
  if (!proto[k]) {
    console.log(`[31mFAIL[0m  ${k.padEnd(10)}  missing in prototype`);
    failed += 1;
    continue;
  }
  if (!port[k]) {
    console.log(`[31mFAIL[0m  ${k.padEnd(10)}  missing in port`);
    failed += 1;
    continue;
  }
  if (proto[k] === port[k]) {
    console.log(`[32mOK  [0m  ${k.padEnd(10)}  ${proto[k].length} bytes`);
  } else {
    console.log(`[31mFAIL[0m  ${k.padEnd(10)}  byte-level mismatch`);
    console.log(`        prototype: ${proto[k]}`);
    console.log(`        port:      ${port[k]}`);
    failed += 1;
  }
}
console.log('────────────────────────────────────────────────────────────');
if (failed > 0) {
  console.log(`\n[31m${failed} icon(s) drifted from the prototype.[0m`);
  process.exit(1);
} else {
  console.log('\n[32mAll 28 icons match prototype byte-for-byte.[0m');
}
