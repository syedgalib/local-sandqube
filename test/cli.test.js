import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from '../bin/local-sandqube.js';
import { databaseName, component, exists, resources, copyContents } from '../lib/runtime.js';
import { settings, validateDump } from '../lib/site.js';
import { setup, templateFiles } from '../lib/setup.js';

const cli = fileURLToPath(new URL('../bin/local-sandqube.js', import.meta.url));
const fixture = async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'sandqube tests '));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'Local Site');
  await fs.mkdir(path.join(root, 'app/public'), { recursive: true });
  await fs.mkdir(path.join(root, 'conf/nginx/includes'), { recursive: true });
  for (const file of [...templateFiles, 'includes/wordpress-multi.conf.hbs', 'includes/restrictions.conf.hbs', 'includes/gzip.conf.hbs', 'includes/mime-types.conf.hbs']) {
    await fs.writeFile(path.join(root, 'conf/nginx', file), `# Original ${file}\n`, { mode: 0o640 });
  }
  return root;
};

test('all commands default to the caller directory, not the installed package', () => {
  const cwd = '/tmp/Caller Local Site';
  for (const args of [['setup'], ['create-site', 'my_project'], ['create-blueprint', 'my-project', 'new-template']]) {
    assert.equal(parse(args, cwd).root, cwd);
  }
});

test('explicit roots work before or after every command and resolve relative to cwd', () => {
  const cwd = '/tmp';
  for (const command of [['setup'], ['create-site', 'my_project'], ['create-blueprint', 'my-project', 'template']]) {
    assert.equal(parse(['--root', 'Local Site', ...command], cwd).root, '/tmp/Local Site');
    assert.equal(parse([...command, '--root=Local Site'], cwd).root, '/tmp/Local Site');
    assert.equal(parse([...command, '-r', 'Local Site'], cwd).root, '/tmp/Local Site');
  }
  assert.equal(parse(['setup', 'Local Site'], cwd).root, '/tmp/Local Site');
});

test('invalid arguments fail before any command runs', () => {
  for (const args of [
    ['create-site'], ['create-blueprint', 'only-one'], ['unknown'],
    ['setup', '--root'], ['setup', '--root', 'x', '--root', 'y'],
    ['setup', 'a', '--root', 'b'], ['create-site', 'a', '--dry-run'],
    ['create-site', 'a', 'b', 'extra'], ['setup', '--unknown'],
  ]) assert.throws(() => parse(args));
});

test('normalization keeps database underscores and uses dashes for paths and email', () => {
  assert.deepEqual(settings('My_Project_2', 'http://sandbox.local/'), {
    database: 'my_project_2', folder: 'my-project-2', url: 'https://sandbox.local/my-project-2',
    title: 'My Project 2', email: 'admin@my-project-2.com',
  });
  for (const bad of ['', 'x-y', '../x', 'x;DROP', 'a'.repeat(65), 'K']) assert.throws(() => databaseName(bad));
  for (const bad of ['', '.', '..', '/tmp/x', 'x\\y', 'x\0y']) assert.throws(() => component(bad, 'Name'));
  assert.equal(component('Template With Spaces', 'Name'), 'Template With Spaces');
  assert.throws(() => settings('valid', 'https://user:pass@example.local/'));
});

test('setup dry run leaves the root unchanged and does not require WordPress tools', async (t) => {
  const root = await fixture(t);
  const before = await fs.readFile(path.join(root, 'conf/nginx/nginx.conf.hbs'));
  await setup(root, { dryRun: true });
  assert.deepEqual(await fs.readFile(path.join(root, 'conf/nginx/nginx.conf.hbs')), before);
  assert.equal(await exists(path.join(root, 'conf/nginx-backups')), false);
});

