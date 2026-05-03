#!/usr/bin/env node
// Phase 1 / Step 1 parity check: compares the structural surface of the
// JSX prototype (portal/) against the TypeScript port (web/lib/).
//
// Verifies that every ICON key, tree node ID, DOC key, search-index ID, and
// DocBody case from the prototype is present in the port — and vice versa.
// Pure textual comparison; no module loading. Run from repo root:
//
//   node scripts/parity-step1.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const read = (p) => readFileSync(join(root, p), 'utf-8');

const PROTO_DATA = read('portal/data.jsx');
const PROTO_BODIES = read('portal/doc-bodies.jsx');
const PORT_ICONS = read('web/lib/icons.tsx');
const PORT_DATA = read('web/lib/mock/data.ts');
const PORT_BODIES = read('web/lib/mock/doc-bodies.tsx');

function extractBlock(src, header) {
  // Matches up to the closing `};` (objects) or `];` (arrays) on its own line.
  const re = new RegExp(`${header}[\\s\\S]*?\\n[\\}\\]];`);
  const m = src.match(re);
  return m ? m[0] : '';
}

function iconKeysFrom(block) {
  return [...block.matchAll(/^\s{2}(\w+):\s/gm)].map((m) => m[1]);
}

function idsIn(block) {
  return [...block.matchAll(/id:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

function docKeysIn(block) {
  return [...block.matchAll(/^\s+['"]([^'"]+)['"]:\s*\{/gm)].map((m) => m[1]);
}

function bodyCasesIn(src) {
  return [...src.matchAll(/case\s+['"](\w+)['"]:/g)].map((m) => m[1]);
}

const protoIconBlock = extractBlock(PROTO_DATA, 'const ICONS = \\{');
const portIconBlock = extractBlock(PORT_ICONS, 'export const ICONS: Record<IconKey, ReactNode> = \\{');
const protoIcons = iconKeysFrom(protoIconBlock);
const portIcons = iconKeysFrom(portIconBlock);

const protoShared = extractBlock(PROTO_DATA, 'const SHARED_TREE = \\[');
const portShared = extractBlock(PORT_DATA, 'export const SHARED_TREE: TreeNode\\[\\] = \\[');
const protoSharedIds = idsIn(protoShared);
const portSharedIds = idsIn(portShared);

const protoPersonal = extractBlock(PROTO_DATA, 'const PERSONAL_TREE = \\[');
const portPersonal = extractBlock(PORT_DATA, 'export const PERSONAL_TREE: TreeNode\\[\\] = \\[');
const protoPersonalIds = idsIn(protoPersonal);
const portPersonalIds = idsIn(portPersonal);

const protoDocsBlock = extractBlock(PROTO_DATA, 'const DOCS = \\{');
const portDocsBlock = extractBlock(PORT_DATA, 'export const DOCS: Record<string, Doc> = \\{');
const protoDocs = docKeysIn(protoDocsBlock);
const portDocs = docKeysIn(portDocsBlock);

const protoSearch = extractBlock(PROTO_DATA, 'const SEARCH_INDEX = \\[');
const portSearch = extractBlock(PORT_DATA, 'export const SEARCH_INDEX: SearchHit\\[\\] = \\[');
const protoSearchIds = idsIn(protoSearch);
const portSearchIds = idsIn(portSearch);

const protoBodies = bodyCasesIn(PROTO_BODIES);
const portBodies = bodyCasesIn(PORT_BODIES);

let failed = 0;

function compare(label, a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  const same = a.length === b.length && a.every((x) => setB.has(x));
  const status = same ? '[32mOK  [0m' : '[31mFAIL[0m';
  console.log(`${status}  ${label.padEnd(22)}  prototype=${String(a.length).padStart(3)}  port=${String(b.length).padStart(3)}`);
  if (!same) {
    failed += 1;
    const onlyA = a.filter((x) => !setB.has(x));
    const onlyB = b.filter((x) => !setA.has(x));
    if (onlyA.length) console.log(`        only in prototype: ${onlyA.join(', ')}`);
    if (onlyB.length) console.log(`        only in port:      ${onlyB.join(', ')}`);
  }
}

console.log('Phase 1 / Step 1 — structural parity');
console.log('────────────────────────────────────────────────────────────');
compare('icons',              protoIcons,        portIcons);
compare('shared tree ids',    protoSharedIds,    portSharedIds);
compare('personal tree ids',  protoPersonalIds,  portPersonalIds);
compare('doc keys',           protoDocs,         portDocs);
compare('search index ids',   protoSearchIds,    portSearchIds);
compare('doc body cases',     protoBodies,       portBodies);
console.log('────────────────────────────────────────────────────────────');

if (failed > 0) {
  console.log(`\n[31m${failed} parity check(s) failed.[0m`);
  process.exit(1);
} else {
  console.log('\n[32mAll structural parity checks passed.[0m');
  console.log('Visual icon parity: open http://localhost:3000/dev/parity and compare to portal/index.html.');
}
