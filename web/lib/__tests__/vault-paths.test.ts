import { describe, expect, it } from 'vitest';

import {
  displayPathForKey,
  isDocumentKey,
  isHtmlKey,
  isKeyInSpace,
  sourceTypeFromKey,
} from '@/lib/vault-paths';

/**
 * Path classification underpins routing, search indexing, and display. These
 * pin the regex-heavy contracts everything else depends on.
 */
describe('isDocumentKey', () => {
  it('accepts the four content-root .md shapes', () => {
    for (const key of [
      'generated/wiki/a.md',
      'authored/wiki/a.md',
      'users/alice/generated/wiki/a.md',
      'users/alice/authored/personal/a.md',
    ]) {
      expect(isDocumentKey(key)).toBe(true);
    }
  });

  it('rejects non-.md keys', () => {
    expect(isDocumentKey('generated/wiki/a.txt')).toBe(false);
    expect(isDocumentKey('authored/wiki/image.png')).toBe(false);
  });

  it('rejects raw/ and _system/ roots (shared and per-user)', () => {
    expect(isDocumentKey('raw/a.md')).toBe(false);
    expect(isDocumentKey('_system/a.md')).toBe(false);
    expect(isDocumentKey('users/alice/raw/a.md')).toBe(false);
    expect(isDocumentKey('users/alice/_system/a.md')).toBe(false);
  });

  it('rejects reserved filenames and .keep markers', () => {
    expect(isDocumentKey('generated/wiki/index.md')).toBe(false);
    expect(isDocumentKey('generated/wiki/log.md')).toBe(false);
    expect(isDocumentKey('generated/wiki/log-2026.md')).toBe(false);
    expect(isDocumentKey('generated/wiki/.keep')).toBe(false);
  });
});

/**
 * HTML is browse/upload-only (plan 022 §1). The Markdown mutation guards (PUT
 * editor, star PATCH) use this to reject `.html` keys so they never inject YAML
 * frontmatter into an HTML object.
 */
describe('isHtmlKey', () => {
  it('is true only for .html keys', () => {
    expect(isHtmlKey('notes/page.html')).toBe(true);
    expect(isHtmlKey('authored/wiki/a.html')).toBe(true);
    expect(isHtmlKey('notes/page.md')).toBe(false);
    expect(isHtmlKey('page.htmlx')).toBe(false);
    expect(isHtmlKey('page.html.md')).toBe(false);
  });
});

describe('sourceTypeFromKey', () => {
  it('classifies generated (shared and per-user)', () => {
    expect(sourceTypeFromKey('generated/wiki/a.md')).toBe('generated');
    expect(sourceTypeFromKey('users/alice/generated/wiki/a.md')).toBe('generated');
  });

  it('classifies personal (per-user authored/personal)', () => {
    expect(sourceTypeFromKey('users/alice/authored/personal/a.md')).toBe('personal');
  });

  it('classifies authored (default)', () => {
    expect(sourceTypeFromKey('authored/wiki/a.md')).toBe('authored');
    expect(sourceTypeFromKey('users/alice/authored/wiki/a.md')).toBe('authored');
  });
});

describe('displayPathForKey', () => {
  it('strips content roots and joins with " / "', () => {
    expect(displayPathForKey('generated/wiki/onboarding.md')).toBe('wiki / onboarding');
    expect(displayPathForKey('authored/guides/setup/local.md')).toBe('guides / setup / local');
  });

  it('strips per-user generated/authored roots', () => {
    expect(displayPathForKey('users/alice/generated/wiki/a.md')).toBe('wiki / a');
    expect(displayPathForKey('users/alice/authored/guides/b.md')).toBe('guides / b');
  });

  it('special-cases the personal prefix (default user)', () => {
    // personalPrefix() resolves to the default user's authored/personal/.
    expect(displayPathForKey('users/default/authored/personal/notes/day.md')).toBe('notes / day');
  });
});

/**
 * Space membership backs the chat panel's "pin this conversation to a space"
 * control. In provenance mode a space is spread across `generated/` and
 * `authored/` and mirrored under `users/<id>/`, so all four shapes must match
 * the same name — while a *different* space with a shared prefix must not.
 */
describe('isKeyInSpace (provenance mode)', () => {
  it('matches all four provenance shapes of one space', () => {
    for (const key of [
      'generated/wiki/a.md',
      'authored/wiki/a.md',
      'users/alice/generated/wiki/a.md',
      'users/alice/authored/wiki/a.md',
    ]) {
      expect(isKeyInSpace(key, 'wiki')).toBe(true);
    }
  });

  it('matches nested documents inside the space', () => {
    expect(isKeyInSpace('generated/wiki/runbooks/oncall.md', 'wiki')).toBe(true);
  });

  it('rejects other spaces, including prefix look-alikes', () => {
    expect(isKeyInSpace('generated/notes/a.md', 'wiki')).toBe(false);
    expect(isKeyInSpace('generated/wiki-archive/a.md', 'wiki')).toBe(false);
  });

  it('does not match the space name outside a provenance root', () => {
    expect(isKeyInSpace('raw/wiki/a.md', 'wiki')).toBe(false);
    expect(isKeyInSpace('_system/indexes/wiki.md', 'wiki')).toBe(false);
  });

  it('treats an empty space name as no narrowing', () => {
    expect(isKeyInSpace('generated/notes/a.md', '')).toBe(true);
  });
});
