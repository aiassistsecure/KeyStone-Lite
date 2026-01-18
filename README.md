# KeyStone Lite

**Your AI pair programmer, running locally.** Ship code faster with surgical AI edits that actually work.

KeyStone Lite is a desktop code editor with built-in AI that understands your codebase and makes precise, line-level changes. No more copy-pasting from ChatGPT. No more broken suggestions. Just ask, review, apply.

## Interface Overview

![Keystone Lite](https://i.ibb.co/tp31STbp/Keystone-Lite-1-17-26-10-22-27-PM.png)
![Keystone Lite](https://i.ibb.co/pvj5bBc4/Keystone-Lite-1-17-26-10-22-47-PM.png)
![Keystone Lite](https://i.ibb.co/zT18pLx5/Keystone-Lite-1-17-26-3-51-15-PM.png)

## Why KeyStone?

### For Developers

- **Actually understands your files** - Your active file is automatically included with line numbers, so the AI knows exactly where to make changes
- **Surgical precision** - No more "here's the whole file rewritten." KeyStone uses INSERT, REPLACE, DELETE operations on specific lines
- **11+ LLM providers** - Groq, OpenAI, Anthropic, Gemini, Mistral, Cohere, DeepSeek, or your own local Ollama instance
- **Two modes for two mindsets** - Debug mode lets you review before applying. Keystone mode auto-applies for rapid iteration

### For Founders & Teams

- **Ship MVPs faster** - Stop context-switching between AI chat and your editor. It's all in one place
- **Bring your own keys** - Use your existing API keys. Pay for what you use, no per-seat SaaS pricing
- **White-label ready** - Fork it, brand it, ship it as your own dev tool (see licensing)

## Quick Start

1. **Get an API key** from [aiassist.net](https://aiassist.net)
2. **Download** the latest release for your platform
3. **Open a project folder** and start coding with AI

```bash
# Or run from source
cd keystone-lite
npm install
npm run dev      # Start Vite dev server
npm start        # Launch Electron (in another terminal)
```

## Features at a Glance

| Feature | Description |
|---------|-------------|
| **Multi-file context** | Add multiple files to AI context with one click |
| **Surgical edits** | Line-precise INSERT, REPLACE, DELETE operations |
| **Mode toggle** | Debug (review first) or Keystone (auto-apply) |
| **Project templates** | Static HTML/TailWindCSS, React, Express, FastAPI, Electron starters |
| **Monaco editor** | Full VS Code editing experience |
| **Custom endpoints** | Connect any OpenAI-compatible API |
| **Secure by default** | Files sandboxed to project, keys encrypted locally |

## How It Works

### 1. Open Your Project
Click "Open Folder" or drag a directory. Your file tree appears in the sidebar.

### 2. Chat With Your Code
Open a file - it's automatically added to the AI's context with line numbers. Ask questions or request changes.

### 3. Review & Apply
The AI responds with precise edit blocks:

```
<<<EDIT app.tsx>>>
<<<REPLACE lines 15-20>>>
const handleSubmit = async (data: FormData) => {
  const response = await api.post('/submit', data);
  return response.json();
};
<<<END>>>
```

In Debug mode, click "Apply All" to apply. In Keystone mode, changes apply instantly.

## Supported Providers

| Provider | Models |
|----------|--------|
| **Groq** | Llama 3.3 70B, Mixtral, Gemma 2 |
| **OpenAI** | GPT-4o, GPT-4 Turbo, o1 |
| **Anthropic** | Claude 3.5 Sonnet, Claude 3 Opus |
| **Google** | Gemini 1.5 Pro, Gemini 2.0 Flash |
| **Mistral** | Mistral Large, Codestral |
| **xAI** | xAI Grok |
| **TogetherAI** | Open-source at scale |
| **OpenRouter** | Multi-provider access |
| **DeepSeek** | DeepSeek Coder, DeepSeek Chat |
| **Fireworks AI** | Fast open-source |
| **Perplexity** | Search-augmented AI |
| **PIN Network** | Decentralized inference |

## Building for Distribution

```bash
npm run dist        # Build for current platform
npm run dist:all    # Build for Mac, Windows, Linux
```

Installers are output to the `dist/` folder.

## For Contributors

### Architecture

```
keystone-lite/
├── src/
│   ├── main/              # Electron main process
│   │   ├── index.ts       # IPC handlers, file ops
│   │   └── preload.ts     # Context bridge
│   └── renderer/          # React frontend
│       ├── components/    # ChatPanel, EditorTabs, ModelSelector
│       ├── lib/           # surgical-edit.ts parser
│       └── pages/         # MainLayout
├── templates/             # Project starters
└── assets/               # Icons and images
```

### Key Files

| File | Purpose |
|------|---------|
| `ChatPanel.tsx` | AI chat, API calls, system prompts |
| `ModelSelector.tsx` | Provider/model selection |
| `surgical-edit.ts` | Edit parsing and application |
| `MainLayout.tsx` | App layout and state |
| `index.ts` (main) | File system operations |

## Security

- API keys encrypted at rest via electron-store
- All file operations sandboxed to opened project
- No telemetry, no tracking, no phone-home
- Context isolation enabled in Electron

## License

**Business Source License 1.1** - See [LICENSE](./LICENSE)

- Free for personal use, development, and evaluation
- Production use requires AiAS API keys or commercial license
- Forks for distribution require written authorization from Interchained LLC
- Converts to MIT License on January 1, 2030

For commercial licensing: dev@interchained.org

## Links

- **API Keys & Platform**: [aiassist.net](https://aiassist.net)
- **Issues & PRs**: [GitHub](https://github.com/aiassistsecure/keystone-lite)
- **Enterprise Licensing**: dev@interchained.org

---

**Built by [AiAssist Secure (AiAS) of Interchained LLC](https://aiassist.net)** - Powering the next generation of AI-assisted workflows.
