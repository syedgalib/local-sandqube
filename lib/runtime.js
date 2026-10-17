import fs from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export const resources = fileURLToPath(new URL('../resources/', import.meta.url));
export const log = (message) => process.stdout.write(`${message}\n`);

export async function exists(file) {
  try { await fs.lstat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export function component(value, label) {
  if (!value || value === '.' || value === '..' || /[/\\\0]/u.test(value) || Buffer.byteLength(value) > 255) {
    throw new Error(`${label} must be a single directory name, not a path.`);
  }
  return value;
}

export function databaseName(value) {
  if (!value || !/^[a-zA-Z0-9_]{1,64}$/.test(value)) {
    throw new Error('Database name must contain only a-z, 0-9, and underscores (maximum 64 characters; uppercase is normalized).');
  }
  return value.toLowerCase();
}

export async function directory(file, label = file) {
  try { if ((await fs.stat(file)).isDirectory()) return; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  throw new Error(`Missing directory: ${label}`);
}

export async function regularFile(file, { noSymlink = false } = {}) {
  let stat;
  try { stat = await fs.lstat(file); } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Missing file: ${file}`);
    throw error;
  }
  if (stat.isSymbolicLink() && noSymlink) throw new Error(`File must not be a symlink: ${file}`);
  if (!(await fs.stat(file)).isFile()) throw new Error(`Not a regular file: ${file}`);
}

export async function rootPath(input) {
  let root;
  try { root = await fs.realpath(path.resolve(input)); }
  catch { throw new Error(`Cannot open Local site root: ${input}`); }
  try {
    await directory(path.join(root, 'app/public'));
    await directory(path.join(root, 'conf'));
  } catch {
    throw new Error(`Not a Local site root: ${root}. Run from the directory containing app/ and conf/, or pass --root PATH.`);
  }
  return root;
}

export async function wordpressFiles(site, { installed = false } = {}) {
  for (const file of ['index.php', 'wp-load.php', 'wp-settings.php', 'wp-admin/install.php', 'wp-includes/version.php']) {
    await regularFile(path.join(site, file));
  }
  await directory(path.join(site, 'wp-content'));
  if (installed) await regularFile(path.join(site, 'wp-config.php'));
}

export async function directChild(parent, name, label) {
  const physicalParent = await fs.realpath(parent);
  const candidate = path.join(physicalParent, name);
  await directory(candidate, `${label}: ${name}`);
  if (await fs.realpath(candidate) !== candidate) {
    throw new Error(`${label} must be directly inside ${parent}, not linked elsewhere.`);
  }
  return candidate;
}

export async function blueprintDirectory(root, { create = false } = {}) {
  const data = path.join(root, 'local-sandqube');
  const blueprints = path.join(data, 'blueprints');
  for (const item of [data, blueprints]) {
    if (await exists(item) && (await fs.lstat(item)).isSymbolicLink()) {
      throw new Error(`Blueprint storage must not be a symlink: ${item}`);
    }
  }
  if (create) await fs.mkdir(blueprints, { recursive: true });
  return blueprints;
}

export async function copyContents(source, destination) {
  // The destination has already been reserved with exclusive mkdir(). Copy
  // entries individually: fs.cp(errorOnExist) rejects an existing root folder.
  for (const entry of await fs.readdir(source)) {
    await fs.cp(path.join(source, entry), path.join(destination, entry), {
      recursive: true, dereference: false, verbatimSymlinks: true,
      force: false, errorOnExist: true,
    });
  }
}

export async function commandPath(name, env) {
  for (const folder of (env.PATH || '').split(path.delimiter)) {
    const file = path.join(folder || '.', name);
    try { await fs.access(file, constants.X_OK); if ((await fs.stat(file)).isFile()) return file; } catch {}
  }
  throw new Error(`Missing ${name}. Start the selected Local site and use its Site shell, or make sure app/.envrc exists.`);
}

export async function localEnvironment(root) {
  let env = { ...process.env };
  const envrc = path.join(root, 'app/.envrc');
  if (await exists(envrc)) {
    // Local's generated file is shell code. Its path is a positional argument,
    // never interpolated into shell text. Do not evaluate blueprint shell files.
    const marker = '\0SANDQUBE_ENV\0';
    const result = await execute('/bin/sh', ['-c', '. "$1"; printf "\\0SANDQUBE_ENV\\0"; env -0', 'sh', envrc], {
      env, cwd: root, capture: true,
    });
    const index = result.indexOf(marker);
    if (index < 0) throw new Error('Could not read the Local shell environment. Run from its Site shell.');
    env = {};
    for (const entry of result.slice(index + marker.length).split('\0')) {
      const equal = entry.indexOf('=');
      if (equal > 0) env[entry.slice(0, equal)] = entry.slice(equal + 1);
    }
  }
  return { ...env, WP_CLI_DISABLE_AUTO_CHECK_UPDATE: '1', WP_CLI_CONFIG_PATH: '/dev/null' };
}

// All WordPress arguments are passed directly to the executable, without a
// shell. Failures intentionally omit argument values such as DB_PASSWORD.
export function execute(executable, args, { env = process.env, cwd, capture = false, input, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env, cwd, signal, stdio: [input ? 'pipe' : 'ignore', capture ? 'pipe' : 'inherit', 'pipe'],
    });
    let output = '';
    let errorText = '';
    let inputError;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error); else resolve(value);
    };
    if (capture) child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    if (capture) child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > 16 * 1024 * 1024) {
        child.kill();
        finish(new Error(`${path.basename(executable)} returned too much output.`));
      }
    });
    child.stderr.on('data', (chunk) => {
      if (errorText.length < 32768) errorText += chunk;
      if (!capture) process.stderr.write(chunk);
    });
    child.on('error', (error) => finish(new Error(`Cannot run ${path.basename(executable)}: ${error.message}`)));
    let stream;
    if (input) {
      stream = createReadStream(input);
      stream.on('error', (error) => { inputError = error; child.kill(); });
      child.stdin.on('error', (error) => { if (error.code !== 'EPIPE') inputError = error; });
      stream.pipe(child.stdin);
    }
    child.on('close', (code, terminationSignal) => {
      stream?.destroy();
      if (inputError) return finish(inputError);
      if (code !== 0) {
        const detail = capture ? `\n${errorText.trim()}` : '';
        return finish(new Error(`${path.basename(executable)} failed (${terminationSignal || code}).${detail}`));
      }
      finish(null, output.trimEnd());
    });
  });
}

export async function context(root, tools = []) {
  const env = await localEnvironment(root);
  const php = await commandPath('php', env);
  const wp = await commandPath('wp', env);
  for (const tool of tools) await commandPath(tool, env);
  const socket = await execute(php, ['-r', 'echo ini_get("mysqli.default_socket");'], { env, cwd: root, capture: true });
  if (socket) env.MYSQL_UNIX_PORT = socket;
  const work = await fs.mkdtemp(path.join(root, 'app/.sandqube-'));
  await fs.writeFile(path.join(work, 'wp-cli.yml'), '{}\n');
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  return {
    root, env, work,
    wp(site, args, options = {}) {
      return execute(wp, [`--path=${site}`, '--skip-plugins', '--skip-themes', '--skip-packages', '--no-color', ...args], {
        env: { ...env, ...options.env }, cwd: work, capture: options.capture,
        input: options.input, signal: options.cleanup ? undefined : controller.signal,
      });
    },
    helper(site, name, options = {}) {
      return this.wp(site, ['eval-file', path.join(resources, 'php', name)], options);
    },
    async info(site) {
      const output = await this.helper(site, 'site-info.php', { capture: true });
      try { return JSON.parse(output); } catch { throw new Error('WordPress returned invalid site information. Check the selected site configuration.'); }
    },
    async dispose() {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      await fs.rm(work, { recursive: true, force: true });
    },
  };
}
