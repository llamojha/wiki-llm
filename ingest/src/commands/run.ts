import { getObject, listObjects } from '../s3.js';
import { planPages } from '../plan.js';
import { generatePages } from '../generate.js';
import { writePages } from '../write.js';
import { regenerateMasterIndex, regenerateSpaceIndex } from '../index-gen.js';
import { appendLog } from '../log.js';

interface RunOpts {
  dryRun?: boolean;
  space?: string;
}

async function processSpace(space: string, keys: string[], opts: RunOpts) {
  // Shared-scope raw files live under raw/; generated output is written under
  // generated/<space>/ to match the active Next.js/Lambda layout.
  const rawPrefix = 'raw/';
  let rawKeys: string[];
  if (keys.length > 0) {
    rawKeys = keys.map((k) => (k.startsWith(rawPrefix) ? k : `${rawPrefix}${k}`));
  } else {
    rawKeys = await listObjects(rawPrefix);
    if (rawKeys.length === 0) {
      console.log(`  No files in ${rawPrefix}. Skipping.`);
      return;
    }
  }

  console.log(`  ${rawKeys.length} file(s) to process\n`);

  // Read space index for context
  let indexContent = '';
  try {
    indexContent = await getObject(`_system/indexes/${space}.md`);
  } catch {
    // No index yet
  }

  for (const rawKey of rawKeys) {
    console.log(`  ── ${rawKey}`);
    const content = await getObject(rawKey);
    console.log(`     Read ${content.length} chars`);

    const plan = await planPages(content, indexContent, rawKey, space);
    console.log(`     Plan: ${plan.pages.length} page(s)`);
    for (const p of plan.pages) {
      console.log(`       ${p.action} ${p.type} → generated/${space}/${p.path}`);
    }

    if (opts.dryRun) {
      console.log('     [dry-run] Skipping generation.\n');
      continue;
    }

    const pages = await generatePages(plan, content, rawKey, space);
    console.log(`     Generated ${pages.length} page(s)`);

    await writePages(pages);
    await appendLog('ingest', rawKey, `Generated ${pages.length} page(s) in ${space}`);
    console.log('');
  }

  // Regen space index
  await regenerateSpaceIndex(space);
  console.log(`  ✓ _system/indexes/${space}.md regenerated`);
}

export async function run(keys: string[], opts: RunOpts) {
  const spaces = opts.space ? [opts.space] : await configuredSpaces();

  if (spaces.length === 0) {
    console.log('No spaces found. Run `pnpm ingest init --space <name>` to create one.');
    return;
  }

  for (const space of spaces) {
    console.log(`\n▸ Space: ${space}`);
    await processSpace(space, keys, opts);
  }

  if (!opts.dryRun) {
    await regenerateMasterIndex();
    console.log('\n✓ Master index.md regenerated');
  }

  console.log('\nDone.');
}

async function configuredSpaces(): Promise<string[]> {
  try {
    const raw = await getObject('_system/structure.json');
    const structure = JSON.parse(raw) as { spaces?: Array<{ name: string; generated?: boolean; indexed?: boolean }> };
    const generated = structure.spaces?.filter((space) => space.generated !== false && space.indexed !== false).map((space) => space.name) ?? [];
    if (generated.length) return generated;
  } catch {
    // Fall back to the default MVP ingest space.
  }
  return ['wiki'];
}
