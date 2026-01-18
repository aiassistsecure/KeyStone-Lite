import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  X,
  FileCode,
  Loader2,
  Bot,
  User,
  Copy,
  Check,
  ChevronDown,
  Sparkles,
  RotateCcw,
  FileEdit,
  Paperclip,
} from 'lucide-react';
import type { OpenFile } from '../pages/MainLayout';
import { ModelSelector } from './ModelSelector';
import { parseSurgicalEdits, applyMultipleEdits, type SurgicalEdit } from '../lib/surgical-edit';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface CodeBlock {
  filename: string | null;
  language: string;
  code: string;
}

function parseCodeBlocks(content: string): (string | CodeBlock)[] {
  const parts: (string | CodeBlock)[] = [];
  const regex = /(?:([^\s`]+)\s*\n)?```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }
    
    let filename = match[1] || null;
    if (filename && !filename.includes('.')) {
      filename = null;
    }
    
    parts.push({
      filename,
      language: match[2] || 'text',
      code: match[3].trim(),
    });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return parts;
}

async function getProjectTree(projectPath: string, maxDepth = 3, maxFiles = 200): Promise<string> {
  if (!projectPath) return '';
  
  const lines: string[] = [];
  let fileCount = 0;
  
  async function traverse(path: string, depth: number, prefix: string) {
    if (depth > maxDepth || fileCount >= maxFiles) return;
    
    try {
      const result = await window.electron.fs.readDir(path);
      if ('error' in result) return;
      
      const entries = result.filter(e => 
        !e.name.startsWith('.') && 
        !['node_modules', '__pycache__', 'build', 'dist', '.git', 'target', 'vendor'].includes(e.name)
      ).sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      
      for (let i = 0; i < entries.length && fileCount < maxFiles; i++) {
        const entry = entries[i];
        const isLast = i === entries.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const nextPrefix = prefix + (isLast ? '    ' : '│   ');
        
        lines.push(`${prefix}${connector}${entry.name}${entry.isDirectory ? '/' : ''}`);
        fileCount++;
        
        if (entry.isDirectory) {
          await traverse(entry.path, depth + 1, nextPrefix);
        }
      }
    } catch (e) {
      console.error('[Tree] Error reading:', path, e);
    }
  }
  
  const projectName = projectPath.split(/[/\\]/).pop() || 'project';
  lines.push(`${projectName}/`);
  await traverse(projectPath, 0, '');
  
  if (fileCount >= maxFiles) {
    lines.push(`... (truncated at ${maxFiles} files)`);
  }
  
  return lines.join('\n');
}

async function readFileInProject(projectPath: string, filePath: string): Promise<{ content: string } | { error: string }> {
  if (!projectPath) return { error: 'No project open' };
  
  const normalizedProject = projectPath.replace(/\\/g, '/').toLowerCase();
  let fullPath: string;
  
  if (/^[a-zA-Z]:[\\\/]/.test(filePath) || filePath.startsWith('/')) {
    fullPath = filePath;
  } else {
    const separator = projectPath.includes('\\') ? '\\' : '/';
    fullPath = `${projectPath}${separator}${filePath.replace(/\//g, separator)}`;
  }
  
  const normalizedFull = fullPath.replace(/\\/g, '/').toLowerCase();
  if (!normalizedFull.startsWith(normalizedProject)) {
    return { error: 'Access denied: file outside project folder' };
  }
  
  const result = await window.electron.fs.readFile(fullPath);
  if ('error' in result) return { error: result.error };
  return { content: result.content || '' };
}

async function searchFilesInProject(
  projectPath: string, 
  pattern: string, 
  extension?: string
): Promise<{ results: Array<{ file: string; matches: string[] }> } | { error: string }> {
  if (!projectPath) return { error: 'No project open' };
  
  const results: Array<{ file: string; matches: string[] }> = [];
  const patternLower = pattern.toLowerCase();
  let fileCount = 0;
  const maxResults = 20;
  
  async function searchDir(path: string) {
    if (results.length >= maxResults) return;
    
    try {
      const entries = await window.electron.fs.readDir(path);
      if ('error' in entries) return;
      
      for (const entry of entries) {
        if (results.length >= maxResults) break;
        if (entry.name.startsWith('.') || 
            ['node_modules', '__pycache__', 'build', 'dist', '.git', 'target'].includes(entry.name)) {
          continue;
        }
        
        if (entry.isDirectory) {
          await searchDir(entry.path);
        } else {
          if (extension && !entry.name.endsWith(extension)) continue;
          fileCount++;
          if (fileCount > 500) continue;
          
          const content = await window.electron.fs.readFile(entry.path);
          if ('error' in content || !content.content) continue;
          
          const lines = content.content.split('\n');
          const matches: string[] = [];
          for (let i = 0; i < lines.length && matches.length < 3; i++) {
            if (lines[i].toLowerCase().includes(patternLower)) {
              matches.push(`L${i + 1}: ${lines[i].trim().slice(0, 100)}`);
            }
          }
          
          if (matches.length > 0) {
            const relPath = entry.path.replace(projectPath, '').replace(/^[\\\/]/, '');
            results.push({ file: relPath, matches });
          }
        }
      }
    } catch (e) {
      console.error('[Search] Error:', e);
    }
  }
  
  await searchDir(projectPath);
  return { results };
}

const LLM_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read the contents of a file in the project. Use this to examine code before making edits.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path to the file from project root (e.g., "src/main.cpp")'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_files',
      description: 'Search for a pattern in all files. Returns matching file paths and line snippets.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Text pattern to search for (case-insensitive)'
          },
          file_extension: {
            type: 'string',
            description: 'Optional: limit to files with this extension (e.g., ".cpp", ".h")'
          }
        },
        required: ['pattern']
      }
    }
  }
];

