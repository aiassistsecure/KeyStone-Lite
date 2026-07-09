import { subscribe, type AgentStatus } from './agent-events';

export interface MetricsSnapshot {
  mode: 'demo' | 'api' | null;
  status: AgentStatus;
  statusDetail: string;
  startedAt: number | null;
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
  toolCalls: number;
  commandsRun: number;
  filesTouched: string[];
  filesRead: string[];
  estCostUsd: number;
}

// Blended default rate (Groq llama-3.3-70b class): $0.59/M input, $0.79/M output.
const IN_RATE = 0.59 / 1_000_000;
const OUT_RATE = 0.79 / 1_000_000;

let snapshot: MetricsSnapshot = emptySnapshot();
const touched = new Set<string>();
const read = new Set<string>();
const listeners = new Set<() => void>();

function emptySnapshot(): MetricsSnapshot {
  return {
    mode: null,
    status: 'idle',
    statusDetail: '',
    startedAt: null,
    promptTokens: 0,
    completionTokens: 0,
    estimated: false,
    toolCalls: 0,
    commandsRun: 0,
    filesTouched: [],
    filesRead: [],
    estCostUsd: 0,
  };
}

function commit(next: Partial<MetricsSnapshot>): void {
  snapshot = {
    ...snapshot,
    ...next,
    filesTouched: Array.from(touched),
    filesRead: Array.from(read),
  };
  snapshot.estCostUsd = snapshot.promptTokens * IN_RATE + snapshot.completionTokens * OUT_RATE;
  for (const cb of listeners) cb();
}

subscribe((event) => {
  switch (event.type) {
    case 'session':
      if (event.action === 'start') {
        touched.clear();
        read.clear();
        snapshot = emptySnapshot();
        commit({ mode: event.mode, startedAt: Date.now(), status: 'working' });
      } else {
        commit({ status: 'done' });
      }
      break;
    case 'status':
      commit({ status: event.status, statusDetail: event.detail || '' });
      break;
    case 'tool_call':
      if (event.phase === 'start') commit({ toolCalls: snapshot.toolCalls + 1 });
      break;
    case 'terminal':
      if (event.stream === 'cmd') commit({ commandsRun: snapshot.commandsRun + 1 });
      break;
    case 'file_write':
      touched.add(event.path);
      commit({});
      break;
    case 'file_read':
      read.add(event.path);
      commit({});
      break;
    case 'tokens':
      commit({
        promptTokens: snapshot.promptTokens + event.prompt,
        completionTokens: snapshot.completionTokens + event.completion,
        estimated: snapshot.estimated || event.estimated,
      });
      break;
  }
});

export function getMetrics(): MetricsSnapshot {
  return snapshot;
}

export function subscribeMetrics(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
