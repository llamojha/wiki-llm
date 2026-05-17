#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('ingest')
  .description('Transform raw S3 docs into structured wiki pages via Bedrock')
  .version('0.0.0');

program
  .command('run')
  .description('Ingest raw documents and generate wiki pages')
  .argument('[keys...]', 'S3 keys or glob patterns under raw/')
  .option('--dry-run', 'Print plan without writing anything')
  .option('--space <name>', 'Process only the specified space')
  .action(async (keys: string[], opts: { dryRun?: boolean; space?: string }) => {
    const { run } = await import('./commands/run.js');
    await run(keys, opts);
  });

program
  .command('add')
  .description('Upload a local file to a space and optionally run ingest')
  .argument('<files...>', 'Local file paths to upload')
  .requiredOption('--space <name>', 'Target space')
  .option('--no-ingest', 'Skip running ingest after upload')
  .action(async (files: string[], opts: { space: string; ingest: boolean }) => {
    const { add } = await import('./commands/add.js');
    await add(files, opts);
  });

program
  .command('init')
  .description('Initialize vault or a specific space')
  .option('--space <name>', 'Create a new space with raw/ and index.md')
  .action(async (opts: { space?: string }) => {
    const { init } = await import('./commands/init.js');
    await init(opts);
  });

program
  .command('lint')
  .description('Validate page structure and frontmatter')
  .option('--space <name>', 'Lint only the specified space')
  .action(async (opts: { space?: string }) => {
    const { lint } = await import('./commands/lint.js');
    const ok = await lint(opts);
    if (!ok) process.exit(1);
  });

program.parse();
