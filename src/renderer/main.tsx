import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/globals.css';
import { installBrowserBridgeIfNeeded } from './lib/browser-bridge';

// In Electron, the preload script exposes the real bridge as the read-only
// window.electronHost. Copy it onto window.electron (a normal writable
// property) so demo/remote bridge swaps can reassign it without crashing.
const hostBridge = (window as unknown as { electronHost?: Window['electron'] }).electronHost;
if (hostBridge) {
  window.electron = hostBridge;
}

installBrowserBridgeIfNeeded();

import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

loader.config({ monaco });

import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