interface ChatPanelProps {
  apiKey: string;
  contextFiles: string[];
  openFiles: OpenFile[];
  activeFile: string | null;
  pendingMessage: string | null;
  onClearPendingMessage: () => void;
  onRemoveFromContext: (path: string) => void;
  onApplyEdit: (path: string, content: string) => void;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export function ChatPanel({
  apiKey,
  contextFiles,
  openFiles,
  activeFile,
  pendingMessage,
  onClearPendingMessage,
  onRemoveFromContext,
  onApplyEdit,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [keystoneMode, setKeystoneMode] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (pendingMessage && !isLoading) {
      setInput(pendingMessage);
      onClearPendingMessage();
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [pendingMessage]);

  useEffect(() => {
    if (!keystoneMode || isLoading) return;
    
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'assistant' && lastMessage.content) {
      const { edits } = parseSurgicalEdits(lastMessage.content);
      if (edits.length > 0) {
        applySurgicalEdits(edits);
      }
    }
  }, [isLoading, keystoneMode]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    const assistantMessageId = (Date.now() + 1).toString();

    setMessages((prev) => [
      ...prev,
      {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      },
    ]);

    try {
      const model = await window.electron.store.get('defaultModel');
      const provider = await window.electron.store.get('defaultProvider');
      const temperature = await window.electron.store.get('temperature') || 0.7;
      const maxTokens = await window.electron.store.get('maxTokens') || 8192;

      const filesToInclude = new Set(contextFiles);
      if (activeFile) filesToInclude.add(activeFile);
      
      const contextContent = Array.from(filesToInclude)
        .map((path) => {
          const file = openFiles.find((f) => f.path === path || f.path.endsWith(path) || path.endsWith(f.path));
          if (file && file.content) {
            const numberedLines = file.content
              .split('\n')
              .map((line, i) => `${(i + 1).toString().padStart(4, ' ')}| ${line}`)
              .join('\n');
            const isActive = file.path === activeFile ? ' (active)' : '';
            console.log(`[Context] Adding file: ${file.name}${isActive}, lines: ${file.content.split('\n').length}`);
            return `File: ${file.name}${isActive}\n\`\`\`${file.language}\n${numberedLines}\n\`\`\``;
          }
          return null;
        })
        .filter(Boolean)
        .join('\n\n');

      const keystoneModeInstructions = `
YOU ARE IN KEYSTONE (CREATIVE) MODE.

WORKFLOW (follow this order):
1. GATHER: Use read_file and search_files to understand the relevant code (3-8 calls typically)
2. ANALYZE: Once you have enough context, stop reading
3. PRODUCE: Generate your response with specific code suggestions, edits, or solutions

TOOLS AVAILABLE:
- read_file(path): Read any file in the project. Use relative paths like "src/main.cpp"
- search_files(pattern, file_extension?): Search for text patterns across files

IMPORTANT RULES:
- Maximum 15 tool calls - be strategic, don't read every file
- After reading 3-8 key files, you likely have enough context - STOP and produce output
- Your final response MUST include actionable suggestions, code examples, or edits
- Never end with just "I've read the files" - always provide solutions

When outputting code changes, use this EXACT format:

<<<EDIT filename.ext>>>
<<<REPLACE lines X-Y>>>
complete new code for those lines
<<<END>>>

For NEW files, use:
<<<EDIT path/to/newfile.ext>>>
<<<CREATE>>>
complete file content here
<<<END>>>

EDIT FORMAT RULES:
1. ALWAYS use the exact format above - <<<EDIT>>>, then operation, then <<<END>>>
2. Operations: REPLACE lines X-Y, INSERT after line X, DELETE lines X-Y, CREATE (for new files)
3. Output the COMPLETE code between the operation and END - never truncate or use "..." or "// rest of code"
4. You can use multiple REPLACE blocks in one EDIT for different sections
5. Line numbers MUST match the file you read (use read_file to get line numbers)

DO NOT:
- Show code snippets outside the EDIT format
- Use placeholder comments like "// ... rest remains the same"
- Truncate code - always output complete sections
- Skip the <<<END>>> tag
`;

      const debugModeInstructions = filesToInclude.size > 0 ? `
YOU ARE IN DEBUG MODE. Make minimal, surgical edits to fix issues. Use this format:

<<<EDIT filename.ext>>>
<<<REPLACE lines 5-10>>>
new code here
<<<END>>>

Commands: REPLACE lines X-Y, INSERT after line X, DELETE lines X-Y
The user has an "Apply All" button that applies your edits automatically.
Always use line numbers from the context files shown below.
` : '';

      const modeInstructions = keystoneMode ? keystoneModeInstructions : debugModeInstructions;

      const openFilesList = openFiles.length > 0 
        ? `\nOpen files: ${openFiles.map(f => f.name).join(', ')}`
        : '';
      
      const projectPath = await window.electron.store.get('projectPath');
      const projectTree = projectPath ? await getProjectTree(projectPath as string) : '';
      
      const systemPrompt = `You are Keystone Lite, an AI code editor. You help users write, debug, and improve code.
${modeInstructions}${openFilesList}
${projectTree ? `\nProject structure:\n\`\`\`\n${projectTree}\n\`\`\`\n` : ''}
${contextContent ? `\nFiles in context:\n${contextContent}` : ''}`;

      console.log('[Chat] System prompt length:', systemPrompt.length, 'Context files:', contextFiles.length);
      
      const conversationMessages: Array<{ role: string; content?: string; tool_calls?: unknown[]; tool_call_id?: string; name?: string }> = [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: input.trim() },
      ];
      
      if (keystoneMode) {
        let toolLoopCount = 0;
        const maxToolLoops = 15;
        
        console.log('[Keystone] Starting tool-enabled chat, tools:', LLM_TOOLS.map(t => t.function.name));
        
        while (toolLoopCount < maxToolLoops) {
          const forceFinish = toolLoopCount >= 12;
          console.log('[Keystone] Loop', toolLoopCount + 1, 'messages:', conversationMessages.length, forceFinish ? '(forcing finish)' : '');
          
          const toolResponse = await fetch('https://api.aiassist.net/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
              ...(provider && { 'X-AiAssist-Provider': provider }),
            },
            body: JSON.stringify({
              model: model || 'llama-3.3-70b-versatile',
              messages: forceFinish 
                ? [...conversationMessages, { role: 'system', content: 'STOP using tools now. You have gathered enough information. Produce your final response with code suggestions.' }]
                : conversationMessages,
              tools: forceFinish ? undefined : LLM_TOOLS,
              tool_choice: forceFinish ? undefined : 'auto',
              temperature,
              max_tokens: maxTokens,
              max_completion_tokens: maxTokens,
            }),
          });
          
          if (!toolResponse.ok) {
            const errorData = await toolResponse.json().catch(() => ({}));
            throw new Error(errorData.detail || errorData.error?.message || `API request failed (${toolResponse.status})`);
          }
          
          const toolData = await toolResponse.json();
          console.log('[Keystone] Response:', JSON.stringify(toolData).slice(0, 500));
          
          const choice = toolData.choices?.[0];
          const toolCalls = choice?.message?.tool_calls;
          
          console.log('[Keystone] Tool calls:', toolCalls ? toolCalls.length : 'none');
          
          if (!toolCalls || toolCalls.length === 0) {
            const finalContent = choice?.message?.content || '';
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId ? { ...m, content: finalContent } : m
              )
            );
            break;
          }
          
          conversationMessages.push({
            role: 'assistant',
            content: choice.message.content || null,
            tool_calls: toolCalls,
          });
          
          for (const toolCall of toolCalls) {
            const fnName = toolCall.function.name;
            const args = JSON.parse(toolCall.function.arguments || '{}');
            let result: string;
            
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId 
                  ? { ...m, content: `🔍 Reading ${fnName === 'read_file' ? args.path : `files matching "${args.pattern}"`}...` }
                  : m
              )
            );
            
            if (fnName === 'read_file') {
              const readResult = await readFileInProject(projectPath as string, args.path);
              if ('error' in readResult) {
                result = `Error: ${readResult.error}`;
              } else {
                const lines = readResult.content.split('\n').map((l, i) => `${(i+1).toString().padStart(4)}| ${l}`).join('\n');
                result = `File: ${args.path}\n\`\`\`\n${lines}\n\`\`\``;
              }
            } else if (fnName === 'search_files') {
              const searchResult = await searchFilesInProject(projectPath as string, args.pattern, args.file_extension);
              if ('error' in searchResult) {
                result = `Error: ${searchResult.error}`;
              } else if (searchResult.results.length === 0) {
                result = `No matches found for "${args.pattern}"`;
              } else {
                result = searchResult.results.map(r => `${r.file}:\n${r.matches.join('\n')}`).join('\n\n');
              }
            } else {
              result = `Unknown tool: ${fnName}`;
            }
            
            conversationMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: result,
            });
            
            console.log(`[Tool] ${fnName}:`, args, '→', result.slice(0, 200));
          }
          
          toolLoopCount++;
        }
        
        setIsLoading(false);
        return;
      }
      
      const response = await fetch('https://api.aiassist.net/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...(provider && { 'X-AiAssist-Provider': provider }),
        },
        body: JSON.stringify({
          model: model || 'llama-3.3-70b-versatile',
          messages: conversationMessages,
          stream: true,
          temperature,
          max_tokens: maxTokens,
          max_completion_tokens: maxTokens,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.detail || errorData.error?.message || `API request failed (${response.status})`;
        throw new Error(errorMsg);
      }

      const contentType = response.headers.get('content-type') || '';
      
      if (contentType.includes('text/event-stream')) {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let accumulatedContent = '';

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') continue;

                try {
                  const parsed = JSON.parse(data);
                  const delta = parsed.choices?.[0]?.delta?.content || '';
                  accumulatedContent += delta;

                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMessageId
                        ? { ...m, content: accumulatedContent }
                        : m
                    )
                  );
                } catch {
                }
              }
            }
          }
        }
      } else {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? { ...m, content }
              : m
          )
        );
      }
    } catch (error) {
      const errorText = error instanceof Error ? error.message : 'Unknown error occurred';
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMessageId
            ? { ...m, content: `Error: ${errorText}` }
            : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const clearChat = () => {
    setMessages([]);
    setInput('');
  };

  const applyCodeToFile = async (filename: string, code: string) => {
    try {
      const projectPath = await window.electron.store.get('projectPath');
      if (!projectPath) {
        alert('No project open. Please open a project first.');
        return;
      }
      const filePath = `${projectPath}/${filename}`;
      await window.electron.fs.writeFile(filePath, code);
      onApplyEdit(filePath, code);
    } catch (error) {
      console.error('Failed to write file:', error);
      alert(`Failed to write file: ${error}`);
    }
  };

  const applySurgicalEdits = async (edits: SurgicalEdit[]) => {
    console.log('[Apply] Starting surgical edits:', edits.length, 'edits');
    try {
      const projectPath = await window.electron.store.get('projectPath');
      console.log('[Apply] Project path:', projectPath);
      
      if (!projectPath) {
        alert('No project open. Please open a project first.');
        return;
      }

      const editsByFile = edits.reduce((acc, edit) => {
        if (!acc[edit.file]) acc[edit.file] = [];
        acc[edit.file].push(edit);
        return acc;
      }, {} as Record<string, SurgicalEdit[]>);

      console.log('[Apply] Files to edit:', Object.keys(editsByFile));

      for (const [filename, fileEdits] of Object.entries(editsByFile)) {
        const isCreateOnly = fileEdits.every(e => e.type === 'create' || e.type === 'full_replace');
        const separator = String(projectPath).includes('\\') ? '\\' : '/';
        
        if (isCreateOnly) {
          const filePath = /^[a-zA-Z]:[\\\/]/.test(filename) || filename.startsWith('/')
            ? filename
            : `${projectPath}${separator}${filename.replace(/\//g, separator)}`;
          
          const newContent = fileEdits[0].content || '';
          console.log('[Apply] Creating new file:', filePath, 'Content length:', newContent.length);
          const writeResult = await window.electron.fs.writeFile(filePath, newContent);
          console.log('[Apply] Write result:', writeResult);
          onApplyEdit(filePath, newContent);
          console.log('[Apply] Successfully created:', filePath);
          continue;
        }
        
        const normalizedFilename = filename.replace(/\\/g, '/').toLowerCase();
        const baseFilename = filename.split('/').pop()?.toLowerCase() || filename.split('\\').pop()?.toLowerCase() || '';
        
        const openFile = openFiles.find((f) => {
          const normalizedPath = f.path.replace(/\\/g, '/').toLowerCase();
          const fileBasename = f.name.toLowerCase();
          return (
            normalizedPath.endsWith(normalizedFilename) ||
            normalizedPath.endsWith('/' + normalizedFilename) ||
            normalizedPath.includes('/' + normalizedFilename) ||
            fileBasename === baseFilename
          );
        });
        
        let filePath: string;
        let originalContent: string;
        
        if (openFile) {
          filePath = openFile.path;
          originalContent = openFile.content;
          console.log('[Apply] Found in open files:', openFile.name);
        } else {
          const isAbsolutePath = /^[a-zA-Z]:[\\\/]/.test(filename) || filename.startsWith('/');
          
          if (isAbsolutePath) {
            console.log('[Apply] Trying absolute path:', filename);
            const readResult = await window.electron.fs.readFile(filename);
            if (!readResult.error && readResult.content) {
              filePath = filename;
              originalContent = readResult.content;
            } else {
              alert(`File not found: ${filename}`);
              continue;
            }
          } else {
            filePath = `${projectPath}${separator}${filename.replace(/\//g, separator)}`;
            console.log('[Apply] Reading from disk:', filePath);
            
            const readResult = await window.electron.fs.readFile(filePath);
            if (readResult.error || !readResult.content) {
              alert(`File not found: ${filename}`);
              continue;
            }
            originalContent = readResult.content;
          }
        }

        const newContent = applyMultipleEdits(originalContent, fileEdits);
        console.log('[Apply] Writing to:', filePath, 'New content length:', newContent.length);
        const writeResult = await window.electron.fs.writeFile(filePath, newContent);
        console.log('[Apply] Write result:', writeResult);
        onApplyEdit(filePath, newContent);
        console.log('[Apply] Successfully applied edits to:', filePath);
      }
    } catch (error) {
      console.error('[Apply] Failed to apply surgical edits:', error);
      alert(`Failed to apply edits: ${error}`);
    }
  };

  const renderMessageContent = (content: string) => {
    const { edits, explanation } = parseSurgicalEdits(content);
    const parts = parseCodeBlocks(explanation);
    
    return (
      <>
        {edits.length > 0 && (
          <div className={`my-2 p-3 rounded-lg border ${
            keystoneMode 
              ? 'bg-green-500/10 border-green-500/30' 
              : 'bg-amber-500/10 border-amber-500/30'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <FileEdit className={`w-4 h-4 ${keystoneMode ? 'text-green-400' : 'text-amber-400'}`} />
                <span className={`text-sm font-medium ${keystoneMode ? 'text-green-400' : 'text-amber-400'}`}>
                  {keystoneMode ? 'Applied' : 'Surgical Edits'} ({edits.length})
                </span>
              </div>
              {!keystoneMode && (
                <button
                  onClick={() => {
                    console.log('[Apply All] Button clicked, edits:', edits);
                    applySurgicalEdits(edits);
                  }}
                  className="flex items-center gap-1 px-3 py-1 text-xs bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 rounded-lg transition-colors font-medium"
                >
                  <FileEdit className="w-3.5 h-3.5" />
                  Apply All
                </button>
              )}
            </div>
            <div className="space-y-2 text-xs">
              {edits.map((edit, i) => (
                <div key={i} className="border border-white/10 rounded-lg overflow-hidden">
                  <div className="flex items-center gap-2 px-2 py-1 bg-white/5">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-mono ${
                      edit.type === 'insert' ? 'bg-green-500/20 text-green-400' :
                      edit.type === 'delete' ? 'bg-red-500/20 text-red-400' :
                      'bg-blue-500/20 text-blue-400'
                    }`}>
                      {edit.type.toUpperCase()}
                    </span>
                    <span className="font-mono text-gray-400">{edit.file}</span>
                    <span className="text-gray-500">
                      {edit.type === 'insert' ? `after line ${edit.startLine - 1}` :
                       edit.endLine && edit.endLine !== edit.startLine 
                         ? `lines ${edit.startLine}-${edit.endLine}` 
                         : `line ${edit.startLine}`}
                    </span>
                  </div>
                  {edit.content && (
                    <pre className="p-2 bg-black/30 text-gray-300 font-mono text-xs overflow-x-auto max-h-32">
                      {edit.content}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {parts.map((part, index) => {
          if (typeof part === 'string') {
            return (
              <div key={index} className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-a:text-cyan-400 prose-code:text-cyan-300 prose-code:bg-white/10 prose-code:px-1 prose-code:rounded">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {part}
                </ReactMarkdown>
              </div>
            );
          }
          
          return (
            <div key={index} className="my-2 rounded-lg overflow-hidden border border-white/10">
              <div className="flex items-center justify-between px-3 py-1.5 bg-white/5 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-xs text-gray-400 font-mono">
                    {part.filename || part.language || 'code'}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {part.filename && (
                    <button
                      onClick={() => applyCodeToFile(part.filename!, part.code)}
                      className="flex items-center gap-1 px-2 py-0.5 text-xs bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 rounded transition-colors"
                    >
                      <FileEdit className="w-3 h-3" />
                      Apply
                    </button>
                  )}
                  <button
                    onClick={() => navigator.clipboard.writeText(part.code)}
                    className="flex items-center gap-1 px-2 py-0.5 text-xs text-gray-400 hover:text-white hover:bg-white/10 rounded transition-colors"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <pre className="p-3 text-xs overflow-x-auto bg-black/30">
                <code className="text-gray-300">{part.code}</code>
              </pre>
            </div>
          );
        })}
      </>
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#0a0a0f] relative">
      <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-cyan-500/10 via-transparent to-purple-500/10 pointer-events-none" />
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-purple-500/50 to-transparent" />
      
      <div className="px-4 py-3 border-b border-white/10 relative z-[200] bg-gradient-to-r from-cyan-500/5 via-transparent to-purple-500/5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 relative">
            <div className="relative">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              <motion.div
                className="absolute inset-0"
                animate={{ opacity: [0.3, 0.8, 0.3], rotate: [0, 180, 360] }}
                transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
              >
                <Sparkles className="w-4 h-4 text-purple-400" />
              </motion.div>
            </div>
            <span className="text-sm font-semibold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">Chat</span>
            {contextFiles.length > 0 && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-cyan-500/20 border border-cyan-500/30 rounded-full text-xs text-cyan-400">
                <Paperclip className="w-3 h-3" />
                {contextFiles.length} file{contextFiles.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium ${keystoneMode ? 'text-gray-500' : 'text-cyan-400'}`}>Debug</span>
              <button
                onClick={() => setKeystoneMode(!keystoneMode)}
                className={`relative w-10 h-5 rounded-full transition-all duration-300 ${
                  keystoneMode 
                    ? 'bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 shadow-lg shadow-amber-500/30' 
                    : 'bg-gray-600'
                }`}
                title={keystoneMode ? 'Keystone Mode: Auto-applies edits' : 'Debug Mode: Review before applying'}
              >
                <motion.div
                  className={`absolute top-0.5 w-4 h-4 rounded-full shadow-md ${
                    keystoneMode ? 'bg-white' : 'bg-white'
                  }`}
                  animate={{ left: keystoneMode ? '22px' : '2px' }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              </button>
              <div className="flex items-center gap-1">
                {keystoneMode && (
                  <motion.div
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    className="relative"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <motion.div
                      className="absolute inset-0"
                      animate={{ opacity: [0.5, 1, 0.5], scale: [1, 1.2, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    >
                      <Sparkles className="w-3.5 h-3.5 text-orange-400" />
                    </motion.div>
                  </motion.div>
                )}
                <span className={`text-xs font-medium ${
                  keystoneMode 
                    ? 'bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 bg-clip-text text-transparent' 
                    : 'text-gray-500'
                }`}>Keystone</span>
              </div>
            </div>
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                title="New chat"
              >
                <RotateCcw className="w-3 h-3" />
                New
              </button>
            )}
            <ModelSelector apiKey={apiKey} />
          </div>
        </div>

        {contextFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {contextFiles.map((path) => {
              const name = path.split('/').pop();
              return (
                <span
                  key={path}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-cyan-500/10 border border-cyan-500/30 rounded text-xs text-cyan-400"
                >
                  <FileCode className="w-3 h-3" />
                  {name}
                  <button
                    onClick={() => onRemoveFromContext(path)}
                    className="hover:text-white"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 relative z-0">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <div className="relative inline-block">
              <Bot className="w-16 h-16 text-cyan-500/50 mx-auto mb-4" />
              <motion.div
                className="absolute inset-0 flex items-center justify-center"
                animate={{ opacity: [0.2, 0.6, 0.2], scale: [0.95, 1.05, 0.95] }}
                transition={{ duration: 3, repeat: Infinity }}
              >
                <Sparkles className="w-6 h-6 text-purple-400" />
              </motion.div>
            </div>
            <p className="text-transparent bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-base font-medium">
              Ask me anything about your code
            </p>
            <p className="text-gray-500 text-xs mt-2">
              Add files to context for better assistance
            </p>
          </div>
        )}

        <AnimatePresence>
          {messages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : ''}`}
            >
              {message.role === 'assistant' && (
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/30 to-purple-500/30 flex items-center justify-center flex-shrink-0 border border-cyan-500/20">
                  <Bot className="w-4 h-4 text-cyan-400" />
                </div>
              )}

              <div
                className={`max-w-[85%] rounded-xl px-4 py-3 relative ${
                  message.role === 'user'
                    ? 'bg-gradient-to-br from-purple-500/20 to-cyan-500/20 text-white border border-purple-500/20'
                    : 'bg-white/5 text-gray-300 border border-white/10'
                }`}
              >
                <div className="text-sm">
                  {message.role === 'assistant' 
                    ? renderMessageContent(message.content)
                    : <div className="prose prose-invert prose-sm max-w-none">
                        <ReactMarkdown>{message.content}</ReactMarkdown>
                      </div>
                  }
                </div>
                {message.role === 'assistant' && (
                  <button
                    onClick={() => copyToClipboard(message.content, message.id)}
                    className="mt-2 flex items-center gap-1 text-xs text-gray-500 hover:text-white"
                  >
                    {copiedId === message.id ? (
                      <>
                        <Check className="w-3 h-3" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        Copy all
                      </>
                    )}
                  </button>
                )}
              </div>

              {message.role === 'user' && (
                <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-purple-400" />
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {isLoading && messages[messages.length - 1]?.role === 'assistant' && messages[messages.length - 1]?.content === '' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex gap-3"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/30 to-purple-500/30 flex items-center justify-center">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              >
                <Sparkles className="w-4 h-4 text-cyan-400" />
              </motion.div>
            </div>
            <div className="bg-white/5 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">coding</span>
                <span className="flex gap-0.5">
                  <motion.span
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: 0 }}
                    className="text-cyan-400"
                  >.</motion.span>
                  <motion.span
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}
                    className="text-cyan-400"
                  >.</motion.span>
                  <motion.span
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }}
                    className="text-cyan-400"
                  >.</motion.span>
                </span>
              </div>
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-white/10 relative z-10 bg-gradient-to-r from-cyan-500/5 via-transparent to-purple-500/5">
        <div className="relative group">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan-500/30 via-purple-500/30 to-cyan-500/30 rounded-xl opacity-0 group-focus-within:opacity-100 transition-opacity blur-sm" />
          <div className="relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your code..."
              rows={3}
              className="w-full px-4 py-3 pr-12 bg-[#0d0d12] border border-white/10 rounded-xl text-white placeholder:text-gray-500 resize-none focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || isLoading}
              className="absolute right-3 bottom-3 p-2 bg-gradient-to-r from-cyan-500 to-purple-500 hover:from-cyan-400 hover:to-purple-400 disabled:from-gray-600 disabled:to-gray-600 rounded-lg transition-all shadow-lg shadow-cyan-500/20"
            >
              <Send className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
