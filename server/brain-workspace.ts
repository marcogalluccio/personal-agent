import { mkdir, readdir, realpath, lstat, symlink, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from './runner';

// Admin opt-in only. Never overwrite memory, instruction files, or existing CLI configuration.
const pending = new Map<string, Promise<void>>();
async function linkDirectory(target: string, link: string, base: string) {
  const relative = path.relative(base, path.dirname(link));
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Percorso di configurazione esterno.');
  let parent = base;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    parent = path.join(parent, part);
    const existing = await lstat(parent).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') throw e;
      return undefined;
    });
    if (existing && !existing.isDirectory())
      throw new Error(`Cartella di configurazione da verificare: ${parent}`);
    if (!existing) await mkdir(parent);
  }
  const current = await lstat(link).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== 'ENOENT') throw e;
    return undefined;
  });
  if (current?.isSymbolicLink()) {
    if ((await realpath(link).catch(() => '')) === target) return;
    throw new Error(`Collegamento esistente da verificare: ${link}`);
  }
  if (current) {
    if (!current.isDirectory() || (await readdir(link)).length)
      throw new Error(`Configurazione esistente da preservare: ${link}`);
    await rmdir(link); // Only an empty placeholder, never user memory or skill contents.
  }
  await symlink(target, link, 'dir');
}

export async function prepareBrainWorkspace(
  workspace: string,
  skillDirectory: string,
  signal: AbortSignal,
  home = process.env.HOME,
) {
  if (!home) throw new Error('HOME richiesto per preparare il brain.');
  const root = await realpath(workspace);
  const nativeHome = await realpath(home);
  const active = pending.get(root);
  if (active) return active;
  const preparation = (async () => {
    signal.throwIfAborted();
    const memory = await realpath(path.join(root, 'memory'));
    const skills = await realpath(path.join(root, skillDirectory));
    if (!memory.startsWith(root + path.sep) || !skills.startsWith(root + path.sep))
      throw new Error('Memoria e skill devono restare dentro il brain.');
    const found = new Map<string, string>();
    async function walk(dir: string) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink() || entry.name.startsWith('_')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        if (entry.isFile() && entry.name === 'SKILL.md') {
          const name = path.basename(dir);
          if (found.has(name)) throw new Error(`Nome skill duplicato da verificare: ${name}`);
          found.set(name, dir);
        }
      }
    }
    await walk(skills);
    // Claude's project directory is derived from the actual server path, not the Mac path.
    const projectKey = root.replace(/[^a-zA-Z0-9]/g, '-');
    await linkDirectory(
      memory,
      path.join(nativeHome, '.claude', 'projects', projectKey, 'memory'),
      nativeHome,
    );
    for (const [name, target] of found) {
      signal.throwIfAborted();
      for (const agent of ['.claude', '.agents'])
        await linkDirectory(target, path.join(root, agent, 'skills', name), root);
    }
    // Use the repository's own lock and hooks. No fetch, checkout, commit or push.
    const locked = path.join(root, 'scripts', 'git-locked');
    const hooks = path.join(root, 'githooks');
    if ((await realpath(locked)) !== locked || (await realpath(hooks)) !== hooks)
      throw new Error('Lock e hook del brain da verificare.');
    await runProcess(
      locked,
      ['git', 'config', '--local', 'core.hooksPath', 'githooks'],
      root,
      signal,
      '',
      () => {},
    );
  })();
  pending.set(root, preparation);
  try {
    await preparation;
  } finally {
    pending.delete(root);
  }
}
