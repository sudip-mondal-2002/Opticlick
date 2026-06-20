/**
 * CDP Command Handlers for Sandbox
 * Implements SOLID principles (SRP, OCP, DIP) for simulated CDP command execution.
 */

export interface CDPContext {
  win: Window | null;
  doc: Document | null;
  objectIdMap: Map<string, HTMLElement>;
  virtualFiles: Map<string, { data: string; filename: string; mimeType: string }>;
  getHtml2Canvas: () => Promise<any>;
}

export interface CDPCommandHandler {
  method: string;
  execute(params: Record<string, any> | undefined, ctx: CDPContext): Promise<any> | any;
}

export class CDPCommandRegistry {
  private handlers = new Map<string, CDPCommandHandler>();

  register(handler: CDPCommandHandler): void {
    this.handlers.set(handler.method, handler);
  }

  get(method: string): CDPCommandHandler | undefined {
    return this.handlers.get(method);
  }
}

// ── 1. Page.captureScreenshot ────────────────────────────────────────────────
export class CaptureScreenshotHandler implements CDPCommandHandler {
  readonly method = 'Page.captureScreenshot';

  async execute(params: Record<string, any> | undefined, ctx: CDPContext): Promise<any> {
    const { win, doc, getHtml2Canvas } = ctx;
    if (!doc?.body || !win) {
      throw new Error('Sandbox: iframe not ready for screenshot');
    }
    const h2c = await getHtml2Canvas();
    const canvas = await h2c(doc.body, {
      useCORS: true,
      allowTaint: true,
      scale: 1, // Cap at 1x resolution to keep performance fast and prevent thread freeze
      logging: false,
      foreignObjectRendering: false,
      width: win.innerWidth,
      height: win.innerHeight,
      scrollX: win.scrollX,
      scrollY: win.scrollY,
      windowWidth: win.innerWidth,
      windowHeight: win.innerHeight,
    });
    // Return raw base64 without data-URI prefix (matches real CDP response)
    const dataUrl = canvas.toDataURL('image/png');
    return { data: dataUrl.replace(/^data:image\/png;base64,/, '') };
  }
}

// ── 2. Input.dispatchMouseEvent ──────────────────────────────────────────────
export class DispatchMouseEventHandler implements CDPCommandHandler {
  readonly method = 'Input.dispatchMouseEvent';

  execute(params: Record<string, any> | undefined, ctx: CDPContext): any {
    const { win, doc } = ctx;
    if (!win || !doc) return {};

    const { type, x = 0, y = 0, button = 'left', clickCount = 1, modifiers = 0 } = params ?? {};
    const evtType = {
      mousePressed: 'mousedown',
      mouseReleased: 'mouseup',
      mouseMoved: 'mousemove',
      mouseWheel: 'wheel',
    }[type as string] ?? (type as string);

    if (evtType === 'wheel') {
      const el = doc.elementFromPoint(x as number, y as number) ?? doc.body;
      el?.dispatchEvent(new WheelEvent('wheel', {
        clientX: x as number,
        clientY: y as number,
        deltaX: (params?.deltaX as number) ?? 0,
        deltaY: (params?.deltaY as number) ?? 0,
        bubbles: true,
        cancelable: true,
      }));
    } else {
      const btnMap: Record<string, number> = { none: 0, left: 0, middle: 1, right: 2 };
      const evtInit: PointerEventInit = {
        clientX: x as number,
        clientY: y as number,
        button: btnMap[button as string] ?? 0,
        buttons: evtType === 'mousedown' ? 1 : 0,
        bubbles: true,
        cancelable: true,
        ctrlKey: !!(modifiers as number & 2),
        shiftKey: !!(modifiers as number & 8),
        altKey: !!(modifiers as number & 1),
        metaKey: !!(modifiers as number & 4),
        detail: clickCount as number,
      };
      const el = doc.elementFromPoint(x as number, y as number) ?? doc.body;
      el?.dispatchEvent(new PointerEvent('pointer' + evtType.replace('mouse', ''), { ...evtInit, bubbles: true }));
      el?.dispatchEvent(new MouseEvent(evtType, evtInit));
      if (evtType === 'mouseup') {
        el?.dispatchEvent(new MouseEvent('click', { ...evtInit, detail: 1 }));
      }
    }
    return {};
  }
}

// ── 3. Input.insertText ──────────────────────────────────────────────────────
export class InsertTextHandler implements CDPCommandHandler {
  readonly method = 'Input.insertText';

  execute(params: Record<string, any> | undefined, ctx: CDPContext): any {
    const { win, doc } = ctx;
    if (!win) return {};

    const text = (params?.text as string) ?? '';
    const active = doc?.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    if (active && ('value' in active)) {
      let proto = Object.getPrototypeOf(active);
      let nativeInputValueSetter = null;
      while (proto) {
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc?.set) {
          nativeInputValueSetter = desc.set;
          break;
        }
        proto = Object.getPrototypeOf(proto);
      }

      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(active, active.value + text);
      } else {
        active.value += text;
      }
      active.dispatchEvent(new win.InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
      active.dispatchEvent(new win.Event('change', { bubbles: true }));
    } else {
      // Fallback: contenteditable
      try { doc?.execCommand('insertText', false, text); } catch { /* */ }
    }
    return {};
  }
}

// ── 4. Input.dispatchKeyEvent ───────────────────────────────────────────────
export class DispatchKeyEventHandler implements CDPCommandHandler {
  readonly method = 'Input.dispatchKeyEvent';

