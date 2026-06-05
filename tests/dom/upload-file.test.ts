import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { handleUploadFile } from '@/entrypoints/content/handlers/upload-file';

describe('handleUploadFile', () => {
  let originalFilesProp: any;
  const filesStore = new WeakMap<HTMLInputElement, any>();

  beforeAll(() => {
    globalThis.DataTransfer = class {
      items = {
        add: (file: any) => {
          this.files.push(file);
        }
      };
      files: any[] = [];
    } as any;

    globalThis.DragEvent = class extends Event {
      dataTransfer: any;
      constructor(type: string, options: any = {}) {
        super(type, options);
        this.dataTransfer = options.dataTransfer;
      }
    } as any;

    originalFilesProp = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
    Object.defineProperty(HTMLInputElement.prototype, 'files', {
      get() {
        return filesStore.get(this) || [];
      },
      set(val) {
        filesStore.set(this, val);
      },
      configurable: true,
    });
  });

  afterAll(() => {
    delete (globalThis as any).DataTransfer;
    delete (globalThis as any).DragEvent;
    if (originalFilesProp) {
      Object.defineProperty(HTMLInputElement.prototype, 'files', originalFilesProp);
    }
  });

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('uploads file successfully to single file input', () => {
    const input = document.createElement('input');
    input.type = 'file';
    document.body.appendChild(input);

    const changeSpy = vi.fn();
    input.addEventListener('change', changeSpy);

    const sendResponse = vi.fn();
    // base64 for 'hello' is 'aGVsbG8='
    handleUploadFile({
      x: 10, y: 10, fileName: 'test.txt', mimeType: 'text/plain', base64Data: 'aGVsbG8='
    }, sendResponse);

    expect(sendResponse).toHaveBeenCalledOnce();
    expect(sendResponse.mock.calls[0][0]).toEqual({ success: true });
    expect(input.files).toHaveLength(1);
    expect(input.files![0].name).toBe('test.txt');
    expect(changeSpy).toHaveBeenCalledOnce();
  });

  it('selects correct input when multiple exist based on proximity', () => {
    const input1 = document.createElement('input');
    input1.type = 'file';
    input1.id = 'inp1';
    input1.getBoundingClientRect = () => ({
      left: 10, top: 10, width: 20, height: 20, right: 30, bottom: 30, x: 10, y: 10
    } as DOMRect);
    document.body.appendChild(input1);

    const input2 = document.createElement('input');
    input2.type = 'file';
    input2.id = 'inp2';
    input2.getBoundingClientRect = () => ({
      left: 100, top: 100, width: 20, height: 20, right: 120, bottom: 120, x: 100, y: 100
    } as DOMRect);
    document.body.appendChild(input2);

    const input3 = document.createElement('input');
    input3.type = 'file';
    input3.id = 'inp3';
    input3.getBoundingClientRect = () => ({
      left: 200, top: 200, width: 20, height: 20, right: 220, bottom: 220, x: 200, y: 200
    } as DOMRect);
    document.body.appendChild(input3);

    const sendResponse = vi.fn();
    // Close to input2
    handleUploadFile({
      x: 105, y: 105, fileName: 'proximity.txt', mimeType: 'text/plain', base64Data: 'aGVsbG8='
    }, sendResponse);

    expect(sendResponse).toHaveBeenCalledOnce();
    expect(sendResponse.mock.calls[0][0]).toEqual({ success: true });
    expect(input2.files).toHaveLength(1);
    expect(input2.files![0].name).toBe('proximity.txt');
    expect(input1.files).toHaveLength(0);
    expect(input3.files).toHaveLength(0);
  });

  it('falls back to first hidden input if multiple exist but all are 0x0', () => {
    const input1 = document.createElement('input');
    input1.type = 'file';
    input1.id = 'inp1';
    input1.getBoundingClientRect = () => ({
      left: 10, top: 10, width: 0, height: 0, right: 10, bottom: 10, x: 10, y: 10
    } as DOMRect);
    document.body.appendChild(input1);

    const input2 = document.createElement('input');
    input2.type = 'file';
    input2.id = 'inp2';
    input2.getBoundingClientRect = () => ({
      left: 100, top: 100, width: 0, height: 0, right: 100, bottom: 100, x: 100, y: 100
    } as DOMRect);
    document.body.appendChild(input2);

    const sendResponse = vi.fn();
    handleUploadFile({
      x: 105, y: 105, fileName: 'hidden.txt', mimeType: 'text/plain', base64Data: 'aGVsbG8='
    }, sendResponse);

    expect(sendResponse).toHaveBeenCalledOnce();
    expect(input1.files).toHaveLength(1);
    expect(input1.files![0].name).toBe('hidden.txt');
    expect(input2.files).toHaveLength(0);
  });

  it('walks up parent elements to find drop zone >= 50x50 and dispatches drag events', () => {
    const dropZone = document.createElement('div');
    dropZone.id = 'dropzone';
    dropZone.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0
    } as DOMRect);

    const child = document.createElement('div');
    const input = document.createElement('input');
    input.type = 'file';
    input.getBoundingClientRect = () => ({
      left: 10, top: 10, width: 10, height: 10, right: 20, bottom: 20, x: 10, y: 10
    } as DOMRect);

    child.appendChild(input);
    dropZone.appendChild(child);
    document.body.appendChild(dropZone);

    const dragEnterSpy = vi.fn();
    dropZone.addEventListener('dragenter', dragEnterSpy);

    const sendResponse = vi.fn();
    handleUploadFile({
      x: 15, y: 15, fileName: 'test.txt', mimeType: 'text/plain', base64Data: 'aGVsbG8='
    }, sendResponse);

    expect(sendResponse).toHaveBeenCalledOnce();
    expect(dragEnterSpy).toHaveBeenCalledOnce();
  });

  it('falls back to finding closest visible element >= 50x50 as drop zone', () => {
    const unrelatedDropZone = document.createElement('div');
    unrelatedDropZone.id = 'unrelated';
    unrelatedDropZone.getBoundingClientRect = () => ({
      left: 80, top: 80, width: 60, height: 60, right: 140, bottom: 140, x: 80, y: 80
    } as DOMRect);
    document.body.appendChild(unrelatedDropZone);

    const farUnrelatedDropZone = document.createElement('div');
    farUnrelatedDropZone.id = 'far-unrelated';
    farUnrelatedDropZone.getBoundingClientRect = () => ({
      left: 300, top: 300, width: 60, height: 60, right: 360, bottom: 360, x: 300, y: 300
    } as DOMRect);
    document.body.appendChild(farUnrelatedDropZone);

    const input = document.createElement('input');
    input.type = 'file';
    input.getBoundingClientRect = () => ({
      left: 10, top: 10, width: 10, height: 10, right: 20, bottom: 20, x: 10, y: 10
    } as DOMRect);
    document.body.appendChild(input);

    const dragEnterSpy = vi.fn();
    unrelatedDropZone.addEventListener('dragenter', dragEnterSpy);

    const sendResponse = vi.fn();
    // Coords close to unrelatedDropZone
    handleUploadFile({
      x: 90, y: 90, fileName: 'test.txt', mimeType: 'text/plain', base64Data: 'aGVsbG8='
    }, sendResponse);

    expect(sendResponse).toHaveBeenCalledOnce();
    expect(dragEnterSpy).toHaveBeenCalledOnce();
  });

  it('returns error when no file input found', () => {
    const sendResponse = vi.fn();
    handleUploadFile({
      x: 10, y: 10, fileName: 'test.txt', mimeType: 'text/plain', base64Data: 'aGVsbG8='
    }, sendResponse);

    expect(sendResponse).toHaveBeenCalledOnce();
    expect(sendResponse.mock.calls[0][0]).toEqual({ success: false, error: 'No file input found on page' });
  });

  it('returns error when base64 decoding fails', () => {
    const input = document.createElement('input');
    input.type = 'file';
    document.body.appendChild(input);

    const sendResponse = vi.fn();
    handleUploadFile({
      x: 10, y: 10, fileName: 'test.txt', mimeType: 'text/plain', base64Data: 'invalid base64!!!'
    }, sendResponse);

    expect(sendResponse).toHaveBeenCalledOnce();
    const response = sendResponse.mock.calls[0][0] as any;
    expect(response.success).toBe(false);
    expect(response.error).toBeDefined();
  });

  it('falls back to direct assignment if prototype files setter is missing', () => {
    const input = document.createElement('input');
    input.type = 'file';
    document.body.appendChild(input);

    const originalDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
    if (originalDesc) {
      Object.defineProperty(HTMLInputElement.prototype, 'files', {
        value: [],
        writable: true,
        configurable: true,
      });
    }

    try {
      const sendResponse = vi.fn();
      handleUploadFile({
        x: 10, y: 10, fileName: 'test.txt', mimeType: 'text/plain', base64Data: 'aGVsbG8='
      }, sendResponse);

      expect(sendResponse).toHaveBeenCalledOnce();
      expect(sendResponse.mock.calls[0][0]).toEqual({ success: true });
    } finally {
      if (originalDesc) {
        Object.defineProperty(HTMLInputElement.prototype, 'files', originalDesc);
      }
    }
  });
});
