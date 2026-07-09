export type AgentStatus = 'idle' | 'thinking' | 'working' | 'waiting' | 'error' | 'done';

export type AgentEvent =
  | { type: 'status'; status: AgentStatus; detail?: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool_call'; tool: string; phase: 'start' | 'end'; detail?: string; ok?: boolean }
  | { type: 'terminal'; line: string; stream: 'cmd' | 'stdout' | 'stderr' | 'system' }
  | { type: 'file_write'; path: string; bytes?: number }
  | { type: 'file_read'; path: string }
  | { type: 'tokens'; prompt: number; completion: number; estimated: boolean }
  | { type: 'preview_refresh'; path?: string }
  | { type: 'session'; action: 'start' | 'end'; mode: 'demo' | 'api' }
  | { type: 'chat_delta'; msgId: string; delta: string }
  | { type: 'chat_done'; msgId: string }
  | { type: 'approval_request'; approvalId: string; command: string; terminal: string; source: 'demo' | 'real' }
  | { type: 'approval_resolved'; approvalId: string; decision: 'run' | 'deny'; auto: boolean };

type Listener = (event: AgentEvent) => void;

const listeners = new Set<Listener>();

export function publish(event: AgentEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (e) {
      console.error('[AgentBus] listener error:', e);
    }
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
