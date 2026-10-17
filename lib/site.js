import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import {
  blueprintDirectory, component, context, databaseName, directChild, exists,
  log, regularFile, wordpressFiles, commandPath, copyContents,
} from './runtime.js';
import { requireRouting } from './setup.js';

export function settings(input, home) {
  const database = databaseName(input);
  const folder = database.replaceAll('_', '-');
  const source = new URL(home);
  if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password || source.search || source.hash) {
    throw new Error('The parent WordPress home URL must be an HTTP or HTTPS URL without credentials, query, or fragment.');
  }
  source.protocol = 'https:';
  source.pathname = `${source.pathname.replace(/\/+$/, '')}/${folder}`;
  return {
    database, folder, url: source.href.replace(/\/$/, ''),
    title: database.replaceAll('_', ' ').replace(/(^| )([a-z])/g, (_, space, letter) => space + letter.toUpperCase()),
    email: `admin@${folder}.com`,
  };
}

export async function validateDump(file) {
  await regularFile(file);
  if (!(await fs.stat(file)).size) throw new Error('Blueprint db/db.sql is empty.');
  const input = createReadStream(file);
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (/^\s*(?:\/\*!\d+\s*)?(?:(?:CREATE|ALTER|DROP)\s+(?:DATABASE|SCHEMA)\b|USE\s+)/i.test(line)) {
        throw new Error('Use a single-site table export without CREATE/ALTER/DROP DATABASE or USE statements. Capture one with create-blueprint.');
      }
    }
  } finally { lines.close(); input.destroy(); }
}

async function defaultBlueprint(ctx, root, parent) {
  const blueprints = await blueprintDirectory(root, { create: true });
  const target = path.join(blueprints, 'wp');
  if (await exists(target)) return;
  // A registry-installed CLI has no user blueprints bundled with it. Bootstrap
  // only the default wp blueprint from official core, matching the parent.
  const version = await ctx.wp(parent, ['core', 'version'], { capture: true });
  if (!/^[a-zA-Z0-9.+-]+$/.test(version)) throw new Error('Could not determine the parent WordPress version.');
  let owned = false;
  try {
    await fs.mkdir(target);
    owned = true;
    log(`Creating the default wp blueprint from WordPress ${version} (download required once).`);
    await ctx.wp(path.join(target, 'site'), ['core', 'download', `--version=${version}`]);
  } catch (error) {
    if (owned) await fs.rm(target, { recursive: true, force: true });
    throw error;
  }
}

