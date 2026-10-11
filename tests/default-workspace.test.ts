import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app';
import { readConfig } from '../server/config';

test('new chats inherit workspace and enabled tools; explicit selection and repository exclusions persist', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pa-default-'));
  const config = {
    ...readConfig(),
    dataDir: dir,
    demo: true,
    password: '',
    vapidPrivate: '',
    vapidPublic: '',
    defaultRepository: 'example/brain',
    quickChat: true,
    workspaceMode: 'shared' as const,
    defaultGlobalSkills: true,
    repositoryAllowlist: ['example/brain'],
  };
  const runtime = createApp(config),
    server = runtime.app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  config.origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const request = (route: string, body?: unknown) =>
    fetch(config.origin + '/api' + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    const settings = await (await request('/config')).json();
    assert.equal(settings.defaultRepository, 'example/brain');
    assert.equal(settings.quickChat, true);
    const chat = await (await request('/conversations', { agent: 'claude' })).json();
    assert.equal(chat.repo, 'example/brain');
    assert.equal(chat.workspace_mode, 'shared');
    assert.deepEqual(chat.tools, { mcp: null, skills: null });
    assert.deepEqual((await (await request(`/conversations/${chat.id}`)).json()).tools, chat.tools);
    const explicit = await (
      await request('/conversations', { agent: 'codex', tools: { mcp: [], skills: [] } })
    ).json();
    assert.deepEqual(explicit.tools, { mcp: [], skills: [] });
    assert.equal(
      (await request('/conversations', { agent: 'claude', repo: 'example/excluded' })).status,
      403,
    );
    assert.equal((await request('/conversations', { agent: 'claude', repo: null })).status, 403);
    config.brainBootstrap = true;
    assert.equal(
      (await request('/conversations', { agent: 'claude', workspaceMode: 'isolated' })).status,
      400,
    );
    config.defaultGlobalSkills = false;
    assert.deepEqual((await (await request('/conversations', { agent: 'claude' })).json()).tools, {
      mcp: null,
      skills: [],
    });
    const count = runtime.store.list().length;
    assert.equal((await request('/conversations', { agent: 'claude' })).status, 201);
    assert.equal(runtime.store.list().length, count + 1);
  } finally {
    await runtime.close();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});

test('ready workspace configuration rejects missing defaults and escaping paths', () => {
  const names = [
    'DEFAULT_REPOSITORY',
    'QUICK_CHAT',
    'REPOSITORY_ALLOWLIST',
    'PROJECT_SKILL_DIRECTORY',
    'BRAIN_BOOTSTRAP',
    'WORKSPACE_MODE',
  ];
  const previous = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  try {
    for (const name of names) delete process.env[name];
    process.env.QUICK_CHAT = 'true';
    assert.throws(readConfig, /DEFAULT_REPOSITORY/);
    process.env.DEFAULT_REPOSITORY = '../brain';
    assert.throws(readConfig, /non valida/);
    process.env.DEFAULT_REPOSITORY = 'example/brain';
    process.env.REPOSITORY_ALLOWLIST = 'example/other';
    assert.throws(readConfig, /ALLOWLIST/);
    process.env.REPOSITORY_ALLOWLIST = 'example/brain';
    process.env.PROJECT_SKILL_DIRECTORY = '../outside';
    assert.throws(readConfig, /relativa/);
    process.env.PROJECT_SKILL_DIRECTORY = 'skills';
    process.env.BRAIN_BOOTSTRAP = 'true';
    assert.throws(readConfig, /shared/);
    process.env.WORKSPACE_MODE = 'shared';
    assert.equal(readConfig().defaultRepository, 'example/brain');
  } finally {
    for (const name of names)
      previous[name] === undefined
        ? delete process.env[name]
        : (process.env[name] = previous[name]);
  }
});
