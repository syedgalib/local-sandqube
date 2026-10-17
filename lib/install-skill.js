import fs from 'node:fs/promises';
import path from 'node:path';
import { exists, log, regularFile, resources } from './runtime.js';

export const agentTypes = ['codex', 'claude'];

export async function installSkill(root, agent) {
  if (!agentTypes.includes(agent)) throw new Error('Agent must be codex or claude.');
  const source = path.join(resources, 'skills/local-sandqube');
  const agentRoot = path.join(root, agent === 'codex' ? '.agents' : '.claude');
  const skills = path.join(agentRoot, 'skills');
  const destination = path.join(skills, 'local-sandqube');
  const files = agent === 'codex' ? ['SKILL.md', 'agents/openai.yaml'] : ['SKILL.md'];
  // Never follow an installed skill or its parent directories outside this root.
  for (const directory of [agentRoot, skills, destination, ...(agent === 'codex' ? [path.join(destination, 'agents')] : [])]) {
    if (await exists(directory)) {
      const stat = await fs.lstat(directory);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Skill directory must be a real directory: ${directory}`);
    }
  }
  const updates = new Map();
  const originals = new Map();
  for (const file of files) {
    await regularFile(path.join(source, file), { noSymlink: true });
    const content = await fs.readFile(path.join(source, file));
    const target = path.join(destination, file);
    if (await exists(target)) {
      await regularFile(target, { noSymlink: true });
      const original = await fs.readFile(target);
      if (content.equals(original)) continue;
      originals.set(file, { content: original, mode: (await fs.stat(target)).mode & 0o777 });
    }
    updates.set(file, content);
  }
  if (!updates.size) {
    log(`Skill already installed for ${agent}: ${destination}`);
    return destination;
  }
  if (originals.size) {
    const backups = path.join(agentRoot, 'skill-backups');
    if (await exists(backups) && (await fs.lstat(backups)).isSymbolicLink()) throw new Error(`Backup directory must not be a symlink: ${backups}`);
    await fs.mkdir(backups, { recursive: true });
    const backup = await fs.mkdtemp(path.join(backups, 'local-sandqube-'));
    for (const [file, original] of originals) {
      await fs.mkdir(path.dirname(path.join(backup, file)), { recursive: true });
      await fs.writeFile(path.join(backup, file), original.content, { mode: original.mode });
    }
    log(`Existing skill files backed up to: ${backup}`);
  }
  const newDestination = !await exists(destination);
  await fs.mkdir(destination, { recursive: true });
  const stage = await fs.mkdtemp(path.join(destination, '.install-'));
  const applied = [];
  try {
    for (const [file, content] of updates) {
      const target = path.join(destination, file);
      const staged = path.join(stage, file);
      await fs.mkdir(path.dirname(staged), { recursive: true });
      await fs.writeFile(staged, content, { mode: originals.get(file)?.mode ?? 0o644 });
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.rename(staged, target);
      applied.push(file);
    }
  } catch (error) {
    if (newDestination) await fs.rm(destination, { recursive: true, force: true });
    else for (const file of applied) {
      const target = path.join(destination, file);
      const original = originals.get(file);
      if (original) await fs.writeFile(target, original.content, { mode: original.mode });
      else await fs.rm(target, { force: true });
    }
    throw error;
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
  log(`Skill installed for ${agent}: ${destination}`);
  log(agent === 'codex' ? 'Invoke with $local-sandqube.' : 'Invoke with /local-sandqube.');
  log('Start a new agent session if the skill is not discovered.');
  return destination;
}
