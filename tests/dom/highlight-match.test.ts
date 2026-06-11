import { describe, it, expect } from 'vitest';
import { HighlightedText } from '@/utils/highlight-match';
import { renderToString } from 'react-dom/server';
import React from 'react';

describe('HighlightedText component', () => {
  it('renders plain text wrapper when query is empty', () => {
    const html = renderToString(
      React.createElement(HighlightedText, { text: 'Hello World', query: '' })
    );
    expect(html).toContain('<span>Hello World</span>');
    expect(html).not.toContain('<mark');
  });

  it('renders matching text wrapped in mark and non-matching in span', () => {
    const html = renderToString(
      React.createElement(HighlightedText, { text: 'Hello World', query: 'World' })
    );
    expect(html).toContain('<span>Hello </span>');
    // Class name default contains bg-amber-100
    expect(html).toContain('<mark class="bg-amber-100');
    expect(html).toContain('World</mark>');
  });

  it('supports custom markClassName and className', () => {
    const html = renderToString(
      React.createElement(HighlightedText, {
        text: 'test',
        query: 'test',
        className: 'my-span',
        markClassName: 'my-mark'
      })
    );
    expect(html).toContain('<span class="my-span">');
    expect(html).toContain('<mark class="my-mark">test</mark>');
  });
});
