import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleGetElementDom } from '@/entrypoints/content/handlers/get-element-dom';

describe('handleGetElementDom', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns closest element near coordinates', () => {
    const el1 = document.createElement('button');
    el1.id = 'btn1';
    el1.textContent = 'Button 1';
    el1.getBoundingClientRect = () => ({
      left: 10, top: 10, width: 20, height: 20, right: 30, bottom: 30, x: 10, y: 10
    } as DOMRect);
    document.body.appendChild(el1);

    const el2 = document.createElement('div');
    el2.id = 'btn2';
    el2.textContent = 'Button 2';
    el2.getBoundingClientRect = () => ({
      left: 100, top: 100, width: 50, height: 50, right: 150, bottom: 150, x: 100, y: 100
    } as DOMRect);
    document.body.appendChild(el2);

    const sendResponse = vi.fn();
    // Close to el1 (15, 15)
    handleGetElementDom({ x: 15, y: 15 }, sendResponse);

    expect(sendResponse).toHaveBeenCalledOnce();
    const response = sendResponse.mock.calls[0][0] as any;
    expect(response.success).toBe(true);
    expect(response.tag).toBe('button');
    expect(response.outerHTML).toContain('Button 1');
    expect(response.truncated).toBe(false);
  });

  it('skips elements with 0 width and height', () => {
    const hiddenEl = document.createElement('button');
    hiddenEl.id = 'hidden';
    hiddenEl.getBoundingClientRect = () => ({
      left: 10, top: 10, width: 0, height: 0, right: 10, bottom: 10, x: 10, y: 10
    } as DOMRect);
    document.body.appendChild(hiddenEl);

    const visibleEl = document.createElement('button');
    visibleEl.id = 'visible';
    visibleEl.getBoundingClientRect = () => ({
      left: 100, top: 100, width: 10, height: 10, right: 110, bottom: 110, x: 100, y: 100
    } as DOMRect);
    document.body.appendChild(visibleEl);

    const sendResponse = vi.fn();
    handleGetElementDom({ x: 12, y: 12 }, sendResponse);

    expect(sendResponse).toHaveBeenCalledOnce();
    const response = sendResponse.mock.calls[0][0] as any;
    expect(response.success).toBe(true);
    expect(response.tag).toBe('button');
    expect(response.outerHTML).toContain('id="visible"');
  });

  it('returns error when no candidates found', () => {
    const sendResponse = vi.fn();
    handleGetElementDom({ x: 10, y: 10 }, sendResponse);

    expect(sendResponse).toHaveBeenCalledOnce();
    const response = sendResponse.mock.calls[0][0] as any;
    expect(response.success).toBe(false);
    expect(response.error).toBe('No element found near coordinates');
  });

  it('truncates outerHTML when it exceeds MAX_CHARS', () => {
    const el = document.createElement('div');
    const longContent = 'A'.repeat(45000);
    el.textContent = longContent;
    el.getBoundingClientRect = () => ({
      left: 10, top: 10, width: 10, height: 10, right: 20, bottom: 20, x: 10, y: 10
    } as DOMRect);
    document.body.appendChild(el);

    const sendResponse = vi.fn();
    handleGetElementDom({ x: 10, y: 10 }, sendResponse);

    expect(sendResponse).toHaveBeenCalledOnce();
    const response = sendResponse.mock.calls[0][0] as any;
    expect(response.success).toBe(true);
    expect(response.truncated).toBe(true);
    expect(response.outerHTML.length).toBeLessThan(45000);
    expect(response.outerHTML).toContain('<!-- [truncated] -->');
  });
});
