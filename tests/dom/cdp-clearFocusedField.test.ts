/**
 * DOM-level tests for clearFocusedField().
 *
 * These tests run in jsdom and call the real function — not a mock. This is
 * what makes the tests airtight: the clearing logic is actually exercised
 * against a live DOM, so a broken expression will break these tests too.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearFocusedField } from '@/utils/cdp';

// jsdom does not implement document.execCommand; define a stub so vi.spyOn works.
if (!('execCommand' in document)) {
  Object.defineProperty(document, 'execCommand', {
    value: () => false,
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

// ── <input> ──────────────────────────────────────────────────────────────────

describe('clearFocusedField — <input>', () => {
  it('clears existing value', () => {
    const input = document.createElement('input');
    input.value = 'existing text';
    document.body.appendChild(input);
    input.focus();

    clearFocusedField();

    expect(input.value).toBe('');
  });

  it('fires an input event so frameworks see the change', () => {
    const input = document.createElement('input');
    input.value = 'hello';
    document.body.appendChild(input);
    input.focus();

    const handler = vi.fn();
    input.addEventListener('input', handler);
    clearFocusedField();

    expect(handler).toHaveBeenCalledOnce();
  });

  it('input event bubbles', () => {
    const input = document.createElement('input');
    input.value = 'hello';
    document.body.appendChild(input);
    input.focus();

    const handler = vi.fn();
    document.body.addEventListener('input', handler);
    clearFocusedField();

    expect(handler).toHaveBeenCalledOnce();
  });

  it('does nothing when input is already empty', () => {
    const input = document.createElement('input');
    input.value = '';
    document.body.appendChild(input);
    input.focus();

    clearFocusedField();

    expect(input.value).toBe('');
  });
});

// ── <textarea> ───────────────────────────────────────────────────────────────

describe('clearFocusedField — <textarea>', () => {
  it('clears existing value', () => {
    const ta = document.createElement('textarea');
    ta.value = 'multiline\ncontent';
    document.body.appendChild(ta);
    ta.focus();

    clearFocusedField();

    expect(ta.value).toBe('');
  });

  it('fires an input event', () => {
    const ta = document.createElement('textarea');
    ta.value = 'text';
    document.body.appendChild(ta);
    ta.focus();

    const handler = vi.fn();
    ta.addEventListener('input', handler);
    clearFocusedField();

    expect(handler).toHaveBeenCalledOnce();
  });
});

// ── contenteditable ───────────────────────────────────────────────────────────

describe('clearFocusedField — contenteditable', () => {
  it('calls document.execCommand("selectAll") so Input.insertText replaces content', () => {
    const div = document.createElement('div');
    div.contentEditable = 'true';
    div.tabIndex = 0;
    div.textContent = 'existing content';
    document.body.appendChild(div);
    div.focus();

    // jsdom doesn't implement execCommand but we can verify it's called
    const execSpy = vi.spyOn(document, 'execCommand').mockReturnValue(true);
    clearFocusedField();

    expect(execSpy).toHaveBeenCalledWith('selectAll', false, undefined);
  });

  it('does NOT directly mutate innerHTML/textContent', () => {
    const div = document.createElement('div');
    div.contentEditable = 'true';
    div.tabIndex = 0;
    div.textContent = 'keep me';
    document.body.appendChild(div);
    div.focus();

    vi.spyOn(document, 'execCommand').mockReturnValue(true);
    clearFocusedField();

    // textContent should be untouched — clearing via execCommand + insertText is
    // handled by CDP; direct mutation would break framework-managed rich editors
    expect(div.textContent).toBe('keep me');
  });
});

// ── no active element ─────────────────────────────────────────────────────────

describe('clearFocusedField — no focused element', () => {
  it('does not throw when no element is focused', () => {
    // blur everything
    (document.activeElement as HTMLElement | null)?.blur?.();
    expect(() => clearFocusedField()).not.toThrow();
  });

  it('does not call execCommand when no element is focused', () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    const execSpy = vi.spyOn(document, 'execCommand').mockReturnValue(true);
    clearFocusedField();
    expect(execSpy).not.toHaveBeenCalled();
  });
});

// ── non-editable element ──────────────────────────────────────────────────────

describe('clearFocusedField — non-editable element', () => {
  it('does nothing when focused element is a plain div', () => {
    const div = document.createElement('div');
    div.tabIndex = 0;
    document.body.appendChild(div);
    div.focus();

    const execSpy = vi.spyOn(document, 'execCommand').mockReturnValue(true);
    expect(() => clearFocusedField()).not.toThrow();
    expect(execSpy).not.toHaveBeenCalled();
  });
});
