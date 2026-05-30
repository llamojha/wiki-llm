import { getObject, objectExists, putObject } from '../s3.js';

interface InitOpts {
  space?: string;
}

const CONTEXT_FILES: Record<string, string> = {
  '_system/AGENTS.md': `---
title: Agents
type: context
---

# Agents

AI agents that operate on this vault.

## Ingest Agent

Transforms raw source documents into structured wiki pages.
- Reads from \`raw/\`
- Writes structured pages into \`generated/<space>/\`
- Maintains \`_system/indexes/<space>.md\` and \`_system/index.md\`
`,
  '_system/WIKI_RULES.md': `---
title: Wiki Rules
type: context
---

# Wiki Rules

## Frontmatter

Every page must have YAML frontmatter with:
- \`title\` — page title
- \`source_type\` — \`authored\`, \`uploaded\`, \`generated\`, or \`personal\`
- \`updated\` — ISO 8601 timestamp

Generated pages additionally require:
- \`type\` — \`source\`, \`entity\`, or \`concept\`
- \`sources\` — array of raw file keys this page was derived from
- \`created\` — ISO 8601 timestamp
- \`tags\` — array of tags

## Structure

- Shared raw inputs live in \`raw/\`
- Generated pages live in \`generated/<space>/\`
- Human-authored shared pages live in \`authored/<space>/\`
- User content lives under \`users/<user-id>/\`
- One topic per page
`,
  '_system/SOURCES.md': `---
title: Sources
type: context
---

# Sources

Registry of raw source documents and their ingest status.

| Space | Raw File | Status | Last Ingested |
|-------|----------|--------|---------------|
`,
  '_system/TASKS.md': `---
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
    // Create shared-scope space structure for the active provenance-root layout.
    const indexKey = `_system/indexes/${space}.md`;
    const exists = await objectExists(indexKey);
    if (exists) {
      console.log(`Space "${space}" already exists.`);
      return;
    }

    const indexContent = `---\ntitle: ${space.charAt(0).toUpperCase() + space.slice(1)} Index\ntype: nav\nupdated: ${new Date().toISOString()}\n---\n\n_No pages yet. Upload files to raw/ and process them into generated/${space}/ to get started._\n`;
    await putObject(indexKey, indexContent);
    await putObject('raw/.keep', '');
    await putObject(`generated/${space}/.keep`, '');
    await putObject(`authored/${space}/.keep`, '');
    await ensureStructureSpace(space);
    console.log(`✓ Space "${space}" created with raw/, generated/${space}/, authored/${space}/, and _system index`);
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

async function ensureStructureSpace(space: string): Promise<void> {
  const key = '_system/structure.json';
  let structure: {
    version: 2;
    roots: { raw: string; generated: string; authored: string; users: string; system: string };
    defaultUser: string;
    users: Array<{
      id: string;
      label: string;
      default: boolean;
      prefix: string;
      root: string;
      roots: { raw: string; generated: string; authored: string; system: string };
    }>;
    spaces: Array<{ name: string; label: string; indexed: boolean; generated?: boolean; authored?: boolean }>;
  };
  try {
    const raw = await getObject(key);
    structure = JSON.parse(raw);
  } catch {
    structure = {
      version: 2,
      roots: {
        raw: 'raw/',
        generated: 'generated/',
        authored: 'authored/',
        users: 'users/',
        system: '_system/',
      },
      defaultUser: 'amllamojha',
      users: [
        {
          id: 'amllamojha',
          label: 'amllamojha',
          default: true,
          prefix: 'users/amllamojha/',
          root: 'users/amllamojha/',
          roots: {
            raw: 'users/amllamojha/raw/',
            generated: 'users/amllamojha/generated/',
            authored: 'users/amllamojha/authored/',
            system: 'users/amllamojha/_system/',
          },
        },
      ],
      spaces: [],
    };
  }
  if (!structure.spaces.some((entry) => entry.name === space)) {
    const label = space.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    structure.spaces.push({ name: space, label, indexed: true, generated: true, authored: true });
    await putObject(key, JSON.stringify(structure, null, 2));
  }
}
