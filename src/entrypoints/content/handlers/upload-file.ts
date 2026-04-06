/**
 * UPLOAD_FILE handler — injects a file into an <input type="file"> element
 * using a two-phase strategy: set files via native setter + simulate drag-drop.
 */

export function handleUploadFile(
  msg: {
    x: number;
    y: number;
    fileName: string;
    mimeType: string;
    base64Data: string;
  },
  sendResponse: (response: unknown) => void,
): void {
  const { x, y, fileName, mimeType, base64Data } = msg;

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
      if (dist < minDist) {
        minDist = dist;
        target = inp;
      }
    }
    // No visible input found — fall back to the first hidden one.
    if (!target) target = fileInputs[0];
  }

  if (!target) {
    sendResponse({ success: false, error: 'No file input found on page' });
    return;
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
      HTMLInputElement.prototype,
      'files',
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
        if (dist < minDist) {
          minDist = dist;
          dropZone = el;
        }
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
}
