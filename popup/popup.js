/**
 * popup.js — Opticlick Engine popup UI controller.
 * Sends commands to the background service worker and reflects live state.
 */

const promptInput  = document.getElementById('prompt-input');
const btnRun       = document.getElementById('btn-run');
const btnStop      = document.getElementById('btn-stop');
const logOutput    = document.getElementById('log-output');
const statusDot    = document.getElementById('status-dot');
const stepCounter  = document.getElementById('step-counter');

// ── Logging ─────────────────────────────────────────────────────────────────

function appendLog(message, level = 'info') {
  const entry = document.createElement('div');
  entry.className = `entry ${level}`;
  const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  entry.textContent = `[${ts}] ${message}`;
  logOutput.appendChild(entry);
  logOutput.scrollTop = logOutput.scrollHeight;
}

// ── State sync from storage ──────────────────────────────────────────────────

async function syncState() {
  const { agentState } = await chrome.storage.session.get('agentState');
  if (!agentState) return;

  const isRunning = agentState.status === 'running';

  btnRun.disabled  = isRunning;
  btnStop.disabled = !isRunning;
  promptInput.disabled = isRunning;

  statusDot.className = 'status-dot' + (isRunning ? ' running' : agentState.status === 'error' ? ' error' : '');

  if (agentState.step > 0) {
    stepCounter.textContent = `Step ${agentState.step}`;
  }
}

// ── Message listener from background ────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'AGENT_LOG') {
    appendLog(msg.message, msg.level || 'info');
  }
  if (msg.type === 'AGENT_STATE_CHANGE') {
    syncState();
  }
});

// ── Run ──────────────────────────────────────────────────────────────────────

btnRun.addEventListener('click', async () => {
  const prompt = promptInput.value.trim();
  if (!prompt) {
    appendLog('Please enter a task prompt.', 'warn');
    return;
  }

  appendLog(`Starting agent: "${prompt.slice(0, 60)}${prompt.length > 60 ? '…' : ''}"`, 'ok');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    appendLog('No active tab found.', 'error');
    return;
  }

  btnRun.disabled  = true;
  btnStop.disabled = false;
  promptInput.disabled = true;
  statusDot.className = 'status-dot running';
  stepCounter.textContent = 'Step 0';

  chrome.runtime.sendMessage({
    type: 'START_AGENT',
    tabId: tab.id,
    prompt,
  });
});

// ── Stop ─────────────────────────────────────────────────────────────────────

btnStop.addEventListener('click', () => {
  appendLog('Stop requested.', 'warn');
  chrome.runtime.sendMessage({ type: 'STOP_AGENT' });

  btnRun.disabled  = false;
  btnStop.disabled = true;
  promptInput.disabled = false;
  statusDot.className = 'status-dot';
});

// ── Init ─────────────────────────────────────────────────────────────────────

(async () => {
  await syncState();

  // Replay last few log entries if agent is mid-run
  const { agentLog } = await chrome.storage.session.get('agentLog');
  if (Array.isArray(agentLog)) {
    agentLog.slice(-20).forEach(({ message, level }) => appendLog(message, level));
  }
})();
