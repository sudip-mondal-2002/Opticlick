/**
 * Unit tests for src/utils/tools/tabs.ts
 *
 * Tests the LangChain tool objects: names, descriptions, schemas, and invocation.
 */

import { describe, it, expect } from 'vitest';
import {
  openTabTool,
  switchTabTool,
  closeTabTool,
  listTabsTool,
  TAB_TOOLS,
} from '@/utils/tools/tabs';

describe('openTabTool', () => {
  it('has name "open_tab"', () => {
    expect(openTabTool.name).toBe('open_tab');
  });

  it('has a non-empty description', () => {
    expect(openTabTool.description.length).toBeGreaterThan(0);
  });

  it('returns "ok" when invoked with a valid URL', async () => {
    const result = await openTabTool.invoke({
      url: 'https://github.com',
    });

    expect(result).toBe('ok');
  });
});

describe('switchTabTool', () => {
  it('has name "switch_tab"', () => {
    expect(switchTabTool.name).toBe('switch_tab');
  });

  it('has a non-empty description', () => {
    expect(switchTabTool.description.length).toBeGreaterThan(0);
  });

  it('returns "ok" when invoked with a valid tab index', async () => {
    const result = await switchTabTool.invoke({
      tabIndex: 0,
    });

    expect(result).toBe('ok');
  });
});

describe('closeTabTool', () => {
  it('has name "close_tab"', () => {
    expect(closeTabTool.name).toBe('close_tab');
  });

  it('has a non-empty description', () => {
    expect(closeTabTool.description.length).toBeGreaterThan(0);
  });

  it('returns "ok" when invoked', async () => {
    const result = await closeTabTool.invoke({});

    expect(result).toBe('ok');
  });
});

describe('listTabsTool', () => {
  it('has name "list_tabs"', () => {
    expect(listTabsTool.name).toBe('list_tabs');
  });

  it('has a non-empty description', () => {
    expect(listTabsTool.description.length).toBeGreaterThan(0);
  });

  it('returns "ok" when invoked', async () => {
    const result = await listTabsTool.invoke({});

    expect(result).toBe('ok');
  });
});

describe('TAB_TOOLS', () => {
  it('contains exactly four tools', () => {
    expect(TAB_TOOLS).toHaveLength(4);
  });

  it('includes all tab tools', () => {
    const names = TAB_TOOLS.map((t) => t.name);

    expect(names).toContain('open_tab');
    expect(names).toContain('switch_tab');
    expect(names).toContain('close_tab');
    expect(names).toContain('list_tabs');
  });

  it('has unique tool names', () => {
    const names = TAB_TOOLS.map((t) => t.name);

    expect(new Set(names).size).toBe(4);
  });

  it('every tool has a non-empty description', () => {
    for (const t of TAB_TOOLS) {
      expect(
        t.description.length,
        `${t.name} should have a description`,
      ).toBeGreaterThan(0);
    }
  });
});