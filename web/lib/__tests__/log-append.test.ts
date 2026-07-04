import { beforeEach, describe, expect, it } from 'vitest';

import { appendLog } from '@/lib/log-append';
import { resolveScope } from '@/lib/scope';
import { __dump, __resetWith } from '@/lib/s3-mock';
import { logChatInteraction } from '@/lib/usage-log';
import { isDocumentKey } from '@/lib/vault-paths';

/**
 * Audit/usage logs write one object per event (MOCK_S3=1, set in
 * vitest.config.ts) so concurrent writers never lose each other's appends the
 * way a shared read-modify-write file did. These tests pin the new layout and
 * the lost-append regression.
 */

function keys(): string[] {
  return Object.keys(__dump());
}

describe('appendLog (object-per-event)', () => {
  beforeEach(() => {
    __resetWith({});
  });

  it('two rapid appends produce two distinct objects, both intact', async () => {
    await appendLog('created', 'authored/wiki/a.md', 'A');
    await appendLog('edited', 'authored/wiki/b.md', 'B');

    const logKeys = keys().filter((k) => k.startsWith('_system/log/'));
    expect(logKeys).toHaveLength(2);

    const store = __dump();
    const bodies = logKeys.map((k) => store[k]);
    expect(bodies.some((b) => b.includes('authored/wiki/a.md') && b.includes('"A"'))).toBe(true);
    expect(bodies.some((b) => b.includes('authored/wiki/b.md') && b.includes('"B"'))).toBe(true);
  });

  it('routes to the user scope when the doc key is user-scoped', async () => {
    await appendLog('created', 'users/alice/authored/personal/note.md', 'Note');
    const [key] = keys();
    expect(key.startsWith('users/alice/_system/log/')).toBe(true);
  });

  it('routes to the shared scope otherwise', async () => {
    await appendLog('deleted', 'generated/wiki/x.md', 'X');
    const [key] = keys();
    expect(key.startsWith('_system/log/')).toBe(true);
    expect(key.startsWith('users/')).toBe(false);
  });

  it('honors an explicit scope over the inferred one', async () => {
    await appendLog('curated', '', 'batch run', resolveScope({ scope: 'user', userId: 'bob' }));
    const [key] = keys();
    expect(key.startsWith('users/bob/_system/log/')).toBe(true);
  });

  it('never writes an object named log.md', async () => {
    await appendLog('created', 'authored/wiki/a.md', 'A');
    expect(keys().some((k) => k.endsWith('/log.md') || k === 'log.md')).toBe(false);
  });

  it('event objects are excluded from document listings', async () => {
    await appendLog('created', 'authored/wiki/a.md', 'A');
    const [key] = keys();
    expect(isDocumentKey(key)).toBe(false);
  });
});

describe('logChatInteraction (object-per-event)', () => {
  beforeEach(() => {
    __resetWith({});
  });

  it('writes one JSON object under _system/usage/ with the expected fields', async () => {
    await logChatInteraction({
      scope: resolveScope({ scope: 'shared' }),
      question: 'what is x?',
      answerChars: 42,
      citeCount: 2,
      toolCalls: 1,
      durationMs: 1234,
    });

    const usageKeys = keys().filter((k) => k.startsWith('_system/usage/'));
    expect(usageKeys).toHaveLength(1);
    expect(usageKeys[0].endsWith('.json')).toBe(true);

    const parsed = JSON.parse(__dump()[usageKeys[0]]);
    expect(parsed).toMatchObject({
      scope: 'shared',
      question: 'what is x?',
      answerChars: 42,
      citeCount: 2,
      toolCalls: 1,
      durationMs: 1234,
    });
    expect(typeof parsed.ts).toBe('string');
  });

  it('routes user-scoped chats under the user _system/usage/ prefix', async () => {
    await logChatInteraction({
      scope: resolveScope({ scope: 'user', userId: 'alice' }),
      question: 'q',
      answerChars: 1,
      citeCount: 0,
      toolCalls: 0,
      durationMs: 5,
    });
    const [key] = keys();
    expect(key.startsWith('users/alice/_system/usage/')).toBe(true);
  });

  it('never writes an object named usage-log.jsonl', async () => {
    await logChatInteraction({
      scope: resolveScope({ scope: 'shared' }),
      question: 'q',
      answerChars: 1,
      citeCount: 0,
      toolCalls: 0,
      durationMs: 5,
    });
    expect(keys().some((k) => k.endsWith('usage-log.jsonl'))).toBe(false);
  });
});
