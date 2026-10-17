import fs from 'node:fs/promises';
import path from 'node:path';
import {
  blueprintDirectory, component, context, directChild, exists, log, wordpressFiles,
} from './runtime.js';

export async function createBlueprint(root, siteName, blueprintName) {
  component(siteName, 'Source site');
  component(blueprintName, 'Blueprint name');
  const source = await directChild(path.join(root, 'app/public'), siteName, 'Source site');
  await wordpressFiles(source, { installed: true });
  const blueprints = await blueprintDirectory(root);
  const destination = path.join(blueprints, blueprintName);
  if (await exists(destination)) throw new Error(`Blueprint name already exists: ${blueprintName}`);
  const ctx = await context(root, ['mysqldump']);
  let owned = false;
  let complete = false;
  try {
    await ctx.wp(source, ['core', 'is-installed']);
    const info = await ctx.info(source);
    await blueprintDirectory(root, { create: true });
    await fs.mkdir(destination); // Atomic uniqueness check, including concurrent invocations.
    owned = true;
    await fs.mkdir(path.join(destination, 'db'));
    log(`Copying WordPress files from: ${source}`);
    await fs.cp(source, path.join(destination, 'site'), { recursive: true, dereference: true, force: false, errorOnExist: true });
    const sql = path.join(destination, 'db/db.sql');
    log(`Exporting source database: ${info.database}`);
    await ctx.wp(source, ['db', 'export', sql, '--defaults', '--single-transaction', '--quick',
      '--skip-lock-tables', '--skip-add-locks', '--set-gtid-purged=OFF']);
    if (!(await fs.stat(sql)).size) throw new Error('Database export is empty.');
    complete = true;
    log(`\nBlueprint ready: ${destination}\nWordPress files: ${destination}/site\nDatabase export: ${sql}`);
  } finally {
    if (owned && !complete) {
      await fs.rm(destination, { recursive: true, force: true });
      process.stderr.write(`Incomplete blueprint removed: ${blueprintName}\n`);
    }
    await ctx.dispose();
  }
}
