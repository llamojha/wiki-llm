import { describe, it, expect } from '@jest/globals';
import { placementFromRawKey, sourcePageKey } from './paths.js';

describe('placementFromRawKey', () => {
  it('routes raw/projects/<X>/... → projects/<x>', () => {
    expect(placementFromRawKey('raw/projects/CodeMMORPG/PRD.md')).toBe('projects/codemmorpg');
    expect(placementFromRawKey('raw/projects/Atlas/docs/roadmap.md')).toBe('projects/atlas');
  });

  it('handles user-scoped raw keys (users/<id>/raw/projects/...)', () => {
    expect(placementFromRawKey('users/amllamojha/raw/projects/X/notes.md')).toBe('projects/x');
    expect(placementFromRawKey('users/some.user/raw/projects/CodeMMORPG/PRD.md')).toBe('projects/codemmorpg');
  });

  it('routes non-project top-level dirs to the dir name', () => {
    expect(placementFromRawKey('raw/people/john.md')).toBe('people');
    expect(placementFromRawKey('raw/notes/2026/q1.md')).toBe('notes');
    expect(placementFromRawKey('users/amllamojha/raw/tools/cli.md')).toBe('tools');
  });

  it('falls back to inbox when there is no sub-folder', () => {
    expect(placementFromRawKey('raw/random-note.md')).toBe('inbox');
    expect(placementFromRawKey('users/amllamojha/raw/note.md')).toBe('inbox');
  });

  it('falls back to inbox for unparseable keys', () => {
    expect(placementFromRawKey('')).toBe('inbox');
    expect(placementFromRawKey('not-a-raw-key.md')).toBe('inbox');
    expect(placementFromRawKey('generated/wiki/sources/foo.md')).toBe('inbox');
  });

  it('normalizes project names with non-ASCII / mixed punctuation', () => {
    expect(placementFromRawKey('raw/projects/NVNC-Idea-Reviewer/notes.md')).toBe('projects/nvnc-idea-reviewer');
    expect(placementFromRawKey('raw/projects/no_vibe_no_code/foo.md')).toBe('projects/no-vibe-no-code');
    expect(placementFromRawKey('raw/projects/codeingameW26/todo.md')).toBe('projects/codeingamew26');
  });

  it('collapses runs of slug-invalid chars and strips leading/trailing hyphens', () => {
    expect(placementFromRawKey('raw/projects/  weird  name  /foo.md')).toBe('projects/weird-name');
  });
});

describe('sourcePageKey', () => {
  it('builds the canonical sources/<placement>/<slug>.md path', () => {
    expect(sourcePageKey('generated/wiki/', 'projects/codemmorpg', 'adventureland-rebuild-prd-50375513'))
      .toBe('generated/wiki/sources/projects/codemmorpg/adventureland-rebuild-prd-50375513.md');
  });

  it('works for user-scoped prefixes', () => {
    expect(sourcePageKey('users/amllamojha/generated/wiki/', 'people', 'john-abc12345'))
      .toBe('users/amllamojha/generated/wiki/sources/people/john-abc12345.md');
  });

  it('does not double-slash if the prefix is already terminated', () => {
    const key = sourcePageKey('generated/wiki/', 'inbox', 'foo');
    expect(key).not.toMatch(/\/\//);
    expect(key).toBe('generated/wiki/sources/inbox/foo.md');
  });
});
