/**
 * permission/main.ts
 *
 * This page runs in a full browser tab (chrome-extension:// origin).
 * Unlike the side panel, a full tab CAN trigger the native browser
 * permission popup via getUserMedia().
 *
 * Flow:
 *   1. Page opens → auto-requests getUserMedia({ audio: true })
 *   2. Browser shows native "Allow microphone?" prompt
 *   3. User clicks Allow → we send MIC_PERMISSION_GRANTED via chrome.runtime
 *   4. The side panel's onMessage listener picks this up and starts dictation
 *   5. This tab auto-closes
 */

async function requestPermission() {
  const btn = document.getElementById('request-btn') as HTMLButtonElement;
  const status = document.getElementById('status-text') as HTMLDivElement;

  if (btn && status) {
    btn.disabled = true;
    btn.textContent = 'Requesting...';
    status.style.color = '';
    status.textContent = 'Prompting for microphone access...';
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Stop all tracks immediately — we only needed this to trigger the prompt
    stream.getTracks().forEach((track) => track.stop());

    if (status) {
      status.style.color = '#10b981';
      status.textContent = 'Microphone permission granted! Closing tab...';
    }

    // Notify the side panel that permission is now granted
    chrome.runtime.sendMessage({ type: 'MIC_PERMISSION_GRANTED' });

    // Close this tab after a brief moment so the user sees the success message
    setTimeout(() => {
      window.close();
    }, 600);
  } catch (err) {
    console.error('Microphone permission request failed:', err);
    if (status) {
      status.style.color = '#ef4444';
      status.textContent =
        'Permission denied. Click the button to try again, or check your browser site settings.';
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Try Again';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('request-btn');
  if (btn) {
    btn.addEventListener('click', requestPermission);
  }

  // Auto-request on page load — this page was opened intentionally by the user
  // clicking "Dictate", so auto-prompting is expected behavior.
  requestPermission();
});
