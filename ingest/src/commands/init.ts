import { objectExists, putObject } from '../s3.js';

interface InitOpts {
  space?: string;
}

const CONTEXT_FILES: Record<string, string> = {
  'AGENTS.md': `---
title: Agents
type: context
---

# Agents

AI agents that operate on this vault.

## Ingest Agent

Transforms raw source documents into structured wiki pages.
- Reads from \`<space>/raw/\`
- Writes structured pages into the same space
- Maintains per-space and master \`index.md\`
`,
  'WIKI_RULES.md': `---
title: Wiki Rules
type: context
---

# Wiki Rules

## Frontmatter

Every page must have YAML frontmatter with:
- \`title\` — page title
- \`source_type\` — \`authored\`, \`uploaded\`, or \`generated\`
- \`updated\` — ISO 8601 timestamp

Generated pages additionally require:
- \`type\` — \`source\`, \`entity\`, or \`concept\`
- \`sources\` — array of raw file keys this page was derived from
- \`created\` — ISO 8601 timestamp
- \`tags\` — array of tags

## Structure

- Spaces are top-level folders
- Each space has a \`raw/\` subfolder for pending ingest
- AI proposes page placement within the space
- One topic per page
`,
  'SOURCES.md': `---
title: Sources
type: context
---

# Sources

Registry of raw source documents and their ingest status.

| Space | Raw File | Status | Last Ingested |
|-------|----------|--------|---------------|
`,
  'TASKS.md': `---
title: Tasks
type: context
---

# Tasks

- [ ] Create spaces for your content domains
- [ ] Upload raw documents to process
- [ ] Review generated pages for accuracy
`,
};

export async function init(opts: InitOpts = {}) {
  if (opts.space) {
    const space = opts.space;
    // Create space structure: folder marker + raw/ + index.md
    const indexKey = `${space}/index.md`;
    const exists = await objectExists(indexKey);
    if (exists) {
      console.log(`Space "${space}" already exists.`);
      return;
    }

    const indexContent = `---\ntitle: ${space.charAt(0).toUpperCase() + space.slice(1)} Index\ntype: nav\nupdated: ${new Date().toISOString()}\n---\n\n_No pages yet. Upload files to ${space}/raw/ to get started._\n`;
    await putObject(indexKey, indexContent);
    // Create a placeholder in raw/ so the folder exists in S3
    await putObject(`${space}/raw/.keep`, '');
    console.log(`✓ Space "${space}" created with raw/ and index.md`);
    return;
  }

  // Vault-level init: create AI context files at root
  let created = 0;
  for (const [filename, content] of Object.entries(CONTEXT_FILES)) {
    const exists = await objectExists(filename);
    if (exists) {
      console.log(`  ✓ ${filename} already exists`);
    } else {
      await putObject(filename, content);
      console.log(`  + ${filename} created`);
      created++;
    }
  }

  if (created === 0) {
    console.log('\nAll context files exist. Nothing to do.');
  } else {
    console.log(`\nCreated ${created} context file(s).`);
  }
}