test('setup installs exact templates with backups, preserves modes, and is idempotent', async (t) => {
  const root = await fixture(t);
  await setup(root);
  const backupParent = path.join(root, 'conf/nginx-backups');
  const [backup] = await fs.readdir(backupParent);
  for (const file of templateFiles) {
    assert.deepEqual(await fs.readFile(path.join(root, 'conf/nginx', file)), await fs.readFile(path.join(resources, 'nginx', file)));
    assert.equal(await fs.readFile(path.join(backupParent, backup, file), 'utf8'), `# Original ${file}\n`);
    assert.equal((await fs.stat(path.join(root, 'conf/nginx', file))).mode & 0o777, 0o640);
  }
  await setup(root);
  assert.equal((await fs.readdir(backupParent)).length, 1);
});

test('partial setup failure restores original files', async (t) => {
  const root = await fixture(t);
  const rename = fs.rename.bind(fs);
  let calls = 0;
  t.mock.method(fs, 'rename', async (...args) => {
    if (++calls === 2) throw new Error('Simulated filesystem failure');
    return rename(...args);
  });
  await assert.rejects(setup(root), /Simulated filesystem failure/);
  for (const file of templateFiles) assert.equal(await fs.readFile(path.join(root, 'conf/nginx', file), 'utf8'), `# Original ${file}\n`);
  assert.equal((await fs.readdir(path.join(root, 'conf/nginx'))).some((name) => name.startsWith('.sandqube-stage-')), false);
});

test('setup refuses template symlinks', async (t) => {
  const root = await fixture(t);
  const template = path.join(root, 'conf/nginx/site.conf.hbs');
  await fs.unlink(template);
  await fs.symlink('nginx.conf.hbs', template);
  await assert.rejects(setup(root), /symlink/);
});

test('site files copy into an exclusively reserved folder, including hidden files, without replacing existing files', async (t) => {
  const root = await fixture(t);
  const source = path.join(root, 'source');
  const destination = path.join(root, 'destination');
  await fs.mkdir(source); await fs.mkdir(destination);
  await fs.writeFile(path.join(source, '.hidden'), 'marker');
  await fs.mkdir(path.join(source, 'wp-content'));
  await fs.writeFile(path.join(source, 'wp-content/data.txt'), 'data');
  await copyContents(source, destination);
  assert.equal(await fs.readFile(path.join(destination, '.hidden'), 'utf8'), 'marker');
  assert.equal(await fs.readFile(path.join(destination, 'wp-content/data.txt'), 'utf8'), 'data');
  await fs.writeFile(path.join(destination, '.hidden'), 'keep existing');
  await assert.rejects(copyContents(source, destination));
  assert.equal(await fs.readFile(path.join(destination, '.hidden'), 'utf8'), 'keep existing');
});

test('SQL validation accepts table dumps and rejects database switching or empty exports', async (t) => {
  const root = await fixture(t);
  const sql = path.join(root, 'dump.sql');
  await fs.writeFile(sql, 'CREATE TABLE wp_options (id int);\nINSERT INTO wp_options VALUES (1);\n');
  await validateDump(sql);
  for (const text of ['', 'USE local;\n', 'CREATE DATABASE local;\n', '/*!40101 DROP DATABASE local */;\n']) {
    await fs.writeFile(sql, text);
    await assert.rejects(validateDump(sql));
  }
});

test('CLI uses explicit root even when executed outside a Local site', async (t) => {
  const root = await fixture(t);
  const result = spawnSync(process.execPath, [cli, 'setup', '--dry-run', '--root', root], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Dry run complete/);
  const wrong = spawnSync(process.execPath, [cli, 'setup', '--dry-run'], { cwd: path.dirname(root), encoding: 'utf8' });
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /--root/);
});

test('help and version do not require a Local site or PHP', () => {
  for (const args of [['--help'], ['--version'], ['setup', '--help'], ['create-site', '--help'], ['create-blueprint', '--help']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: os.tmpdir(), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});

test('npm-style executable symlinks invoke the CLI', async (t) => {
  const root = await fixture(t);
  const bin = path.join(root, 'local-sandqube-bin');
  await fs.symlink(cli, bin);
  const result = spawnSync(process.execPath, [bin, '--version'], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
});
