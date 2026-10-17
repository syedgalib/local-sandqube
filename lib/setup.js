import fs from 'node:fs/promises';
import path from 'node:path';
import { exists, log, regularFile, resources } from './runtime.js';

export const templateFiles = ['nginx.conf.hbs', 'site.conf.hbs', 'includes/wordpress-single.conf.hbs'];

export async function setup(root, { dryRun = false } = {}) {
  const nginx = path.join(root, 'conf/nginx');
  const required = [...templateFiles, 'includes/wordpress-multi.conf.hbs', 'includes/restrictions.conf.hbs', 'includes/gzip.conf.hbs', 'includes/mime-types.conf.hbs'];
  for (const file of required) await regularFile(path.join(nginx, file), { noSymlink: templateFiles.includes(file) });
  const originals = new Map();
  const updates = new Map();
  for (const file of templateFiles) {
    const original = await fs.readFile(path.join(nginx, file));
    const replacement = await fs.readFile(path.join(resources, 'nginx', file));
    const mode = (await fs.stat(path.join(nginx, file))).mode & 0o777;
    originals.set(file, { content: original, mode });
    if (!original.equals(replacement)) updates.set(file, replacement);
  }
  log(`Local site: ${root}`);
  if (!updates.size) { log('Already configured. No files changed and no backup needed.'); return; }
  for (const file of updates.keys()) log(`Replace: conf/nginx/${file}`);
  if (dryRun) { log('Dry run complete. No site files changed.'); return; }

  const backupParent = path.join(root, 'conf/nginx-backups');
  await fs.mkdir(backupParent, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = await fs.mkdtemp(path.join(backupParent, `${stamp}-`));
  for (const [file, original] of originals) {
    await fs.mkdir(path.dirname(path.join(backup, file)), { recursive: true });
    await fs.writeFile(path.join(backup, file), original.content, { mode: original.mode });
  }
  log(`Original templates backed up to: ${backup}`);
  const stage = await fs.mkdtemp(path.join(nginx, '.sandqube-stage-'));
  const applied = [];
  try {
    for (const [file, content] of updates) {
      const staged = path.join(stage, file);
      await fs.mkdir(path.dirname(staged), { recursive: true });
      await fs.writeFile(staged, content, { mode: originals.get(file).mode });
      await fs.rename(staged, path.join(nginx, file));
      applied.push(file);
    }
  } catch (error) {
    for (const file of applied) {
      try {
        const { content, mode } = originals.get(file);
        await fs.writeFile(path.join(nginx, file), content, { mode });
      } catch { process.stderr.write(`Restore ${file} manually from ${backup}.\n`); }
    }
    throw error;
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
  log('Configuration installed. Stop and start this site in Local to activate it.');
  log('All subsites inherit the environment’s PHP mail transport and shared Mailpit inbox.');
}

export async function requireRouting(root) {
  const nginx = path.join(root, 'conf/nginx');
  const single = path.join(nginx, 'includes/wordpress-single.conf.hbs');
  const main = path.join(nginx, 'nginx.conf.hbs');
  if (!await exists(single) || !await exists(main)
      || !(await fs.readFile(single, 'utf8')).includes('@wordpress')
      || !(await fs.readFile(main, 'utf8')).includes('map $uri $wordpress_directory')) {
    throw new Error('Run local-sandqube setup for this root and restart the Local site before creating subsites.');
  }
}
