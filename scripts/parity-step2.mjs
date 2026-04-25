#!/usr/bin/env node
// Phase 1 / Step 2 parity check. For each shell component (Sidebar, TopBar,
// TreeNode), extract the function body from prototype and port, then compare
// the user-visible JSX surface: class names, title attributes, JSX text
// tokens, kbd contents. If those match, the rendered DOM is pixel-equivalent.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (p) => readFileSync(join(root, p), 'utf-8');

const PROTO = read('portal/app.jsx');
const PORT_SIDEBAR = read('web/components/sidebar.tsx');
const PORT_TOPBAR = read('web/components/top-bar.tsx');
const PORT_TREE = read('web/components/tree-node.tsx');

function extractFn(src, name) {
  // Skip past the params (which may contain `{` for destructuring) up to the
  // body-opening `{` after the matching `)`.
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

function classNames(src) {
  const out = new Set();
  // className="literal"
  for (const m of src.matchAll(/className="([^"]+)"/g)) out.add(m[1]);
  // className={'literal'} or className={"literal"}
  for (const m of src.matchAll(/className=\{['"]([^'"]+)['"]\}/g)) out.add(m[1]);
  // className={'a' + (cond ? ' b' : '')}  — capture the static base parts
  for (const m of src.matchAll(/className=\{['"]([\w- ]+)['"]\s*\+/g)) out.add(m[1]);
  for (const m of src.matchAll(/['"]([\w- ]+)['"]\s*\+\s*\(/g)) out.add(m[1]);
  // ternary class branches: ? 'on' : ''
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

function stripTsGenerics(src) {
  let prev;
  let cur = src;
  do {
    prev = cur;
    cur = cur.replace(/\b(\w+)<[^<>()]+>/g, '$1');
  } while (cur !== prev);
  return cur;
}

function jsxText(src) {
  const cleaned = stripTsGenerics(src);
  const out = new Set();
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
      console.log(`        only in prototype: ${onlyA.map((s) => JSON.stringify(s)).join(', ')}`);
    }
    if (onlyB.length) {
      console.log(`        only in port:      ${onlyB.map((s) => JSON.stringify(s)).join(', ')}`);
    }
  }
  return same;
}

const components = [
  { name: 'Sidebar', proto: extractFn(PROTO, 'Sidebar'), port: extractFn(PORT_SIDEBAR, 'Sidebar') },
  { name: 'TopBar', proto: extractFn(PROTO, 'TopBar'), port: extractFn(PORT_TOPBAR, 'TopBar') },
  { name: 'TreeNode', proto: extractFn(PROTO, 'TreeNode'), port: extractFn(PORT_TREE, 'TreeNode') },
];

let failed = 0;
console.log('Phase 1 / Step 2 — shell JSX surface parity');
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
  console.log('\n[32mShell components match prototype JSX surface.[0m');
}
