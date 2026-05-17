import { describe, it, expect } from '@jest/globals';
import { parseFileBlocks } from './parse.js';

describe('parseFileBlocks', () => {
  it('extracts multiple file blocks', () => {
    const input = `Here are the files:

<file path="articles/sources/my-article.md">
---
title: "My Article"
type: source
---

## Summary

This is a summary.
</file>

<file path="articles/entities/acme-corp.md">
---
title: "Acme Corp"
type: entity
---

Acme Corp is a company.
</file>`;

    const blocks = parseFileBlocks(input);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].path).toBe('articles/sources/my-article.md');
    expect(blocks[0].content).toContain('title: "My Article"');
    expect(blocks[0].content).toContain('This is a summary.');
    expect(blocks[1].path).toBe('articles/entities/acme-corp.md');
    expect(blocks[1].content).toContain('Acme Corp is a company.');
  });

  it('handles empty response', () => {
    expect(parseFileBlocks('')).toHaveLength(0);
    expect(parseFileBlocks('No file blocks here')).toHaveLength(0);
  });

  it('handles file block with markdown code fences inside', () => {
    const input = `<file path="concepts/event-sourcing.md">
---
title: "Event Sourcing"
---

## Example

\`\`\`typescript
const event = { type: 'created' };
\`\`\`
</file>`;

    const blocks = parseFileBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toContain('```typescript');
  });

  it('handles overview and log files', () => {
    const input = `<file path="overview.md">
# Knowledge Base Overview

This wiki covers articles about technology.
</file>

<file path="log.md">
## Log

- 2026-05-16: Ingested article1.md
- 2026-05-16: Ingested article2.md
</file>`;

    const blocks = parseFileBlocks(input);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].path).toBe('overview.md');
    expect(blocks[1].path).toBe('log.md');
  });

  it('preserves content whitespace faithfully', () => {
    const input = `<file path="test.md">
line 1

line 3
</file>`;

    const blocks = parseFileBlocks(input);
    expect(blocks[0].content).toBe('line 1\n\nline 3');
  });
});