export async function createSite(root, input, blueprint = 'wp') {
  const database = databaseName(input);
  component(blueprint, 'Blueprint');
  const parent = path.join(root, 'app/public');
  const folder = database.replaceAll('_', '-');
  const destination = path.join(parent, folder);
  await regularFile(path.join(parent, 'wp-config.php'));
  if (await exists(destination)) throw new Error(`Destination already exists: ${destination}`);
  await requireRouting(root);
  let blueprints = await blueprintDirectory(root);
  if (blueprint !== 'wp' && !await exists(path.join(blueprints, blueprint))) {
    throw new Error(`Blueprint not found: ${path.join(blueprints, blueprint)}`);
  }

  const ctx = await context(root);
  let databaseCreated = false;
  let directoryCreated = false;
  let complete = false;
  try {
    const info = await ctx.info(parent);
    const defaults = settings(database, info.home);
    if (blueprint === 'wp' && !await exists(path.join(blueprints, blueprint))) {
      await defaultBlueprint(ctx, root, parent);
      blueprints = await blueprintDirectory(root);
    }
    const source = await directChild(blueprints, blueprint, 'Blueprint');
    const site = path.join(source, 'site');
    if ((await fs.lstat(site)).isSymbolicLink()) throw new Error('The blueprint site directory must not be a symlink.');
    await wordpressFiles(site);
    const config = await exists(path.join(site, 'wp-config.php')) ? 'wp-config.php' : 'wp-config-sample.php';
    await regularFile(path.join(site, config), { noSymlink: true });
    const sql = path.join(source, 'db/db.sql');
    const importing = await exists(sql);
    if (importing) { await validateDump(sql); await commandPath('mysql', ctx.env); }

    const user = await ctx.wp(parent, ['config', 'get', 'DB_USER', '--type=constant'], { capture: true });
    const password = await ctx.wp(parent, ['config', 'get', 'DB_PASSWORD', '--type=constant'], { capture: true });
    const host = await ctx.wp(parent, ['config', 'get', 'DB_HOST', '--type=constant'], { capture: true });
    const staged = path.join(ctx.work, 'site');
    log(`Copying blueprint: ${blueprint}`);
    await fs.cp(site, staged, { recursive: true, dereference: false, verbatimSymlinks: true, force: false, errorOnExist: true });
    if (config !== 'wp-config.php') await fs.copyFile(path.join(staged, config), path.join(staged, 'wp-config.php'));
    const constants = {
      DB_NAME: database, DB_USER: user, DB_PASSWORD: password, DB_HOST: host,
      WP_HOME: defaults.url, WP_SITEURL: defaults.url, WP_ENVIRONMENT_TYPE: 'local', WP_CACHE_KEY_SALT: database,
    };
    const { randomBytes } = await import('node:crypto');
    for (const key of ['AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY', 'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT']) {
      constants[key] = randomBytes(32).toString('hex');
    }
    for (const [key, value] of Object.entries(constants)) {
      await ctx.wp(staged, ['config', 'set', key, value, '--type=constant', '--quiet']);
    }

    log(`Creating database: ${database}`);
    await ctx.helper(parent, 'database.php', { env: { SANDQUBE_DATABASE: database, SANDQUBE_DATABASE_ACTION: 'create' } });
    databaseCreated = true;
    await fs.mkdir(destination); // Exclusive reservation; existing sites are never replaced.
    directoryCreated = true;
    await copyContents(staged, destination);
    if (importing) {
      log(`Importing blueprint database: ${sql}`);
      await ctx.wp(destination, ['db', 'import', '-', '--defaults'], { input: sql });
      try { await ctx.wp(destination, ['core', 'is-installed']); }
      catch { throw new Error('Imported dump is not installed WordPress. Its table prefix must match the blueprint configuration.'); }
      await ctx.wp(destination, ['core', 'update-db', '--quiet']);
      const pattern = await ctx.helper(destination, 'source-urls.php', { capture: true });
      log(`Updating imported URL references to: ${defaults.url}`);
      await ctx.wp(destination, ['search-replace', pattern, defaults.url, '--regex', '--regex-delimiter=~', '--all-tables', '--precise', '--recurse-objects', '--report-changed-only']);
    } else {
      log(`Installing WordPress: ${defaults.url}`);
      await ctx.wp(destination, ['core', 'install', `--url=${defaults.url}`, `--title=${defaults.title}`,
        '--admin_user=admin', '--admin_password=123', `--admin_email=${defaults.email}`, '--skip-email']);
    }
    await ctx.helper(destination, 'apply-defaults.php', { env: {
      CREATE_SUBSITE_TITLE: defaults.title, CREATE_SUBSITE_URL: defaults.url, CREATE_SUBSITE_ADMIN_EMAIL: defaults.email,
    } });
    await ctx.wp(destination, ['core', 'is-installed']);
    complete = true;
    log(`\nSite ready: ${defaults.url}\nAdmin: ${defaults.url}/wp-admin/`);
    log(`Title: ${defaults.title}\nDatabase: ${database}\nFolder: ${destination}`);
    log(`Username: admin\nPassword: 123\nAdmin email: ${defaults.email}\nSearch engine indexing: enabled`);
  } finally {
    if (!complete) {
      if (databaseCreated) {
        try {
          await ctx.helper(parent, 'database.php', { cleanup: true, env: { SANDQUBE_DATABASE: database, SANDQUBE_DATABASE_ACTION: 'drop' } });
        } catch { process.stderr.write(`Could not remove the new database ${database}; remove it manually before retrying.\n`); }
      }
      if (directoryCreated) await fs.rm(destination, { recursive: true, force: true });
    }
    await ctx.dispose();
  }
}
