import 'dotenv/config';
import path from 'node:path';

export interface Config {
  dataDir: string;
  host: string;
  port: number;
  origin: string;
  password: string;
  demo: boolean;
  maxRuns: number;
  unrestricted: boolean;
  claudeBin: string;
  codexBin: string;
  audioKey: string;
  audioBase: string;
  sttModel: string;
  ttsModel: string;
  voice: string;
  vapidPublic: string;
  vapidPrivate: string;
  vapidSubject: string;
  workspaceMode: 'isolated' | 'shared';
  defaultRepository?: string;
  quickChat?: boolean;
  defaultGlobalSkills?: boolean;
  repositoryAllowlist?: string[];
  projectSkillDirectory?: string;
  brainBootstrap?: boolean;
}
export function readConfig(): Config {
  const config = {
    dataDir: path.resolve(process.env.DATA_DIR || '.data'),
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || 4310),
    origin: process.env.APP_ORIGIN || 'http://localhost:5173',
    password: process.env.APP_PASSWORD || '',
    demo: process.env.DEMO_MODE === 'true',
    maxRuns: Number(process.env.MAX_CONCURRENT_RUNS || 3),
    unrestricted: process.env.AGENT_UNRESTRICTED === 'true',
    claudeBin: process.env.CLAUDE_BIN || 'claude',
    codexBin: process.env.CODEX_BIN || 'codex',
    audioKey: process.env.OPENROUTER_API_KEY || '',
    audioBase: process.env.AUDIO_BASE_URL || 'https://openrouter.ai/api/v1',
    sttModel: process.env.STT_MODEL || 'openai/gpt-4o-transcribe',
    ttsModel: process.env.TTS_MODEL || 'google/gemini-3.8-flash-lite-tts',
    voice: process.env.TTS_VOICE || 'Kore',
    vapidPublic: process.env.VAPID_PUBLIC_KEY || '',
    vapidPrivate: process.env.VAPID_PRIVATE_KEY || '',
    vapidSubject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    workspaceMode: (process.env.WORKSPACE_MODE || 'isolated') as Config['workspaceMode'],
    defaultRepository: process.env.DEFAULT_REPOSITORY?.trim() || undefined,
    quickChat: process.env.QUICK_CHAT === 'true',
    defaultGlobalSkills: process.env.DEFAULT_GLOBAL_SKILLS === 'all',
    repositoryAllowlist: process.env.REPOSITORY_ALLOWLIST?.split(',')
      .map((r) => r.trim())
      .filter(Boolean),
    projectSkillDirectory:
      process.env.PROJECT_SKILL_DIRECTORY?.trim() ||
      (process.env.BRAIN_BOOTSTRAP === 'true' ? 'skills' : undefined),
    brainBootstrap: process.env.BRAIN_BOOTSTRAP === 'true',
  };
  if (!['127.0.0.1', '::1', 'localhost'].includes(config.host) && config.password.length < 24)
    throw new Error('APP_PASSWORD deve contenere almeno 24 caratteri per esporre il server.');
  if (!Number.isInteger(config.maxRuns) || config.maxRuns < 1 || config.maxRuns > 16)
    throw new Error('MAX_CONCURRENT_RUNS deve essere compreso tra 1 e 16.');
  if (!['isolated', 'shared'].includes(config.workspaceMode))
    throw new Error('WORKSPACE_MODE deve essere isolated oppure shared.');
  for (const repo of [config.defaultRepository, ...(config.repositoryAllowlist || [])])
    if (
      repo &&
      (repo.length > 180 ||
        !/^[\w.-]+\/[\w.-]+$/.test(repo) ||
        repo.split('/').some((p) => p === '.' || p === '..'))
    )
      throw new Error('Repository configurata non valida: usa owner/repo.');
  if (config.quickChat && !config.defaultRepository)
    throw new Error('QUICK_CHAT richiede DEFAULT_REPOSITORY.');
  if (config.brainBootstrap && (!config.defaultRepository || config.workspaceMode !== 'shared'))
    throw new Error('BRAIN_BOOTSTRAP richiede DEFAULT_REPOSITORY e WORKSPACE_MODE=shared.');
  if (
    config.repositoryAllowlist?.length &&
    config.defaultRepository &&
    !config.repositoryAllowlist.includes(config.defaultRepository)
  )
    throw new Error('DEFAULT_REPOSITORY deve essere inclusa in REPOSITORY_ALLOWLIST.');
  if (
    config.projectSkillDirectory &&
    (path.isAbsolute(config.projectSkillDirectory) ||
      config.projectSkillDirectory.split(/[\\/]/).some((p) => !p || p === '.' || p === '..'))
  )
    throw new Error('PROJECT_SKILL_DIRECTORY deve essere una cartella relativa alla repository.');
  return config;
}