  execute(params: Record<string, any> | undefined, ctx: CDPContext): any {
    const { win, doc } = ctx;
    if (!win || !doc) return {};

    const { type: kType, key = '', code = '', modifiers = 0, windowsVirtualKeyCode = 0 } = params ?? {};
    const evtType = kType === 'keyDown' ? 'keydown' : kType === 'keyUp' ? 'keyup' : 'keypress';
    const target = doc.activeElement ?? doc.body;
    target?.dispatchEvent(new win.KeyboardEvent(evtType, {
      key: key as string,
      code: code as string,
      keyCode: windowsVirtualKeyCode as number,
      which: windowsVirtualKeyCode as number,
      ctrlKey: !!(modifiers as number & 2),
      shiftKey: !!(modifiers as number & 8),
      altKey: !!(modifiers as number & 1),
      metaKey: !!(modifiers as number & 4),
      bubbles: true,
      cancelable: true,
    }));
    return {};
  }
}

// ── 5. Runtime.evaluate ──────────────────────────────────────────────────────
export class RuntimeEvaluateHandler implements CDPCommandHandler {
  readonly method = 'Runtime.evaluate';

  execute(params: Record<string, any> | undefined, ctx: CDPContext): any {
    const { win, objectIdMap } = ctx;
    if (!win) return { result: { type: 'undefined', value: undefined } };

    try {
      const expr = params?.expression as string;
      let value;
      try {
        // Attempt to treat it as a returnable expression first
        const fn = new win.Function(`return (${expr});`);
        value = fn();
      } catch {
        // Fall back to statement block execution
        const fn = new win.Function(expr);
        value = fn();
      }

      let result: Record<string, unknown> = { type: typeof value, value };
      if (value && typeof value === 'object') {
        const isDomElement = (win.HTMLElement && value instanceof win.HTMLElement) ||
                             (typeof (value as any).nodeType === 'number');
        if (isDomElement) {
          const objectId = 'node_' + Math.random().toString(36).slice(2);
          objectIdMap.set(objectId, value as HTMLElement);
          result = {
            type: 'object',
            subtype: 'node',
            objectId
          };
        }
      }
      return { result };
    } catch (e) {
      return { result: { type: 'undefined' }, exceptionDetails: { text: (e as Error).message } };
    }
  }
}

// ── 6. DOM.setFileInputFiles ─────────────────────────────────────────────────
export class DOMSetFileInputFilesHandler implements CDPCommandHandler {
  readonly method = 'DOM.setFileInputFiles';

  execute(params: Record<string, any> | undefined, ctx: CDPContext): any {
    const { win, objectIdMap, virtualFiles } = ctx;
    const { objectId, files } = params ?? {};
    const inputEl = objectIdMap.get(objectId as string) as HTMLInputElement | undefined;
    if (!inputEl) {
      console.error('[sandbox] DOM.setFileInputFiles: input element not found for objectId', objectId);
      return {};
    }
    if (Array.isArray(files) && files.length > 0) {
      const fileItem = files[0];
      if (win) {
        try {
          let file: File;
          if (typeof fileItem === 'string') {
            const fileData = virtualFiles.get(fileItem);
            if (fileData) {
              const bytes = Uint8Array.from(atob(fileData.data), c => c.charCodeAt(0));
              file = new win.File([bytes], fileData.filename, { type: fileData.mimeType });
            } else {
              file = new win.File([new TextEncoder().encode(fileItem)], 'file.txt', { type: 'text/plain' });
            }
          } else if (fileItem instanceof win.File || fileItem instanceof File) {
            file = fileItem as File;
          } else if (fileItem instanceof ArrayBuffer || ArrayBuffer.isView(fileItem)) {
            file = new win.File([fileItem], 'file.bin', { type: 'application/octet-stream' });
          } else if (fileItem && typeof fileItem === 'object' && ('buffer' in fileItem || 'data' in fileItem)) {
            const data = (fileItem as any).buffer || (fileItem as any).data || fileItem;
            file = new win.File([data], 'file.bin', { type: 'application/octet-stream' });
          } else {
            file = new win.File([String(fileItem)], 'file.txt', { type: 'text/plain' });
          }

          const dt = new win.DataTransfer();
          dt.items.add(file);
          inputEl.files = dt.files;
          inputEl.dispatchEvent(new win.Event('change', { bubbles: true }));
          inputEl.dispatchEvent(new win.Event('input', { bubbles: true }));
        } catch (err) {
          console.error('[sandbox] DOM.setFileInputFiles failed to set files:', err);
        }
      }
    }
    return {};
  }
}

// ── 7. Page.setInterceptFileChooserDialog ────────────────────────────────────
export class PageSetInterceptFileChooserDialogHandler implements CDPCommandHandler {
  readonly method = 'Page.setInterceptFileChooserDialog';

  execute(): any {
    return {};
  }
}

// Initialize and export standard registry with default handlers
export const defaultCDPRegistry = new CDPCommandRegistry();
defaultCDPRegistry.register(new CaptureScreenshotHandler());
defaultCDPRegistry.register(new DispatchMouseEventHandler());
defaultCDPRegistry.register(new InsertTextHandler());
defaultCDPRegistry.register(new DispatchKeyEventHandler());
defaultCDPRegistry.register(new RuntimeEvaluateHandler());
defaultCDPRegistry.register(new DOMSetFileInputFilesHandler());
defaultCDPRegistry.register(new PageSetInterceptFileChooserDialogHandler());
