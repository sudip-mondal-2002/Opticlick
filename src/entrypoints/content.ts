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

        default:
          break;
      }

      return true;
    });
  },
});
