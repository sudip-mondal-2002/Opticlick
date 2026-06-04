/**
 * Sandbox entry point.
 *
 * CRITICAL: chrome-mock/index.ts MUST be imported first (side-effectful —
 * sets window.chrome before any other module runs).
 */

// 1. Install chrome shims — must be first
import './chrome-mock/index';

// 2. Import CSS — sidepanel Tailwind styles first, then sandbox layout styles
import '@/entrypoints/sidepanel/style.css';
import './sandbox.css';

// 3. Mount React app
import React from 'react';
import ReactDOM from 'react-dom/client';
import { SandboxShell } from './SandboxShell';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SandboxShell />
  </React.StrictMode>,
);
