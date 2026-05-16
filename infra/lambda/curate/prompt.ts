const SYSTEM_PROMPT = `You are a wiki maintainer for a personal knowledge base stored as markdown files.
Process a new source document and integrate it into the existing wiki.

Output ONLY file contents in XML blocks — one block per file to create or update:
<file path="space/sources/slug.md">...content...</file>

Produce:
1. {space}/sources/<slug>.md — structured summary with YAML frontmatter
2. {space}/entities/<name>.md — one per significant person/org/product (create or update)
3. {space}/concepts/<name>.md — one per key idea/framework (create or update)
4. {space}/index.md — updated catalog (preserve all existing rows, add new ones)
5. overview.md — updated high-level synthesis reflecting this new source
6. log.md — full file with new entry appended at the bottom

Rules:
- Every page needs YAML frontmatter: title, type, tags, sources, created, updated
- Link between pages using [[Page Title]] wikilinks on first mention
- Slug = lowercase, hyphens only, no special characters
- You may create subfolders within the space as you see fit (people/, tools/, etc.)
- If updating an existing page, include the FULL updated content (not a diff)
- Flag contradictions with existing content using a > [!warning] callout
- Preserve ALL existing rows in index.md — only add new rows
- Preserve ALL existing log entries — only append the new one at the bottom
- Only create entity/concept pages for things substantive enough to warrant their own page
- Prefer fewer, higher-quality pages over many thin ones`;

export function buildSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function buildUserPrompt(opts: {
  space: string;
  rawKey: string;
  sourceContent: string;
  overviewContent: string;
  spaceIndexContent: string;
  recentLog: string;
  existingPageSummaries: string;
}): string {
  const date = new Date().toISOString().split('T')[0];

  return `Today's date: ${date}
Space: ${opts.space}

Source file: ${opts.rawKey}
--- SOURCE START ---
${opts.sourceContent}
--- SOURCE END ---

Current overview.md:
--- OVERVIEW ---
${opts.overviewContent || '(no overview yet — create one)'}
--- END OVERVIEW ---

Current ${opts.space}/index.md:
--- INDEX ---
${opts.spaceIndexContent || '(empty — first ingest in this space)'}
--- END INDEX ---

Current log.md (last 20 entries):
--- LOG ---
${opts.recentLog || '(empty log)'}
--- END LOG ---

Existing pages in "${opts.space}":
${opts.existingPageSummaries || '(none yet)'}

Process this source and output all new/updated wiki files.`;
}
