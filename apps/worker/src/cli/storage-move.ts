/**
 * Moves uploaded originals to another storage driver (M17, ADR-067), before STORAGE_DRIVER is
 * switched to it:
 *
 *   pnpm --filter @bizr/worker run storage:move -- --to s3 [--from postgres] [--dry-run]
 *
 * `--from` defaults to the current STORAGE_DRIVER. Nothing is deleted from the source; run it again
 * at any time (files already moved are checked, not copied). Exits 1 if any file is missing or
 * damaged, so it can gate the switch.
 */
import { closePools, moveStoredFiles, storageFor, type StorageDriver } from '@bizr/db';
import { getEnv } from '@bizr/platform';

const DRIVERS: readonly StorageDriver[] = ['local', 'postgres', 's3'];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const from = (arg('from') ?? getEnv().STORAGE_DRIVER) as StorageDriver;
  const to = arg('to') as StorageDriver | undefined;
  const dryRun = process.argv.includes('--dry-run');
  if (!to || !DRIVERS.includes(to) || !DRIVERS.includes(from) || from === to) {
    process.stderr.write(
      'Usage: storage:move -- --to <local|postgres|s3> [--from <driver>] [--dry-run]\n',
    );
    process.exit(2);
  }
  process.stdout.write(`${dryRun ? 'Checking' : 'Moving'} files from ${from} to ${to}\n`);
  const summary = await moveStoredFiles(storageFor(from), storageFor(to), {
    dryRun,
    onFile: (_, done, total) => {
      if (done % 50 === 0 || done === total) process.stdout.write(`  ${done} of ${total}\n`);
    },
  });
  process.stdout.write(
    `${summary.files} files: ${summary.copied} ${dryRun ? 'to copy' : 'copied'}, ${summary.present} already there\n`,
  );
  for (const k of summary.missing) process.stdout.write(`  missing everywhere: ${k}\n`);
  for (const k of summary.damaged) process.stdout.write(`  doesn't match its fingerprint: ${k}\n`);
  await closePools();
  if (summary.missing.length || summary.damaged.length) process.exit(1);
  if (!dryRun) process.stdout.write(`Done. You can now set STORAGE_DRIVER=${to}.\n`);
}

main().catch(async (err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  await closePools();
  process.exit(1);
});
