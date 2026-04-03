/**
 * Tests for interactables.ts — runs in jsdom environment.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { isInteractable, collectInteractables, getLabel } from '@/entrypoints/content/interactables';

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  extra?: (el: HTMLElementTagNameMap[K]) => void,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  extra?.(el);
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

// ── isInteractable ────────────────────────────────────────────────────────────

describe('isInteractable — interactive tags', () => {
  it.each(['button', 'a', 'select', 'textarea', 'label', 'summary', 'details', 'video', 'audio'] as const)(
    'returns true for <%s>',
    (tag) => {
      const el = make(tag as keyof HTMLElementTagNameMap);
      expect(isInteractable(el)).toBe(true);
    },
  );

  it('returns true for <input type="text">', () => {
    const el = make('input', { type: 'text' });
    expect(isInteractable(el)).toBe(true);
  });

  it('returns true for <input type="file">', () => {
    const el = make('input', { type: 'file' });
    expect(isInteractable(el)).toBe(true);
  });

  it('returns false for disabled input', () => {
    const el = make('input', { type: 'text' });
    (el as HTMLInputElement).disabled = true;
    expect(isInteractable(el)).toBe(false);
  });

  it('returns false for hidden input (type="hidden")', () => {
    const el = make('input', { type: 'hidden' });
    expect(isInteractable(el)).toBe(false);
  });
});

describe('isInteractable — ARIA roles', () => {
  it.each([
    'button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'option', 'radio', 'checkbox', 'tab', 'slider', 'switch',
    'textbox', 'searchbox', 'combobox', 'listbox',
  ])('returns true for div[role="%s"]', (role) => {
    const el = make('div', { role });
    expect(isInteractable(el)).toBe(true);
  });

  it('returns false for plain div without role', () => {
    const el = make('div');
    expect(isInteractable(el)).toBe(false);
  });
});

describe('isInteractable — tabindex', () => {
  it('returns true for tabindex="0"', () => {
    const el = make('span', { tabindex: '0' });
    expect(isInteractable(el)).toBe(true);
  });

  it('returns true for tabindex="1"', () => {
    const el = make('span', { tabindex: '1' });
    expect(isInteractable(el)).toBe(true);
  });

  it('returns false for tabindex="-1"', () => {
    const el = make('span', { tabindex: '-1' });
    expect(isInteractable(el)).toBe(false);
  });
});

describe('isInteractable — click handlers', () => {
  it('returns true for element with onclick attribute', () => {
    const el = make('div', { onclick: 'doStuff()' });
    expect(isInteractable(el)).toBe(true);
  });

  it('returns true for element with ng-click attribute', () => {
    const el = make('div', { 'ng-click': 'doStuff()' });
    expect(isInteractable(el)).toBe(true);
  });

  it('returns true for element with v-on:click attribute', () => {
    const el = make('div', { 'v-on:click': 'handler' });
    expect(isInteractable(el)).toBe(true);
  });

  it('returns true for element with @click via hasAttribute check', () => {
    // jsdom rejects @click as an attribute name (not valid XML).
    // Test by mocking hasAttribute to simulate the Vue @click shorthand pattern.
    const el = document.createElement('div');
    document.body.appendChild(el);
    const original = el.hasAttribute.bind(el);
    el.hasAttribute = (name: string) => name === '@click' ? true : original(name);
    expect(isInteractable(el)).toBe(true);
  });
});

// ── collectInteractables ──────────────────────────────────────────────────────

describe('collectInteractables', () => {
  it('finds all interactive elements in a flat DOM', () => {
    make('button', {}, (el) => (el.textContent = 'Click'));
    make('a', { href: '#' }, (el) => (el.textContent = 'Link'));
    make('input', { type: 'text' });
    make('div'); // not interactive
    const results = collectInteractables(document.body);
    expect(results).toHaveLength(3);
  });

  it('does not include disabled inputs', () => {
    make('input', { type: 'text' }); // interactive
    const disabled = make('input', { type: 'text' });
    (disabled as HTMLInputElement).disabled = true;
    const results = collectInteractables(document.body);
    expect(results).toHaveLength(1);
  });

  it('finds elements inside Shadow DOM (open shadow root)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const btn = document.createElement('button');
    btn.textContent = 'Shadow button';
    shadow.appendChild(btn);
    const results = collectInteractables(document.body);
    expect(results).toContain(btn);
  });

  it('does not produce duplicate elements', () => {
    make('button', {}, (el) => (el.textContent = 'Btn'));
    const results = collectInteractables(document.body);
    const ids = results.map((el) => el);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('does NOT traverse a closed shadow root (shadowRoot property is null)', () => {
    const host = document.createElement('div');
    // attachShadow({mode:'closed'}) returns the root but sets host.shadowRoot = null
    const shadow = host.attachShadow({ mode: 'closed' });
    const hiddenBtn = document.createElement('button');
    hiddenBtn.textContent = 'Hidden';
    shadow.appendChild(hiddenBtn);
    document.body.appendChild(host);
    // production code: if ((el as HTMLElement).shadowRoot) → null → skipped
    const results = collectInteractables(document.body);
    expect(results).not.toContain(hiddenBtn);
  });

  it('recurses into nested shadow roots', () => {
    const host1 = document.createElement('div');
    document.body.appendChild(host1);
    const shadow1 = host1.attachShadow({ mode: 'open' });

    const host2 = document.createElement('div');
    shadow1.appendChild(host2);
    const shadow2 = host2.attachShadow({ mode: 'open' });

    const innerBtn = document.createElement('button');
    innerBtn.textContent = 'Deep';
    shadow2.appendChild(innerBtn);

    const results = collectInteractables(document.body);
    expect(results).toContain(innerBtn);
  });
});

// ── getLabel ─────────────────────────────────────────────────────────────────

describe('getLabel', () => {
  it('returns aria-label (trimmed, max 40 chars)', () => {
    const el = make('button', { 'aria-label': '  Submit Form  ' });
    expect(getLabel(el)).toBe('Submit Form');
  });

  it('truncates aria-label to 40 characters', () => {
    const el = make('button', { 'aria-label': 'a'.repeat(50) });
    expect(getLabel(el)).toHaveLength(40);
  });

  it('uses aria-labelledby to look up referenced element text', () => {
    const label = document.createElement('span');
    label.id = 'my-label';
    label.textContent = 'Email address';
    document.body.appendChild(label);
    const el = make('input', { 'aria-labelledby': 'my-label' });
    expect(getLabel(el)).toBe('Email address');
  });

  it('uses input placeholder as fallback', () => {
    const el = make('input', { placeholder: 'Enter your name' });
    expect(getLabel(el)).toBe('Enter your name');
  });

  it('uses input name attribute as fallback', () => {
    const el = make('input', { name: 'email' });
    expect(getLabel(el)).toBe('email');
  });

  it('uses input type as fallback', () => {
    const el = make('input', { type: 'submit' });
    expect(getLabel(el)).toBe('submit');
  });

  it('returns the type attribute for input with no placeholder or name', () => {
    const el = document.createElement('input');
    // jsdom defaults type to 'text', so getLabel returns 'text'
    expect(getLabel(el)).toBe('text');
  });

  it('returns trimmed textContent for non-input elements', () => {
    const el = make('button', {}, (el) => (el.textContent = '  Click me  '));
    expect(getLabel(el)).toBe('Click me');
  });

  it('returns tag name when non-input has no text', () => {
    const el = make('button');
    expect(getLabel(el)).toBe('button');
  });

  it('returns tag name when element has only whitespace text', () => {
    const el = make('button', {}, (el) => (el.textContent = '   \n\t  '));
    expect(getLabel(el)).toBe('button');
  });

  it('truncates textContent to 40 characters', () => {
    const el = make('button', {}, (el) => (el.textContent = 'a'.repeat(60)));
    expect(getLabel(el)).toHaveLength(40);
  });

  it('collapses whitespace in textContent', () => {
    const el = make('button', {}, (el) => (el.textContent = 'hello   world'));
    expect(getLabel(el)).toBe('hello world');
  });
});
