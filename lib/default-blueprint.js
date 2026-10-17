import fs from 'node:fs/promises';
import path from 'node:path';
import { blueprintDirectory, context, exists, log, regularFile, wordpressFiles } from './runtime.js';

export const defaultBlueprintName = 'default';

export async function ensureDefaultBlueprint(root, { dryRun = false, createContext = context } = {}) {
  const blueprints = await blueprintDirectory(root);
  const target = path.join(blueprints, defaultBlueprintName);
  if (await exists(target)) {
    log('Default blueprint already exists. Skipping blueprint creation.');
    return;
  }
  if (dryRun) {
    log(`Create blueprint: ${target} (download WordPress and generate site/wp-config.php).`);
    return;
  }

  const parent = path.join(root, 'app/public');
  await regularFile(path.join(parent, 'wp-config.php'));
  const ctx = await createContext(root);
  let owned = false;
  try {
    const version = await ctx.wp(parent, ['core', 'version'], { capture: true });
    if (!/^[a-zA-Z0-9.+-]+$/.test(version)) throw new Error('Could not determine the parent WordPress version.');
    const credentials = {};
    for (const key of ['DB_USER', 'DB_PASSWORD', 'DB_HOST']) {
      credentials[key] = await ctx.wp(parent, ['config', 'get', key, '--type=constant'], { capture: true });
    }
    await blueprintDirectory(root, { create: true });
    try { await fs.mkdir(target); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      log('Default blueprint already exists. Skipping blueprint creation.');
      return;
    }
    owned = true;
    const site = path.join(target, 'site');
    log(`Creating the default blueprint from WordPress ${version}.`);
    await ctx.wp(site, ['core', 'download', `--version=${version}`]);
    await ctx.wp(site, ['config', 'create', '--dbname=default',
      `--dbuser=${credentials.DB_USER}`, `--dbpass=${credentials.DB_PASSWORD}`,
      `--dbhost=${credentials.DB_HOST}`, '--skip-check', '--skip-salts']);
    await ctx.wp(site, ['config', 'set', 'WP_ENVIRONMENT_TYPE', 'local', '--type=constant', '--quiet']);
    await wordpressFiles(site, { installed: true });
    log(`Default blueprint ready: ${target}`);
  } catch (error) {
    if (owned) await fs.rm(target, { recursive: true, force: true });
    throw error;
  } finally {
    await ctx.dispose();
  }
}
