import matter from 'gray-matter';

import { getObject, listObjects, listSpaces, objectExists } from '../s3.js';

const REQUIRED_GENERATED_FIELDS = ['title', 'source_type', 'sources', 'created', 'updated', 'type'] as const;
const VALID_TYPES = new Set(['source', 'entity', 'concept']);

type Issue = { file: string; field: string; message: string };

interface LintOpts {
  space?: string;
}

async function lintSpace(space: string): Promise<Issue[]> {
  const allKeys = await listObjects(`${space}/`);
  const keys = allKeys.filter(
    (k) => !k.startsWith(`${space}/raw/`) && k !== `${space}/index.md`,
  );

  const issues: Issue[] = [];

  for (const key of keys) {
    const raw = await getObject(key);
    const { data: fm } = matter(raw);

    // Only lint generated pages (authored pages have fewer requirements)
    if (fm.source_type !== 'generated') continue;

    for (const field of REQUIRED_GENERATED_FIELDS) {
      if (fm[field] === undefined || fm[field] === null || fm[field] === '') {
        issues.push({ file: key, field, message: `missing required field: ${field}` });
      }
    }

    if (fm.source_type && fm.source_type !== 'generated') {
      issues.push({ file: key, field: 'source_type', message: `expected "generated", got "${fm.source_type}"` });
    }

    if (fm.type && !VALID_TYPES.has(fm.type)) {
      issues.push({ file: key, field: 'type', message: `invalid type "${fm.type}", expected source|entity|concept` });
    }

    if (Array.isArray(fm.sources)) {
      for (const src of fm.sources) {
        const exists = await objectExists(String(src));
        if (!exists) {
          issues.push({ file: key, field: 'sources', message: `referenced source "${src}" not found` });
        }
      }
    }
  }

  return issues;
}

export async function lint(opts: LintOpts = {}): Promise<boolean> {
  const spaces = opts.space ? [opts.space] : await listSpaces();

  if (spaces.length === 0) {
    console.log('No spaces found. Nothing to lint.');
    return true;
  }

  let totalIssues = 0;
  let totalFiles = 0;

  for (const space of spaces) {
    const issues = await lintSpace(space);
    const allKeys = await listObjects(`${space}/`);
    const pageCount = allKeys.filter(
      (k) => !k.startsWith(`${space}/raw/`) && k !== `${space}/index.md`,
    ).length;
    totalFiles += pageCount;

    if (issues.length === 0) {
      console.log(`  ✓ ${space}/ — ${pageCount} page(s), no issues`);
    } else {
      console.log(`  ✗ ${space}/ — ${issues.length} issue(s):`);
      for (const issue of issues) {
        console.log(`      ${issue.file} [${issue.field}] ${issue.message}`);
      }
      totalIssues += issues.length;
    }
  }

  console.log(`\nLinted ${totalFiles} page(s) across ${spaces.length} space(s).`);
  if (totalIssues > 0) {
    console.log(`${totalIssues} issue(s) found.`);
    return false;
  }
  console.log('All pages pass.');
  return true;
}
