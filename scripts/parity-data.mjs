#!/usr/bin/env node
// Deep data parity. For each of SHARED_TREE, PERSONAL_TREE, DOCS, SEARCH_INDEX,
// extract the literal block from prototype and port, normalize whitespace +
// strip TS type annotations, and compare byte-for-byte. Catches drift in any
// individual field value (name, meta, tag, checksum, snippet, score, …).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (p) => readFileSync(join(root, p), 'utf-8');

const PROTO = read('portal/data.jsx');
const PORT = read('web/lib/mock/data.ts');

function extractAfter(src, anchor, opener) {
  // Find the anchor, then return the slice from `opener` (searched AFTER the
  // anchor itself, so that a `TreeNode[]` annotation is skipped) up to the
  // matching closer at column 0 (`];` or `};`).
  const idx = src.indexOf(anchor);
  if (idx === -1) return '';
  const start = src.indexOf(opener, idx + anchor.length);
  if (start === -1) return '';
  const closer = opener === '[' ? '\n];' : '\n};';
  const end = src.indexOf(closer, start);
  if (end === -1) return '';
  return src.slice(start, end + closer.length);
}

function normalize(s) {
  return s
    // Strip line comments
    .replace(/\/\/[^\n]*/g, '')
    // Collapse all whitespace
    .replace(/\s+/g, ' ')
    // Remove trailing commas before closers
    .replace(/,\s*([\]}])/g, '$1')
    .trim();
}

const cases = [
  {
    name: 'SHARED_TREE',
    proto: extractAfter(PROTO, 'const SHARED_TREE', '['),
    port: extractAfter(PORT, 'SHARED_TREE: TreeNode[]', '['),
  },
  {
    name: 'PERSONAL_TREE',
    proto: extractAfter(PROTO, 'const PERSONAL_TREE', '['),
    port: extractAfter(PORT, 'PERSONAL_TREE: TreeNode[]', '['),
  },
  {
    name: 'DOCS',
    proto: extractAfter(PROTO, 'const DOCS', '{'),
    port: extractAfter(PORT, 'DOCS: Record<string, Doc>', '{'),
  },
  {
    name: 'SEARCH_INDEX',
    proto: extractAfter(PROTO, 'const SEARCH_INDEX', '['),
    port: extractAfter(PORT, 'SEARCH_INDEX: SearchHit[]', '['),
  },
];

let failed = 0;
console.log('Data field-level parity');
console.log('────────────────────────────────────────────────────────────');
for (const c of cases) {
  if (!c.proto || !c.port) {
    console.log(`[31mFAIL[0m  ${c.name.padEnd(14)}  could not extract block`);
    failed += 1;
    continue;
  }
  const a = normalize(c.proto);
  const b = normalize(c.port);
  if (a === b) {
    console.log(`[32mOK  [0m  ${c.name.padEnd(14)}  ${a.length} bytes`);
  } else {
    console.log(`[31mFAIL[0m  ${c.name.padEnd(14)}  proto=${a.length}b  port=${b.length}b`);
    // Find first differing position and print a small window.
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
    const ctx = 80;
    console.log(`        first diff at offset ${i}`);
    console.log(`        proto: …${a.slice(Math.max(0, i - ctx), i + ctx)}…`);
    console.log(`        port:  …${b.slice(Math.max(0, i - ctx), i + ctx)}…`);
    failed += 1;
  }
}
console.log('────────────────────────────────────────────────────────────');
if (failed > 0) {
  console.log(`\n[31m${failed} data block(s) drifted.[0m`);
  process.exit(1);
} else {
  console.log('\n[32mAll data blocks match prototype byte-for-byte.[0m');
}
