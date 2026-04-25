#!/usr/bin/env node
// Phase 1 / Step 4 parity check. Compares overlay components — SearchPalette,
// Editor, ChatPanel — against the prototype. ChatPanel's port is split across
// two files (chat-panel.tsx + canned-replies.tsx); the prototype keeps the
// canned replies inline, so we concatenate the port files for comparison.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (p) => readFileSync(join(root, p), 'utf-8');

const PROTO_APP = read('portal/app.jsx');
const PROTO_CHAT = read('portal/chat.jsx');

const PORT_PALETTE = read('web/components/search-palette.tsx');
const PORT_EDITOR = read('web/components/editor.tsx');
const PORT_CHAT = read('web/components/chat-panel.tsx');
const PORT_REPLIES = read('web/lib/canned-replies.tsx');

function extractFn(src, name) {
  const re = new RegExp(`function ${name}\\b[^)]*\\)[^{]*\\{`);
  const m = src.match(re);
  if (!m) return '';
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  while (i < src.length && depth > 0) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') depth -= 1;
    i += 1;
  }
  return src.slice(start, i - 1);
}

function stripTsGenerics(src) {
  let prev;
  let cur = src;
  do {
    prev = cur;
    cur = cur.replace(/\b(\w+)<[^<>()]+>/g, '$1');
  } while (cur !== prev);
  return cur;
}

function classNames(src) {
  const out = new Set();
  for (const m of src.matchAll(/className="([^"]+)"/g)) out.add(m[1]);
  for (const m of src.matchAll(/className=\{['"]([^'"]+)['"]\}/g)) out.add(m[1]);
  for (const m of src.matchAll(/className=\{['"]([\w- ]+)['"]\s*\+/g)) out.add(m[1]);
  for (const m of src.matchAll(/['"]([\w- ]+)['"]\s*\+\s*\(/g)) out.add(m[1]);
  for (const m of src.matchAll(/\?\s*['"]([\w- ]*)['"]\s*:\s*['"]([\w- ]*)['"]/g)) {
    if (m[1]) out.add(m[1]);
    if (m[2]) out.add(m[2]);
  }
  return [...out].filter((s) => s.trim()).sort();
}

function titles(src) {
  const out = new Set();
  for (const m of src.matchAll(/title="([^"]+)"/g)) out.add(m[1]);
  for (const m of src.matchAll(/title=\{['"]([^'"]+)['"]\}/g)) out.add(m[1]);
  return [...out].sort();
}

function placeholders(src) {
  const out = new Set();
  for (const m of src.matchAll(/placeholder="([^"]+)"/g)) out.add(m[1]);
  return [...out].sort();
}

function jsxText(src) {
  const cleaned = stripTsGenerics(src);
  const out = new Set();
  // Lookbehind: don't treat `=>` arrow as a JSX tag closer.
  for (const m of cleaned.matchAll(/(?<![=])>([^<>{}`]+)</g)) {
    const t = m[1].replace(/\s+/g, ' ').trim();
    if (t.length >= 2 && /[a-zA-Z]/.test(t)) out.add(t);
  }
  return [...out].sort();
}

function diffSets(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  return {
    onlyA: a.filter((x) => !sb.has(x)),
    onlyB: b.filter((x) => !sa.has(x)),
  };
}

function compareAspect(aspect, protoVals, portVals) {
  const { onlyA, onlyB } = diffSets(protoVals, portVals);
  const same = onlyA.length === 0 && onlyB.length === 0;
  console.log(
    `  ${same ? '[32mOK  [0m' : '[31mFAIL[0m'}  ${aspect.padEnd(12)}  prototype=${String(protoVals.length).padStart(3)}  port=${String(portVals.length).padStart(3)}`,
  );
  if (!same) {
    if (onlyA.length) {
      console.log(`        only in prototype: ${onlyA.slice(0, 6).map((s) => JSON.stringify(s)).join(', ')}${onlyA.length > 6 ? ` … (+${onlyA.length - 6})` : ''}`);
    }
    if (onlyB.length) {
      console.log(`        only in port:      ${onlyB.slice(0, 6).map((s) => JSON.stringify(s)).join(', ')}${onlyB.length > 6 ? ` … (+${onlyB.length - 6})` : ''}`);
    }
  }
  return same;
}

// For each overlay, compare the prototype's full source surface (function +
// any module-scope inline data) against the port's full source surface, which
// may be split across multiple files (component + extracted helpers). Token
// extractors only pick up className/title/placeholder/JSX-text, so type
// aliases and imports don't pollute the comparison.
const components = [
  {
    name: 'SearchPalette',
    proto: extractFn(PROTO_APP, 'SearchPalette'),
    port: PORT_PALETTE,
  },
  {
    name: 'Editor',
    proto: extractFn(PROTO_APP, 'Editor'),
    port: PORT_EDITOR,
  },
  {
    name: 'ChatPanel',
    proto: PROTO_CHAT,
    port: PORT_CHAT + '\n' + PORT_REPLIES,
  },
];

let failed = 0;
console.log('Phase 1 / Step 4 — overlay JSX surface parity');
console.log('────────────────────────────────────────────────────────────');
for (const c of components) {
  console.log(`\n${c.name}:`);
  if (!c.proto) {
    console.log(`  [31mFAIL[0m  could not locate ${c.name} in prototype`);
    failed += 1;
    continue;
  }
  if (!c.port) {
    console.log(`  [31mFAIL[0m  could not locate ${c.name} in port`);
    failed += 1;
    continue;
  }
  const aspects = [
    ['classNames', classNames(c.proto), classNames(c.port)],
    ['titles', titles(c.proto), titles(c.port)],
    ['placeholders', placeholders(c.proto), placeholders(c.port)],
    ['jsxText', jsxText(c.proto), jsxText(c.port)],
  ];
  for (const [aspect, a, b] of aspects) {
    if (!compareAspect(aspect, a, b)) failed += 1;
  }
}
console.log('\n────────────────────────────────────────────────────────────');
if (failed > 0) {
  console.log(`\n[31m${failed} aspect(s) drifted.[0m`);
  process.exit(1);
} else {
  console.log('\n[32mOverlay components match prototype JSX surface.[0m');
}
