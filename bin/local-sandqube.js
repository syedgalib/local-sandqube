#!/usr/bin/env node
import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { rootPath } from '../lib/runtime.js';
import { setup } from '../lib/setup.js';
import { createSite } from '../lib/site.js';
import { createBlueprint } from '../lib/blueprint.js';

const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const usage = `Local Sandqube ${version}

Usage:
  local-sandqube setup [ROOT] [--dry-run] [--root PATH]
  local-sandqube create-site DATABASE_NAME [BLUEPRINT] [--root PATH]
  local-sandqube create-blueprint SITE_DIRECTORY BLUEPRINT_NAME [--root PATH]

Commands:
  setup             Configure Nginx for independent WordPress folders.
  create-site    Create a site from a blueprint (default: wp).
  create-blueprint  Capture an existing site's files and database.

Options:
  --root PATH, -r PATH  Local site root; defaults to the current terminal directory.
  --dry-run            Preview setup changes without modifying the site.
  --help, -h           Show help, including command-specific help.
  --version, -v        Show the package version.

Examples (after publishing the package):
  npx local-sandqube setup
  npx local-sandqube create-site my_project
  npx local-sandqube create-site another_project my-template --root "/path/to/local-site"
  npx local-sandqube create-blueprint my-project my-template

Blueprints live in ROOT/local-sandqube/blueprints, never in the npx cache.
`;

const details = {
  setup: `setup [ROOT] [--dry-run] [--root PATH]
Backs up and replaces three Nginx templates. Stop and start the site in Local
after applying. PHP, Mailpit, databases, and WordPress files are preserved.
ROOT is optional; --root is supported before or after the command.`,
  'create-site': `create-site DATABASE_NAME [BLUEPRINT] [--root PATH]
DATABASE_NAME: required; normalized to lowercase a-z, 0-9, underscores; max 64.
BLUEPRINT: optional exact directory name in ROOT/local-sandqube/blueprints; default wp.
Underscores become dashes in the new folder, email domain, and HTTPS URL path.
Defaults: title-cased database name, admin / 123, admin@normalized-name.com,
and search engine indexing enabled. Existing databases and folders are rejected.
Imports BLUEPRINT/db/db.sql when present and migrates old URLs, including serialized data.
Otherwise installs a fresh database. A missing default wp blueprint is downloaded
from official WordPress core, matching the parent site's WordPress version.
Start Local first and run setup once, then restart Local to activate routing.`,
  'create-blueprint': `create-blueprint SITE_DIRECTORY BLUEPRINT_NAME [--root PATH]
Both names are required, used exactly as provided, and must be single directory names.
SITE_DIRECTORY: existing installed WordPress folder directly inside ROOT/app/public.
BLUEPRINT_NAME: new unique directory in ROOT/local-sandqube/blueprints.
Copies the full installation to site/ and exports its configured database to db/db.sql.
Existing blueprint names are rejected. Source files and database contents are preserved.
Start Local first. Quote names containing spaces.`,
};

export function parse(argv, cwd = process.cwd()) {
  let command;
  let root;
  let dryRun = false;
  let help = false;
  let showVersion = false;
  let literal = false;
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!literal && arg === '--') { literal = true; continue; }
    if (!literal && ['--root', '-r'].includes(arg)) {
      if (root !== undefined) throw new Error('Specify --root only once.');
      if (!argv[i + 1] || argv[i + 1].startsWith('-')) throw new Error('--root requires a path.');
      root = argv[++i]; continue;
    }
    if (!literal && arg.startsWith('--root=')) {
      if (root !== undefined || arg === '--root=') throw new Error('Specify one nonempty --root path.');
      root = arg.slice(7); continue;
    }
    if (!literal && ['--help', '-h'].includes(arg)) { help = true; continue; }
    if (!literal && ['--version', '-v'].includes(arg)) { showVersion = true; continue; }
    if (!literal && arg === '--dry-run') { dryRun = true; continue; }
    if (!literal && arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    if (!command) command = arg; else args.push(arg);
  }
  if (command && !Object.hasOwn(details, command)) throw new Error(`Unknown command: ${command}`);
  if (help || showVersion || !command) return { command, help: help || !command, showVersion };
  if (dryRun && command !== 'setup') throw new Error('--dry-run is only supported by setup.');
  const maximum = command === 'setup' ? 1 : 2;
  const minimum = command === 'setup' ? 0 : command === 'create-site' ? 1 : 2;
  if (args.length < minimum || args.length > maximum) throw new Error(`Usage: local-sandqube ${details[command].split('\n')[0]}`);
  if (command === 'setup' && args.length) {
    if (root !== undefined) throw new Error('Use either setup ROOT or --root PATH, not both.');
    root = args.shift();
  }
  return { command, args, root: path.resolve(cwd, root ?? '.'), dryRun };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parse(argv);
  if (options.showVersion) { console.log(version); return; }
  if (options.help) {
    console.log(options.command ? `Usage: local-sandqube ${details[options.command]}\n` : usage);
    return;
  }
  const root = await rootPath(options.root);
  if (options.command === 'setup') await setup(root, options);
  if (options.command === 'create-site') await createSite(root, ...options.args);
  if (options.command === 'create-blueprint') await createBlueprint(root, ...options.args);
}

// Importing the parser in tests does not execute a command.
const invokedPath = process.argv[1] ? await realpath(path.resolve(process.argv[1])) : undefined;
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error) => {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
