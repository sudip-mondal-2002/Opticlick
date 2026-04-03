/**
 * Content Script — Opticlick Annotator
 *
 * 1. Discover all interactable elements (including open Shadow DOMs).
 * 2. Filter occluded / invisible elements via elementFromPoint.
 * 3. Render a unified <canvas> overlay with numbered bounding boxes.
 * 4. Block user input while agent is running.
 * 5. Return coordinate map to background service worker.
 */

import { drawOverlay, destroyOverlay } from './content/overlay';
import { installBlocker, removeBlocker } from './content/blocker';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',

  main() {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      switch (msg.type) {
        case 'DRAW_MARKS': {
          drawOverlay().then((coordinateMap) => {
            sendResponse({
              success: true,
              coordinateMap,
              dpr: window.devicePixelRatio || 1,
            });
          });
          break;
        }

        case 'DESTROY_MARKS': {
          destroyOverlay();
          sendResponse({ success: true });
          break;
        }

        case 'BLOCK_INPUT': {
          installBlocker().then(() => sendResponse({ success: true }));
          break;
        }

        case 'UNBLOCK_INPUT': {
          removeBlocker();
          sendResponse({ success: true });
          break;
        }

        case 'PING': {
          sendResponse({ alive: true });
          break;
        }

        case 'GET_ELEMENT_DOM': {
          const { x, y } = msg as { x: number; y: number };

          // Collect all interactables and find the one closest to (x, y).
          // We deliberately avoid elementFromPoint because the blocker overlay
          // sits on top and would return the wrong element.
          const candidates = Array.from(document.querySelectorAll('*')) as HTMLElement[];
          let closest: HTMLElement | null = null;
          let minDist = Infinity;
          for (const el of candidates) {
            if (!(el instanceof HTMLElement)) continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const dist = Math.hypot(cx - x, cy - y);
            if (dist < minDist) { minDist = dist; closest = el; }
          }

          if (!closest) {
            sendResponse({ success: false, error: 'No element found near coordinates' });
            break;
          }

          const MAX_CHARS = 40_000;
          const full = closest.outerHTML;
          const truncated = full.length > MAX_CHARS;
          sendResponse({
            success: true,
            outerHTML: truncated ? full.slice(0, MAX_CHARS) + '\n<!-- [truncated] -->' : full,
            tag: closest.tagName.toLowerCase(),
            truncated,
          });
          break;
        }

        case 'UPLOAD_FILE': {
          const { x, y, fileName, mimeType, base64Data } = msg as {
            x: number; y: number; fileName: string; mimeType: string; base64Data: string;
          };

          // Search ALL file inputs — including hidden ones (display:none, opacity:0,
          // etc.) which is the common pattern: a styled button visible to the user,
          // a hidden <input type="file"> doing the actual work underneath.
          const fileInputs = Array.from(
            document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
          );

          let target: HTMLInputElement | null = null;

          if (fileInputs.length === 1) {
            // Single file input on the page — use it regardless of position/visibility.
            target = fileInputs[0];
          } else if (fileInputs.length > 1) {
            // Prefer visible inputs near the clicked coordinates.
            let minDist = Infinity;
            for (const inp of fileInputs) {
              const r = inp.getBoundingClientRect();
              if (r.width === 0 && r.height === 0) continue; // hidden — skip for proximity
              const cx = r.left + r.width / 2;
              const cy = r.top + r.height / 2;
              const dist = Math.hypot(cx - x, cy - y);
              if (dist < minDist) { minDist = dist; target = inp; }
            }
            // No visible input found — fall back to the first hidden one.
            if (!target) target = fileInputs[0];
          }

          if (!target) {
            sendResponse({ success: false, error: 'No file input found on page' });
            break;
          }

          try {
            // Decode base64 → Uint8Array → File
            const binary = atob(base64Data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const file = new File([bytes], fileName, { type: mimeType });

            const dt = new DataTransfer();
            dt.items.add(file);

            // ── Strategy 1: Set files directly on the hidden <input type="file"> ──
            const nativeSetter = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype, 'files',
            )?.set;
            if (nativeSetter) nativeSetter.call(target, dt.files);
            else target.files = dt.files;

            target.dispatchEvent(new Event('change', { bubbles: true }));
            target.dispatchEvent(new Event('input', { bubbles: true }));

            // ── Strategy 2: Simulate drag-and-drop on the visible upload zone ──
            // Modern JS upload widgets (CloudConvert, Dropzone.js, react-dropzone,
            // etc.) listen for drop events on a container rather than change events
            // on the hidden input. Walk up from the input to find the first visible
            // ancestor that's large enough to be a drop zone.
            let dropZone: HTMLElement | null = target.parentElement;
            while (dropZone && dropZone !== document.body) {
              const r = dropZone.getBoundingClientRect();
              if (r.width >= 50 && r.height >= 50) break;
              dropZone = dropZone.parentElement;
            }
            if (!dropZone || dropZone === document.body) {
              // Fallback: find the visible element closest to the click coordinates
              const allEls = Array.from(document.querySelectorAll('*')) as HTMLElement[];
              let minDist = Infinity;
              for (const el of allEls) {
                const r = el.getBoundingClientRect();
                if (r.width < 50 || r.height < 50) continue;
                const cx = r.left + r.width / 2;
                const cy = r.top + r.height / 2;
                const dist = Math.hypot(cx - x, cy - y);
                if (dist < minDist) { minDist = dist; dropZone = el; }
              }
            }

            if (dropZone) {
              const dropDt = new DataTransfer();
              dropDt.items.add(file);
              const opts = { dataTransfer: dropDt, bubbles: true, cancelable: true };
              dropZone.dispatchEvent(new DragEvent('dragenter', opts));
              dropZone.dispatchEvent(new DragEvent('dragover', opts));
              dropZone.dispatchEvent(new DragEvent('drop', opts));
            }

            sendResponse({ success: true });
          } catch (err) {
            sendResponse({ success: false, error: (err as Error).message });
          }
          break;
        }

        default:
          break;
      }

      return true;
    });
  },
});
