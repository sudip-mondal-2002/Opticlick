import { useState, useEffect } from 'react';

const STORAGE_KEY_API = 'langsmithApiKey';
const STORAGE_KEY_PROJECT = 'langsmithProject';
const STORAGE_KEY_ENDPOINT = 'langsmithEndpoint';

export function LangSmithPanel() {
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [project, setProject] = useState('opticlick-sandbox');
  const [endpoint, setEndpoint] = useState('https://api.smith.langchain.com');
  const [saved, setSaved] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const k = localStorage.getItem(STORAGE_KEY_API) ?? '';
    const p = localStorage.getItem(STORAGE_KEY_PROJECT) ?? 'opticlick-sandbox';
    const e = localStorage.getItem(STORAGE_KEY_ENDPOINT) ?? 'https://api.smith.langchain.com';
    setApiKey(k);
    setProject(p);
    setEndpoint(e);
    if (k) setSaved(true);
  }, []);

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY_API, apiKey.trim());
    localStorage.setItem(STORAGE_KEY_PROJECT, project.trim());
    localStorage.setItem(STORAGE_KEY_ENDPOINT, endpoint.trim());

    // Also set as chrome.storage.local so langsmith-config.ts picks them up
    chrome.storage.local.set({
      langsmithApiKey: apiKey.trim(),
      langsmithProject: project.trim(),
      langsmithEndpoint: endpoint.trim(),
    });

    setSaved(true);
  };

  const handleClear = () => {
    localStorage.removeItem(STORAGE_KEY_API);
    localStorage.removeItem(STORAGE_KEY_PROJECT);
    localStorage.removeItem(STORAGE_KEY_ENDPOINT);
    chrome.storage.local.remove(['langsmithApiKey', 'langsmithProject', 'langsmithEndpoint']);
    setApiKey('');
    setProject('opticlick-sandbox');
    setEndpoint('https://api.smith.langchain.com');
    setSaved(false);
  };

  return (
    <div className="langsmith-panel">
      <div
        className="langsmith-header"
        onClick={() => setOpen(o => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && setOpen(o => !o)}
      >
        <span className="langsmith-icon">🦜</span>
        <span className="langsmith-title">LangSmith Tracing</span>
        <span className={`langsmith-status ${saved && apiKey ? 'active' : 'inactive'}`}>
          {saved && apiKey ? 'Active' : 'Optional'}
        </span>
        <span className={`langsmith-chevron${open ? ' open' : ''}`}>▼</span>
      </div>

      {open && (
        <div className="langsmith-body">
          <div className="langsmith-row">
            <label className="langsmith-label">API Key</label>
            <input
              className="langsmith-input"
              type="password"
              value={apiKey}
              onChange={e => { setApiKey(e.target.value); setSaved(false); }}
              placeholder="ls-..."
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="langsmith-row">
            <label className="langsmith-label">Project Name</label>
            <input
              className="langsmith-input"
              type="text"
              value={project}
              onChange={e => { setProject(e.target.value); setSaved(false); }}
              placeholder="opticlick-sandbox"
            />
          </div>
          <div className="langsmith-row">
            <label className="langsmith-label">Endpoint</label>
            <input
              className="langsmith-input"
              type="text"
              value={endpoint}
              onChange={e => { setEndpoint(e.target.value); setSaved(false); }}
              placeholder="https://api.smith.langchain.com"
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
            {saved && apiKey && (
              <button
                onClick={handleClear}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#64748b',
                  padding: '5px 12px',
                  borderRadius: 6,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            )}
            <button className="langsmith-save-btn" onClick={handleSave}>
              {saved ? '✓ Saved' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
