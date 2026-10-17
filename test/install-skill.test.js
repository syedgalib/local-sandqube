import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from '../bin/local-sandqube.js';
import { installSkill } from '../lib/install-skill.js';
import { exists, resources } from '../lib/runtime.js';

const cli = fileURLToPath(new URL('../bin/local-sandqube.js', import.meta.url));
const fixture = async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sandqube skill test '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
};

test('install-skill requires exactly one supported agent and accepts cwd or explicit roots', () => {
  for (const agent of ['codex', 'claude']) {
    assert.deepEqual(parse(['install-skill', agent], '/tmp/project'), {
      command: 'install-skill', args: [agent], root: '/tmp/project', dryRun: false,
    });
    assert.equal(parse(['--root', 'other', 'install-skill', agent], '/tmp').root, '/tmp/other');
    assert.equal(parse(['install-skill', agent, '-r', 'other'], '/tmp').root, '/tmp/other');
  }
  for (const args of [[], ['Codex'], ['other'], ['codex', 'claude'], ['../codex'], ['codex', '--dry-run']]) {
    assert.throws(() => parse(['install-skill', ...args]));
  }
});

test('installs complete agent-specific files without requiring a Local layout or services', async (t) => {
  const root = await fixture(t);
  const caller = await fixture(t);
  for (const [agent, folder] of [['codex', '.agents'], ['claude', '.claude']]) {
    const args = [cli, 'install-skill', agent, ...(agent === 'codex' ? ['--root', root] : [])];
    const result = spawnSync(process.execPath, args, { cwd: agent === 'codex' ? caller : root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const destination = path.join(root, folder, 'skills/local-sandqube');
    assert.deepEqual(await fs.readFile(path.join(destination, 'SKILL.md')), await fs.readFile(path.join(resources, 'skills/local-sandqube/SKILL.md')));
    assert.equal(await exists(path.join(destination, 'agents/openai.yaml')), agent === 'codex');
    assert.equal(await exists(path.join(caller, folder)), false);
  }
});

test('repeat installs skip identical files and preserve customized files in backups when updating', async (t) => {
  const root = await fixture(t);
  for (const [agent, folder] of [['codex', '.agents'], ['claude', '.claude']]) {
    const destination = await installSkill(root, agent);
    const file = path.join(destination, 'SKILL.md');
    const before = (await fs.stat(file)).mtimeMs;
    await installSkill(root, agent);
    assert.equal((await fs.stat(file)).mtimeMs, before);
    assert.equal(await exists(path.join(root, folder, 'skill-backups')), false);
    await fs.writeFile(file, 'My customized instructions');
    await fs.writeFile(path.join(destination, 'custom.txt'), 'Keep this file');
    await installSkill(root, agent);
    const backupParent = path.join(root, folder, 'skill-backups');
    const [backup] = await fs.readdir(backupParent);
    assert.equal(await fs.readFile(path.join(backupParent, backup, 'SKILL.md'), 'utf8'), 'My customized instructions');
    assert.equal(await fs.readFile(path.join(destination, 'custom.txt'), 'utf8'), 'Keep this file');
    assert.deepEqual(await fs.readFile(file), await fs.readFile(path.join(resources, 'skills/local-sandqube/SKILL.md')));
  }
});

test('installer rejects destination symlinks and invalid agent types before modifying files', async (t) => {
  const root = await fixture(t);
  const external = await fixture(t);
  await fs.symlink(external, path.join(root, '.agents'));
  await assert.rejects(installSkill(root, 'codex'), /real directory/);
  await assert.rejects(installSkill(root, 'other'), /codex or claude/);
  assert.deepEqual(await fs.readdir(external), []);
  await fs.unlink(path.join(root, '.agents'));
  const destination = path.join(root, '.agents/skills/local-sandqube');
  await fs.mkdir(destination, { recursive: true });
  const externalFile = path.join(external, 'SKILL.md');
  await fs.writeFile(externalFile, 'preserve');
  await fs.symlink(externalFile, path.join(destination, 'SKILL.md'));
  await assert.rejects(installSkill(root, 'codex'), /symlink/);
  assert.equal(await fs.readFile(externalFile, 'utf8'), 'preserve');
});

test('partial update failure restores installed files and removes staging files', async (t) => {
  const root = await fixture(t);
  const destination = await installSkill(root, 'codex');
  await fs.writeFile(path.join(destination, 'SKILL.md'), 'custom skill');
  await fs.writeFile(path.join(destination, 'agents/openai.yaml'), 'custom metadata');
  const rename = fs.rename.bind(fs);
  let calls = 0;
  t.mock.method(fs, 'rename', async (...args) => {
    if (++calls === 2) throw new Error('Simulated filesystem failure');
    return rename(...args);
  });
  await assert.rejects(installSkill(root, 'codex'), /Simulated filesystem failure/);
  assert.equal(await fs.readFile(path.join(destination, 'SKILL.md'), 'utf8'), 'custom skill');
  assert.equal(await fs.readFile(path.join(destination, 'agents/openai.yaml'), 'utf8'), 'custom metadata');
  assert.equal((await fs.readdir(destination)).some((file) => file.startsWith('.install-')), false);
});

test('help command and flags describe skill installation without requiring a project', async (t) => {
  const root = await fixture(t);
  for (const args of [['help'], ['--help'], ['help', 'install-skill'], ['install-skill', '--help']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /install-skill/);
    assert.match(result.stdout, /codex/);
    assert.match(result.stdout, /claude/);
  }
});
