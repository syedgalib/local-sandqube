#!/usr/bin/env node
import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { rootPath, directory } from '../lib/runtime.js';
import { setup } from '../lib/setup.js';
import { createSite } from '../lib/site.js';
import { createBlueprint } from '../lib/blueprint.js';
import { installSkill, agentTypes } from '../lib/install-skill.js';

const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const usage = `Local Sandqube ${version}

Usage:
  local-sandqube help [COMMAND]
  local-sandqube install-skill AGENT [--root PATH]
  local-sandqube setup [ROOT] [--dry-run] [--root PATH]
  local-sandqube create-site DATABASE_NAME [BLUEPRINT] [--root PATH]
  local-sandqube create-blueprint SITE_DIRECTORY BLUEPRINT_NAME [--root PATH]

Commands:
  help              Show general or command-specific help.
  install-skill     Install the bundled skill for codex or claude.
  setup             Configure Nginx and prepare the default blueprint.
  create-site       Create a site from a blueprint (default: default).
  create-blueprint  Capture an existing site's files and database.

Options:
  --root PATH, -r PATH  Target root; defaults to the current terminal directory.
  --dry-run            Preview setup changes without modifying the site.
  --help, -h           Show help, including command-specific help.
  --version, -v        Show the package version.

Examples:
  npx local-sandqube install-skill codex
  npx local-sandqube install-skill claude --root "/path/to/local-site"
  npx local-sandqube setup
  npx local-sandqube create-site my_project
  npx local-sandqube create-site another_project my-template --root "/path/to/local-site"
  npx local-sandqube create-blueprint my-project my-template

Blueprints live in ROOT/local-sandqube/blueprints, never in the npx cache.
`;

const details = {
  'install-skill': `install-skill AGENT [--root PATH]
AGENT: required; accepted values: codex, claude (case-sensitive).
Installs the bundled Local Sandqube skill in the selected project directory:
  codex   .agents/skills/local-sandqube (includes Codex UI metadata)
  claude  .claude/skills/local-sandqube
Defaults to the current terminal directory; use --root PATH to select another directory.
Does not require a Local site layout, running Local services, PHP, or WP-CLI. Identical files are skipped.
Changed existing files are backed up under the agent's skill-backups directory.
Start a new agent session if the installed skill is not discovered.`,
  setup: `setup [ROOT] [--dry-run] [--root PATH]
Downloads WordPress and prepares default/site/wp-config.php when default is absent.
Existing default blueprints are preserved. --dry-run previews without downloading.
Backs up and replaces three Nginx templates. Stop and start the site in Local
after applying. PHP, Mailpit, databases, and WordPress files are preserved.
ROOT is optional; --root is supported before or after the command.`,
  'create-site': `create-site DATABASE_NAME [BLUEPRINT] [--root PATH]
DATABASE_NAME: required; normalized to lowercase a-z, 0-9, underscores; max 64.
BLUEPRINT: optional exact directory name in ROOT/local-sandqube/blueprints; defaults to "default".
Underscores become dashes in the new folder, email domain, and HTTPS URL path.
Defaults: title-cased database name, admin / 123, admin@normalized-name.com,
and search engine indexing enabled. Existing databases and folders are rejected.
Imports BLUEPRINT/db/db.sql when present and migrates old URLs, including serialized data.
Otherwise installs a fresh database. Run setup first to prepare the default
blueprint from official WordPress core, matching the parent site's version.
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
  if (argv[0] === 'help') argv = [...argv.slice(1), '--help'];
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
  const maximum = ['setup', 'install-skill'].includes(command) ? 1 : 2;
  const minimum = command === 'setup' ? 0 : ['create-site', 'install-skill'].includes(command) ? 1 : 2;
  if (args.length < minimum || args.length > maximum) throw new Error(`Usage: local-sandqube ${details[command].split('\n')[0]}`);
  if (command === 'install-skill' && !agentTypes.includes(args[0])) throw new Error('Agent must be codex or claude.');
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
  if (options.command === 'install-skill') {
    const root = await realpath(options.root);
    await directory(root);
    await installSkill(root, ...options.args);
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
