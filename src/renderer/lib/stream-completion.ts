interface StreamCompletionOptions {
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content?: string | null; tool_calls?: unknown[]; tool_call_id?: string; name?: string }>;
  tools?: unknown[];
  tool_choice?: string;
  temperature?: number;
  maxTokens?: number;
  provider?: string;
  onProgress?: (text: string) => void;
  onToolActivity?: (toolName: string, filePath?: string, operation?: string) => void;
}

interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

interface CompletionResponse {
  id: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export async function streamToolCompletion(options: StreamCompletionOptions): Promise<CompletionResponse> {
  const {
    apiKey,
    model,
    messages,
    tools,
    tool_choice,
    temperature = 0.7,
    maxTokens = 4096,
    provider,
    onProgress,
    onToolActivity
  } = options;

  const response = await fetch('https://api.aiassist.net/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(provider && { 'X-AiAssist-Provider': provider }),
    },
    body: JSON.stringify({
      model,
      messages,
      tools,
      tool_choice,
      temperature,
      max_tokens: maxTokens,
      max_completion_tokens: maxTokens,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || errorData.error?.message || `API request failed (${response.status})`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let toolCalls: Map<number, ToolCall> = new Map();
  let responseId = '';
  let finishReason = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      console.log('[Stream] Raw line:', line.slice(0, 200));
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') {
        console.log('[Stream] Received [DONE]');
        continue;
      }

      try {
        const chunk = JSON.parse(data);
        console.log('[Stream] Parsed chunk:', JSON.stringify(chunk).slice(0, 300));
        if (chunk.id) responseId = chunk.id;

        const delta = chunk.choices?.[0]?.delta;
        const reason = chunk.choices?.[0]?.finish_reason;
        if (reason) finishReason = reason;

        if (delta?.content) {
          content += delta.content;
          onProgress?.(content);
          
          const editMatch = content.match(/<<<(EDIT|INSERT|REPLACE|DELETE|CREATE)\s+([^\s>]+)/i);
          if (editMatch) {
            const [, op, filePath] = editMatch;
            onToolActivity?.('surgical_edit', filePath, op.toLowerCase());
          }
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCalls.has(idx)) {
              toolCalls.set(idx, {
                id: tc.id || '',
                type: tc.type || 'function',
                function: { name: '', arguments: '' }
              });
            }
            const existing = toolCalls.get(idx)!;
            if (tc.id) existing.id = tc.id;
            if (tc.type) existing.type = tc.type;
            if (tc.function?.name) {
              existing.function.name += tc.function.name;
              onToolActivity?.(existing.function.name);
            }
            if (tc.function?.arguments) {
              existing.function.arguments += tc.function.arguments;
              try {
                const args = JSON.parse(existing.function.arguments);
                const filePath = args.file_path || args.filePath || args.path;
                const operation = args.operation || args.action || args.type;
                if (filePath) {
                  onToolActivity?.(existing.function.name, filePath, operation);
                }
              } catch {
                // Arguments not complete yet, will parse when done
              }
            }
          }
        }
      } catch {
        // Skip malformed JSON chunks
      }
    }
  }

  const assembledToolCalls = toolCalls.size > 0 
    ? Array.from(toolCalls.values()).sort((a, b) => {
        const idxA = parseInt(a.id.split('_').pop() || '0');
        const idxB = parseInt(b.id.split('_').pop() || '0');
        return idxA - idxB;
      })
    : undefined;

  return {
    id: responseId || `chatcmpl-${Date.now()}`,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: content || null,
        tool_calls: assembledToolCalls,
      },
      finish_reason: finishReason || 'stop',
    }],
  };
}
