import fs from 'node:fs';
import path from 'node:path';
import { putObject } from '../s3.js';
import { run } from './run.js';

interface AddOpts {
  space: string;
  ingest: boolean;
}

export async function add(files: string[], opts: AddOpts) {
  const uploadedKeys: string[] = [];

  for (const file of files) {
    const filename = path.basename(file);
    const key = `raw/${filename}`;
    const body = fs.readFileSync(file, 'utf-8');

    await putObject(key, body);
    console.log(`  + ${file} → ${key}`);
    uploadedKeys.push(key);
  }

  console.log(`\nUploaded ${uploadedKeys.length} file(s) to raw/ for space "${opts.space}"`);

  if (opts.ingest) {
    console.log('\nRunning ingest...\n');
    await run(uploadedKeys, { space: opts.space });
  } else {
    console.log('\nSkipped ingest (--no-ingest). Run `pnpm ingest run --space ' + opts.space + '` to process.');
  }
}
