import matter from 'gray-matter';

import { fmStringOr } from '@/lib/frontmatter';
import { getStructure, spacesForScope } from '@/lib/vault-structure';
import {
  ConcurrencyError,
  getObject,
  getObjectWithETag,
  listObjects,
  putObject,
} from '@/lib/s3';
import { isDocumentKey } from '@/lib/vault-paths';
import { ensureVaultMode, vaultMode } from '@/lib/vault-mode';
import { htmlText, htmlTitle } from '@/lib/html';
import { inferScopeFromKey, resolveScope, type ScopePaths } from '@/lib/scope';

function toTitleCase(str: string): string {
  return str.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractSummary(content: string): string {
  return content
    .replace(/[#*_`>\[\]()!~|]/g, '')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 80);
}

async function buildLine(key: string): Promise<string> {
  const keyTitle = () => toTitleCase(key.replace(/^.*\//, '').replace(/\.(md|html)$/, ''));
  try {
    const raw = await getObject(key);
    if (key.endsWith('.html')) {
      // HTML has no frontmatter/Markdown body — derive title + summary from the
      // parsed document (plan 022).
      return `- ${key} — ${htmlTitle(raw) ?? keyTitle()} — ${htmlText(raw, 80)}`;
    }
    const { data, content } = matter(raw);
    const title = fmStringOr(data.title, keyTitle());
    const summary = extractSummary(content);
    return `- ${key} — ${title} — ${summary}`;
  } catch {
    return `- ${key} — ${keyTitle()} —`;
  }
}

/**
 * Folders-mode master catalog: one prefix-wide listing of every recognized
 * document, grouped by top-level folder (root-level docs under "Documents").
 * There is no per-space `structure.json` and no `users/` scope, so this always
 * writes the single shared `_system/index.md`. Same byte format as the
 * provenance master index (`## <Section>` + `- <key> — <title> — <summary>`)
 * so the agent's catalog reader is mode-agnostic.
 */
async function regenerateMasterIndexFolders(): Promise<void> {
  const keys = (await listObjects()).filter(isDocumentKey).sort();

  const groups = new Map<string, string[]>();
  for (const key of keys) {
    const slash = key.indexOf('/');
    const label = slash === -1 ? 'Documents' : toTitleCase(key.slice(0, slash));
    (groups.get(label) ?? groups.set(label, []).get(label)!).push(key);
  }

  const sections: string[] = [];
  for (const label of [...groups.keys()].sort()) {
    const groupKeys = groups.get(label)!;
    const lines: string[] = [];
    for (let i = 0; i < groupKeys.length; i += 20) {
      const batch = groupKeys.slice(i, i + 20);
      lines.push(...(await Promise.all(batch.map(buildLine))));
    }
    sections.push(`## ${label}\n${lines.join('\n')}`);
  }

  const body = `---\ntitle: Index\ntype: nav\nupdated: ${new Date().toISOString()}\n---\n\n${sections.join('\n\n')}\n`;
  await putObject(resolveScope({ scope: 'shared' }).systemKey('index.md'), body);
}

/** Assemble a space index file body from its doc lines. Single source of the
 *  byte format shared by the full rebuild and the incremental patch path. */
function spaceIndexBody(space: string, lines: string[]): string {
  return `---\ntitle: ${toTitleCase(space)} Index\ntype: nav\nupdated: ${new Date().toISOString()}\n---\n\n${lines.join('\n')}\n`;
}

/** Doc lines from an index file — the `- <key> — …` entries under the header. */
function parseIndexLines(raw: string): string[] {
  return raw.split('\n').filter((l) => l.startsWith('- '));
}

/** The key embedded in a `- <key> — <title> — <summary>` line. */
function keyOfIndexLine(line: string): string {
  const m = line.match(/^- (.+?) — /);
  return m ? m[1] : '';
}

/**
 * Order a full rebuild produces: generated docs first, then authored, each
 * lexicographic within its group (S3 ListObjectsV2 returns lexicographic
 * order, and `regenerate*Index` concatenates the two provenance listings).
 * `patchSpaceIndexForKey` inserts a new line at the matching position so the
 * patched file stays byte-equal to a full rebuild.
 */
function provenanceRank(key: string): number {
  return key.includes('/generated/') || key.startsWith('generated/') ? 0 : 1;
}
function indexKeyLess(a: string, b: string): boolean {
  const ra = provenanceRank(a);
  const rb = provenanceRank(b);
  return ra !== rb ? ra < rb : a < b;
}

/** Regenerate a single space's index.md inside the given scope. */
export async function regenerateSpaceIndex(
  space: string,
  scope: ScopePaths = resolveScope({ scope: 'shared' }),
): Promise<void> {
  // Per-space index files are a provenance artifact; folders mode keeps a single
  // master catalog only.
  await ensureVaultMode();
  if (vaultMode() === 'folders') return;
  const keys = [
    ...(await listObjects(scope.generatedPrefix(space))),
    ...(await listObjects(scope.authoredPrefix(space))),
  ].filter(isDocumentKey);

  const lines: string[] = [];
  for (let i = 0; i < keys.length; i += 20) {
    const batch = keys.slice(i, i + 20);
    lines.push(...(await Promise.all(batch.map(buildLine))));
  }

  await putObject(scope.systemKey(`indexes/${space}.md`), spaceIndexBody(space, lines));
}

/**
 * Upsert a single key's line in its space index with ONE document read,
 * instead of re-listing and re-reading the whole space. In-place replace for
 * an existing key; sorted insert for a new one. Falls back to a full rebuild
 * when the index file doesn't exist yet (first doc in a new space) or the
 * key's space can't be inferred.
 */
export async function patchSpaceIndexForKey(key: string): Promise<void> {
  const scope = inferScopeFromKey(key);
  const space = spaceFromKey(key);
  if (!space) return;
  const newLine = await buildLine(key); // one read, outside the CAS loop
  await applySpaceIndexPatch(space, scope, 'rebuild', (lines) => {
    const at = lines.findIndex((l) => keyOfIndexLine(l) === key);
    if (at >= 0) {
      lines[at] = newLine;
    } else {
      let ins = lines.findIndex((l) => indexKeyLess(key, keyOfIndexLine(l)));
      if (ins < 0) ins = lines.length;
      lines.splice(ins, 0, newLine);
    }
    return 'ok';
  });
}

/** Remove a single key's line from its space index (no document read). No-op
 *  when the index or space is absent. */
export async function removeKeyFromSpaceIndex(key: string): Promise<void> {
  const scope = inferScopeFromKey(key);
  const space = spaceFromKey(key);
  if (!space) return;
  await applySpaceIndexPatch(space, scope, 'skip', (lines) => {
    const idx = lines.findIndex((l) => keyOfIndexLine(l) === key);
    if (idx < 0) return 'nochange';
    lines.splice(idx, 1);
    return 'ok';
  });
}

type SpaceEditResult = 'ok' | 'nochange' | 'fallback';

/**
 * Read a space index, apply `edit` to its doc lines, and write back under an
 * ETag CAS with a single retry — the same race guard the master patch uses, so
 * two concurrent same-space writes can never drop each other's entry (each
 * would otherwise read the same file, insert only its own line, and last-writer
 * wins). On a lost race the fallback is a full `regenerateSpaceIndex`
 * (correct-but-slower). `onMissing` picks the behavior when no index exists yet:
 * `rebuild` (upsert — build it) or `skip` (remove — nothing to do).
 */
async function applySpaceIndexPatch(
  space: string,
  scope: ScopePaths,
  onMissing: 'rebuild' | 'skip',
  edit: (lines: string[]) => SpaceEditResult,
): Promise<void> {
  const indexKey = scope.systemKey(`indexes/${space}.md`);
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: string;
    let etag: string;
    try {
      ({ content: raw, etag } = await getObjectWithETag(indexKey));
    } catch {
      if (onMissing === 'rebuild') await regenerateSpaceIndex(space, scope);
      return;
    }
    const lines = parseIndexLines(raw);
    const result = edit(lines);
    if (result === 'nochange') return;
    if (result === 'fallback') {
      await regenerateSpaceIndex(space, scope);
      return;
    }
    try {
      await putObject(indexKey, spaceIndexBody(space, lines), etag);
      return;
    } catch (err) {
      if (err instanceof ConcurrencyError) continue; // re-read and retry once
      throw err;
    }
  }
  // Two writers raced us — a full rebuild lists live docs and is always correct.
  await regenerateSpaceIndex(space, scope);
}

/**
 * Regenerate any per-space and master indexes affected by a write to a single
 * key. Infers the scope from the key path (`users/<id>/...` → user scope; else
 * shared) and the space from the key segment after the provenance root.
 */
export async function regenerateIndexesForKey(key: string): Promise<void> {
  await ensureVaultMode();
  if (vaultMode() === 'folders') {
    // Folders mode has one flat catalog and no per-space CAS patching; a full
    // rebuild is cheap for the single-user MVP and always correct.
    await regenerateMasterIndexFolders();
    return;
  }
  await patchSpaceIndexForKey(key);
  await patchMasterIndexForKey(key);
}

/**
 * Index maintenance for a DELETED key: drop its line from the space index and
 * the master. Mirrors `regenerateIndexesForKey` but removes rather than upserts
 * (the document no longer exists to read).
 */
export async function removeKeyFromIndexes(key: string): Promise<void> {
  await ensureVaultMode();
  if (vaultMode() === 'folders') {
    await regenerateMasterIndexFolders();
    return;
  }
  await removeKeyFromSpaceIndex(key);
  await removeKeyFromMasterIndex(key);
}

function spaceFromKey(key: string): string | null {
  const userGenerated = key.match(/^users\/[^/]+\/generated\/([^/]+)\//);
  if (userGenerated) return userGenerated[1];
  const userAuthored = key.match(/^users\/[^/]+\/authored\/([^/]+)\//);
  if (userAuthored) return userAuthored[1];
  const sharedGenerated = key.match(/^generated\/([^/]+)\//);
  if (sharedGenerated) return sharedGenerated[1];
  const sharedAuthored = key.match(/^authored\/([^/]+)\//);
  if (sharedAuthored) return sharedAuthored[1];
  return null;
}

/**
 * Regenerate the master `index.md` for the given scope. Aggregates every
 * declared `indexed` space's content under that scope. The reserved `personal`
 * space is implicit (never declared) — it belongs in the user's own master
 * catalog but is excluded from the shared view.
 */
export async function regenerateMasterIndex(
  scope: ScopePaths = resolveScope({ scope: 'shared' }),
): Promise<void> {
  await ensureVaultMode();
  if (vaultMode() === 'folders') return regenerateMasterIndexFolders();

  const structure = await getStructure();
  const spaces = spacesForScope(structure, scope.scope, scope.userId)
    .filter((s) => s.indexed)
    .map((s) => s.name);
  // Personal is implicit — never in the declared list — so add it explicitly
  // for user scope so a user's personal docs stay in their master catalog.
  if (scope.scope === 'user' && !spaces.includes('personal')) {
    spaces.push('personal');
  }
  const sections: string[] = [];

  for (const space of spaces.sort()) {
    const keys = [
      ...(await listObjects(scope.generatedPrefix(space))),
      ...(await listObjects(scope.authoredPrefix(space))),
    ].filter(isDocumentKey);
    if (!keys.length) continue;

    const lines: string[] = [];
    for (let i = 0; i < keys.length; i += 20) {
      const batch = keys.slice(i, i + 20);
      lines.push(...(await Promise.all(batch.map(buildLine))));
    }
    sections.push(`## ${toTitleCase(space)}\n${lines.join('\n')}`);
  }

  const body = `---\ntitle: Index\ntype: nav\nupdated: ${new Date().toISOString()}\n---\n\n${sections.join('\n\n')}\n`;
  await putObject(scope.systemKey('index.md'), body);
}

// --- Incremental master-index patching ------------------------------------
//
// The master index is a shared, derived file; patching it in place is a
// read-modify-write, the same hazard class as plans 007/011. It is safe here
// because (a) the file is derived and self-heals on the next full reindex and
// (b) this is the single-user MVP. We still guard with an ETag compare-and-swap
// plus one retry, then fall back to a full `regenerateMasterIndex` — so a lost
// race degrades to correct-but-slower, never to corruption.

/** Bump the frontmatter `updated:` line in a master index's split lines. */
function bumpMasterUpdated(lines: string[]): void {
  const i = lines.findIndex((l) => l.startsWith('updated: '));
  if (i >= 0) lines[i] = `updated: ${new Date().toISOString()}`;
}

type MasterEditResult = 'ok' | 'nochange' | 'fallback';

/**
 * Read the master index, apply `edit` to its lines, and write back under an
 * ETag CAS with a single retry. `edit` returns `nochange` (write nothing),
 * `fallback` (the surgical patch can't stay byte-equal — do a full rebuild),
 * or `ok` (persist the mutated lines). A missing master or exhausted retries
 * also fall back to a full rebuild.
 */
async function applyMasterPatch(
  scope: ScopePaths,
  edit: (lines: string[]) => MasterEditResult,
): Promise<void> {
  const indexKey = scope.systemKey('index.md');
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: string;
    let etag: string;
    try {
      ({ content: raw, etag } = await getObjectWithETag(indexKey));
    } catch {
      await regenerateMasterIndex(scope);
      return;
    }
    const lines = raw.split('\n');
    const result = edit(lines);
    if (result === 'nochange') return;
    if (result === 'fallback') {
      await regenerateMasterIndex(scope);
      return;
    }
    bumpMasterUpdated(lines);
    try {
      await putObject(indexKey, lines.join('\n'), etag);
      return;
    } catch (err) {
      if (err instanceof ConcurrencyError) continue; // re-read and retry once
      throw err;
    }
  }
  // Two writers raced us — a full rebuild is always correct.
  await regenerateMasterIndex(scope);
}

/** The `[start+1, end)` doc-line range of the `## <label>` section, or null. */
function sectionRange(lines: string[], label: string): { start: number; end: number } | null {
  const start = lines.indexOf(`## ${label}`);
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && lines[end].startsWith('- ')) end++;
  return { start, end };
}

/**
 * Upsert one key's line in the master index with ONE document read. Falls back
 * to a full rebuild when the key's `## <space>` section doesn't exist yet (a
 * new space's first doc), which is where a surgical insert couldn't reproduce
 * section ordering.
 */
export async function patchMasterIndexForKey(key: string): Promise<void> {
  const scope = inferScopeFromKey(key);
  const space = spaceFromKey(key);
  if (!space) {
    await regenerateMasterIndex(scope);
    return;
  }
  const newLine = await buildLine(key);
  await applyMasterPatch(scope, (lines) => {
    const range = sectionRange(lines, toTitleCase(space));
    if (!range) return 'fallback';
    const docLines = lines.slice(range.start + 1, range.end);
    const at = docLines.findIndex((l) => keyOfIndexLine(l) === key);
    if (at >= 0) {
      docLines[at] = newLine;
    } else {
      let ins = docLines.findIndex((l) => indexKeyLess(key, keyOfIndexLine(l)));
      if (ins < 0) ins = docLines.length;
      docLines.splice(ins, 0, newLine);
    }
    lines.splice(range.start + 1, range.end - (range.start + 1), ...docLines);
    return 'ok';
  });
}

/**
 * Remove one key's line from the master index (no document read). If that
 * empties the section, fall back to a full rebuild so the now-empty
 * `## <space>` header is dropped (a full rebuild skips empty spaces).
 */
export async function removeKeyFromMasterIndex(key: string): Promise<void> {
  const scope = inferScopeFromKey(key);
  const space = spaceFromKey(key);
  if (!space) return;
  await applyMasterPatch(scope, (lines) => {
    const range = sectionRange(lines, toTitleCase(space));
    if (!range) return 'nochange'; // key isn't catalogued — nothing to do
    const kept = lines.slice(range.start + 1, range.end).filter((l) => keyOfIndexLine(l) !== key);
    if (kept.length === (range.end - range.start - 1)) return 'nochange'; // not present
    if (kept.length === 0) return 'fallback'; // section empties — rebuild drops it
    lines.splice(range.start + 1, range.end - (range.start + 1), ...kept);
    return 'ok';
  });
}
