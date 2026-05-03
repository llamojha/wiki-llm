#!/usr/bin/env node
// Doc-body content parity. The JSX in DocBody can be reformatted across
// lines without changing the rendered output, so we don't compare byte-for-byte.
// We DO check:
//   1. Every backtick-template-literal block (code samples) is identical.
//   2. The set of "long" prose strings (sentences) is identical after normalize.
// If both pass, the user-visible content is the same.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (p) => readFileSync(join(root, p), 'utf-8');

const PROTO = read('portal/doc-bodies.jsx');
const PORT = read('web/lib/mock/doc-bodies.tsx');

function templateLiterals(src) {
  // Match `…` template literals. We don't try to be clever about nested
  // backticks — the doc bodies don't use any.
  return [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
}

function proseTokens(src) {
  // Pull every >text< node from JSX. JSX text is the only reliable
  // source of user-visible content — single-quoted strings would mis-match
  // around contractions like `hasn't`, and double-quoted strings are mostly
  // JSX attributes (className/id), not user-visible prose. Data-attribute
  // strings are already covered by the byte-perfect data parity check.
  const tokens = new Set();
  const push = (s) => {
    const t = s.replace(/\s+/g, ' ').trim();
    if (t.length >= 4 && /[a-z]/i.test(t)) tokens.add(t);
  };
  for (const m of src.matchAll(/>([^<>{}`]+)</g)) push(m[1]);
  return [...tokens].sort();
}

function diffSets(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  return {
    onlyA: a.filter((x) => !sb.has(x)),
    onlyB: b.filter((x) => !sa.has(x)),
  };
}

let failed = 0;

console.log('Doc-body content parity');
console.log('────────────────────────────────────────────────────────────');

const protoTpls = templateLiterals(PROTO);
const portTpls = templateLiterals(PORT);
{
  const same =
    protoTpls.length === portTpls.length && protoTpls.every((t, i) => t === portTpls[i]);
  console.log(
    `${same ? '[32mOK  [0m' : '[31mFAIL[0m'}  template literals     prototype=${protoTpls.length}  port=${portTpls.length}`,
  );
  if (!same) {
    failed += 1;
    for (let i = 0; i < Math.max(protoTpls.length, portTpls.length); i += 1) {
      if (protoTpls[i] !== portTpls[i]) {
        console.log(`        #${i} differs`);
        console.log(`          proto: ${JSON.stringify(protoTpls[i] ?? null).slice(0, 120)}`);
        console.log(`          port:  ${JSON.stringify(portTpls[i] ?? null).slice(0, 120)}`);
      }
    }
  }
}

const protoProse = proseTokens(PROTO);
const portProse = proseTokens(PORT);
{
  const { onlyA, onlyB } = diffSets(protoProse, portProse);
  const same = onlyA.length === 0 && onlyB.length === 0;
  console.log(
    `${same ? '[32mOK  [0m' : '[31mFAIL[0m'}  prose tokens          prototype=${protoProse.length}  port=${portProse.length}`,
  );
  if (!same) {
    failed += 1;
    if (onlyA.length) {
      console.log(`        only in prototype (${onlyA.length}):`);
      for (const t of onlyA.slice(0, 8)) console.log(`          ${JSON.stringify(t)}`);
      if (onlyA.length > 8) console.log(`          … and ${onlyA.length - 8} more`);
    }
    if (onlyB.length) {
      console.log(`        only in port (${onlyB.length}):`);
      for (const t of onlyB.slice(0, 8)) console.log(`          ${JSON.stringify(t)}`);
      if (onlyB.length > 8) console.log(`          … and ${onlyB.length - 8} more`);
    }
  }
}

console.log('────────────────────────────────────────────────────────────');
if (failed > 0) {
  console.log(`\n[31m${failed} doc-body check(s) failed.[0m`);
  process.exit(1);
} else {
  console.log('\n[32mDoc-body code blocks and prose tokens match prototype.[0m');
}
