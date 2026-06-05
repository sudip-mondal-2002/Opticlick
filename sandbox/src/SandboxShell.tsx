import React, { Suspense } from 'react';
import { MockBrowser } from './MockBrowser';
import { LangSmithPanel } from './LangSmithPanel';
import { ProxySettingsPanel } from './ProxySettingsPanel';

// Lazily import the real sidepanel App — it triggers chrome.* calls on mount,
// so chrome-mock must be fully installed before this import resolves.
const SidepanelApp = React.lazy(() => import('@/entrypoints/sidepanel/App'));


function SidebarLoadingFallback() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      background: '#fff',
      gap: 12,
      color: '#94a3b8',
      fontSize: 13,
    }}>
      <div style={{
        width: 28,
        height: 28,
        border: '2px solid rgba(99,102,241,0.3)',
        borderTopColor: '#6366f1',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />
      Loading sidepanel…
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export function SandboxShell() {
  return (
    <div className="sandbox-shell">
      {/* ── Main Split ─────────────────────────────────────────────────────── */}
      <div className="sandbox-content">
        {/* Left: Real sidepanel */}
        <div className="sandbox-sidebar">
          <Suspense fallback={<SidebarLoadingFallback />}>
            <SidepanelApp />
          </Suspense>
        </div>

        {/* Right: Mock browser + LangSmith */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <MockBrowser initialUrl="https://example.com" />
          <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
            <ProxySettingsPanel />
            <LangSmithPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
