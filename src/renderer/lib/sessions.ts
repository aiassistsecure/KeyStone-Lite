import type { SessionInfo, WorkspaceInfo } from '../types/electron';
import { memDel, memGet, memLink, memList, memPut } from './memory';

// Persistent layout (NEDB ENGINE):
//   global scope    — colls `workspaces`, `sessions`, `chat_{sessionId}`
//                     links `workspaces:{id}` -has_session-> `sessions:{id}`
//   workspace scope — mirror of that workspace's sessions + chat transcripts
//                     ({workspace}/.keystone/memory — travels with the folder)

export interface ChatRecord {
  seq: number;
  role: 'user' | 'assistant' | 'system' | 'approval' | 'tool';
  content: string;
  ts: number;
  meta?: Record<string, unknown>;
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export async function listWorkspaces(): Promise<WorkspaceInfo[]> {
  const all = await memList<WorkspaceInfo>('global', 'workspaces');
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function listSessions(): Promise<SessionInfo[]> {
  const all = await memList<SessionInfo>('global', 'sessions');
  return all.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

export async function getSession(id: string): Promise<SessionInfo | null> {
  return memGet<SessionInfo>('global', 'sessions', id);
}

export async function getActiveSession(): Promise<SessionInfo | null> {
  const id = await window.electron.store.get('activeSessionId');
  if (!id) return null;
  return getSession(id);
}

export async function getWorkspace(id: string): Promise<WorkspaceInfo | null> {
  return memGet<WorkspaceInfo>('global', 'workspaces', id);
}

export async function createWorkspace(name: string, path: string): Promise<WorkspaceInfo> {
  const existing = (await listWorkspaces()).find((w) => w.path === path);
  if (existing) return existing;
  const workspace: WorkspaceInfo = {
    id: makeId('ws'),
    name: name || path.split(/[\\/]/).pop() || 'workspace',
    path,
    createdAt: Date.now(),
  };
  await memPut('global', 'workspaces', workspace.id, workspace);
  return workspace;
}

export async function removeWorkspace(id: string): Promise<void> {
  await memDel('global', 'workspaces', id);
  const sessions = await listSessions();
  for (const s of sessions.filter((s) => s.workspaceId === id)) {
    await memDel('global', 'sessions', s.id);
  }
}

export async function createSession(mode: 'demo' | 'api', workspace: WorkspaceInfo, name?: string): Promise<SessionInfo> {
  const session: SessionInfo = {
    id: makeId('sess'),
    name: name || `${mode === 'demo' ? 'Demo' : 'Session'} — ${workspace.name}`,
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    mode,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    messageCount: 0,
  };
  await memPut('global', 'sessions', session.id, session);
  await memLink('global', `workspaces:${workspace.id}`, 'has_session', `sessions:${session.id}`);
  if (mode === 'api' && workspace.path) {
    // Mirror into the workspace's own memory so history travels with the folder.
    await memPut(workspace.path, 'sessions', session.id, session);
  }
  await window.electron.store.set('activeSessionId', session.id);
  return session;
}

export async function updateSession(id: string, patch: Partial<SessionInfo>): Promise<SessionInfo | null> {
  const session = await getSession(id);
  if (!session) return null;
  const next = { ...session, ...patch, id: session.id };
  await memPut('global', 'sessions', id, next);
  if (next.mode === 'api' && next.workspacePath) {
    await memPut(next.workspacePath, 'sessions', id, next);
  }
  return next;
}

export async function touchSession(id: string): Promise<void> {
  await updateSession(id, { lastActiveAt: Date.now() });
}

export async function deleteSession(id: string): Promise<void> {
  const session = await getSession(id);
  await memDel('global', 'sessions', id);
  if (session?.workspacePath) {
    await memDel(session.workspacePath, 'sessions', id);
  }
  const active = await window.electron.store.get('activeSessionId');
  if (active === id) await window.electron.store.set('activeSessionId', '');
}

export async function setActiveSession(id: string | null): Promise<void> {
  await window.electron.store.set('activeSessionId', id ?? '');
}

export async function findSessionForWorkspace(workspaceId: string): Promise<SessionInfo | null> {
  const sessions = await listSessions();
  return sessions.find((s) => s.workspaceId === workspaceId) || null;
}

export async function resumeOrCreateSession(mode: 'demo' | 'api', workspace: WorkspaceInfo): Promise<SessionInfo> {
  const existing = await findSessionForWorkspace(workspace.id);
  if (existing && existing.mode === mode) {
    await touchSession(existing.id);
    await setActiveSession(existing.id);
    return { ...existing, lastActiveAt: Date.now() };
  }
  return createSession(mode, workspace);
}

// ---------------------------------------------------------------------------
// Chat transcript persistence
// ---------------------------------------------------------------------------

function chatColl(sessionId: string): string {
  return `chat_${sessionId}`;
}

function chatDocId(seq: number): string {
  return `m${String(seq).padStart(6, '0')}`;
}

export async function saveChatMessage(session: SessionInfo, record: ChatRecord): Promise<void> {
  await memPut('global', chatColl(session.id), chatDocId(record.seq), record);
  if (session.mode === 'api' && session.workspacePath) {
    await memPut(session.workspacePath, chatColl(session.id), chatDocId(record.seq), record);
  }
  const summary =
    record.role === 'user' && record.content
      ? record.content.slice(0, 120)
      : undefined;
  await updateSession(session.id, {
    lastActiveAt: Date.now(),
    messageCount: record.seq + 1,
    ...(summary ? { summary } : {}),
  });
}

export async function loadChatMessages(session: SessionInfo): Promise<ChatRecord[]> {
  let records: ChatRecord[] = [];
  if (session.mode === 'api' && session.workspacePath) {
    records = await memList<ChatRecord>(session.workspacePath, chatColl(session.id));
  }
  if (records.length === 0) {
    records = await memList<ChatRecord>('global', chatColl(session.id));
  }
  return records.sort((a, b) => a.seq - b.seq);
}
