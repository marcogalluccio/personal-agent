import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  rm,
  symlink,
  readdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareBrainWorkspace } from '../server/brain-workspace';
import { SkillService } from '../server/skills';
import { Store } from '../server/store';
import { GitService } from '../server/git';
import { readConfig } from '../server/config';

const exec = promisify(execFile);
async function fixture() {
  const temp = await mkdtemp(path.join(tmpdir(), 'pa-brain-'));
  const dir = await realpath(temp),
    root = path.join(dir, 'brain'),
    home = path.join(dir, 'home');
  for (const folder of [
    'memory',
    'skills/operations/task',
    'skills/_old/retired',
    'scripts',
    'githooks',
  ])
    await mkdir(path.join(root, folder), { recursive: true });
  await mkdir(home);
  await writeFile(path.join(root, 'memory/MEMORY.md'), 'Preserve this memory\n');
  await writeFile(
    path.join(root, 'skills/operations/task/SKILL.md'),
    '---\nname: task\ndescription: Test task.\n---\nRead memory.\n',
  );
  await writeFile(
    path.join(root, 'skills/_old/retired/SKILL.md'),
    '---\nname: retired\ndescription: Old task.\n---\nDo not run.',
  );
  await writeFile(path.join(root, 'scripts/git-locked'), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
  await exec('git', ['init', '-b', 'main', root]);
  return {
    dir,
    root,
    home,
    key: root.replace(/[^a-zA-Z0-9]/g, '-'),
    close: () => rm(dir, { recursive: true, force: true }),
  };
}

test('brain setup links native memory and skills, preserves source, enables hooks and is idempotent', async () => {
  const f = await fixture();
  try {
    const signal = new AbortController().signal;
    await Promise.all([
      prepareBrainWorkspace(f.root, 'skills', signal, f.home),
      prepareBrainWorkspace(f.root, 'skills', signal, f.home),
    ]);
    await prepareBrainWorkspace(f.root, 'skills', signal, f.home);
    assert.equal(
      await realpath(path.join(f.home, '.claude/projects', f.key, 'memory')),
      path.join(f.root, 'memory'),
    );
    for (const agent of ['.claude', '.agents']) {
      assert.equal(
        await realpath(path.join(f.root, agent, 'skills/task')),
        path.join(f.root, 'skills/operations/task'),
      );
      assert.deepEqual(await readdir(path.join(f.root, agent, 'skills')), ['task']);
    }
    assert.equal(
      await readFile(path.join(f.root, 'memory/MEMORY.md'), 'utf8'),
      'Preserve this memory\n',
    );
    assert.equal(
      (
        await exec('git', ['config', '--local', '--get', 'core.hooksPath'], { cwd: f.root })
      ).stdout.trim(),
      'githooks',
    );
    const git = new GitService({
      ...readConfig(),
      brainBootstrap: true,
      defaultRepository: 'example/brain',
    });
    assert.equal(await git.command(f.root, ['config', '--get', 'core.hooksPath']), 'githooks');
    await assert.rejects(
      git.change({ repo: 'example/brain', workspace: f.root } as any, { name: 'other' }),
      /worktree/,
    );
    const store = new Store(path.join(f.dir, 'data'));
    try {
      const skills = new SkillService(store, f.dir, () => {}, 'skills');
      const chat = store.create('codex', 'example/brain', 'Brain');
      chat.workspace = f.root;
      const catalog = await skills.project(chat);
      assert.deepEqual(
        catalog.skills.map((s) => s.name),
        ['task'],
      );
      assert.deepEqual(catalog.warnings, []);
      const access = await skills.access(chat, 'test');
      assert.match(access.instructions, /skills\/operations\/task\/SKILL.md/);
      await access.release();
    } finally {
      store.close();
    }
  } finally {
    await f.close();
  }
});

test('brain setup refuses to replace existing memory or follow native configuration symlinks', async () => {
  const f = await fixture();
  try {
    const memory = path.join(f.home, '.claude/projects', f.key, 'memory');
    await mkdir(memory, { recursive: true });
    await writeFile(path.join(memory, 'user.md'), 'Keep this');
    await assert.rejects(
      prepareBrainWorkspace(f.root, 'skills', new AbortController().signal, f.home),
      /preservare/,
    );
    assert.equal(await readFile(path.join(memory, 'user.md'), 'utf8'), 'Keep this');
    await rm(path.join(f.home, '.claude'), { recursive: true });
    const outside = path.join(f.dir, 'outside');
    await mkdir(outside);
    await symlink(outside, path.join(f.home, '.claude'));
    await assert.rejects(
      prepareBrainWorkspace(f.root, 'skills', new AbortController().signal, f.home),
      /verificare/,
    );
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await f.close();
  }
});

test('project discovery rejects an external skill source; cancelled bootstrap does not write links', async () => {
  const f = await fixture();
  const store = new Store(path.join(f.dir, 'data'));
  try {
    const chat = store.create('claude', 'example/brain', 'Brain');
    chat.workspace = f.root;
    const outside = path.join(f.dir, 'outside');
    await mkdir(outside);
    await symlink(outside, path.join(f.root, 'external-skills'));
    await assert.rejects(
      new SkillService(store, f.dir, () => {}, 'external-skills').project(chat),
      /estern|simbolico/,
    );
    const signal = new AbortController();
    signal.abort();
    await assert.rejects(prepareBrainWorkspace(f.root, 'skills', signal.signal, f.home));
    assert.deepEqual(await readdir(f.home), []);
  } finally {
    store.close();
    await f.close();
  }
});
