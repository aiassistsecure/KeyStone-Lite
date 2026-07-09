import { createLocalMemoryApi } from './browser-bridge';

export type MemoryScope = 'global' | string;

type MemoryApi = NonNullable<Window['electron']['memory']>;

let fallback: MemoryApi | null = null;

function api(): MemoryApi {
  if (window.electron.memory) return window.electron.memory;
  if (!fallback) fallback = createLocalMemoryApi() as MemoryApi;
  return fallback;
}

function warn(op: string, error: string): void {
  console.warn(`[Memory] ${op} failed: ${error}`);
}

export async function memPut<T>(scope: MemoryScope, coll: string, id: string, doc: T): Promise<boolean> {
  const res = await api().put(scope, coll, id, doc);
  if (res.error) {
    warn(`put ${coll}/${id}`, res.error);
    return false;
  }
  return true;
}

export async function memGet<T>(scope: MemoryScope, coll: string, id: string): Promise<T | null> {
  const res = await api().get(scope, coll, id);
  if (res.error) {
    warn(`get ${coll}/${id}`, res.error);
    return null;
  }
  return (res.doc as T) ?? null;
}

export async function memDel(scope: MemoryScope, coll: string, id: string): Promise<void> {
  const res = await api().delete(scope, coll, id);
  if (res.error) warn(`delete ${coll}/${id}`, res.error);
}

export async function memList<T>(scope: MemoryScope, coll: string): Promise<T[]> {
  const res = await api().list(scope, coll);
  if (res.error) {
    warn(`list ${coll}`, res.error);
    return [];
  }
  return (res.docs as T[]) || [];
}

export async function memLink(scope: MemoryScope, frm: string, rel: string, to: string): Promise<void> {
  const res = await api().link(scope, frm, rel, to);
  if (res.error) warn(`link ${frm} -${rel}-> ${to}`, res.error);
}

export async function memUnlink(scope: MemoryScope, frm: string, rel: string, to: string): Promise<void> {
  const res = await api().unlink(scope, frm, rel, to);
  if (res.error) warn(`unlink ${frm} -${rel}-> ${to}`, res.error);
}

export async function memNeighbors(scope: MemoryScope, frm: string, rel: string): Promise<string[]> {
  const res = await api().neighbors(scope, frm, rel);
  if (res.error) {
    warn(`neighbors ${frm} -${rel}->`, res.error);
    return [];
  }
  return res.ids || [];
}

export async function memoryEngineAvailable(): Promise<boolean> {
  try {
    return await api().available();
  } catch {
    return false;
  }
}
