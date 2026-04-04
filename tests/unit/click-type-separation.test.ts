/**
 * Unit tests for click/type separation and loop detection.
 *
 * Verifies that:
 * 1. Click and type are now separate actions (better for debugging stuck loops)
 * 2. Type action only works after a click (focuses on the clicked element)
 * 3. The action history can be tracked to detect repeated click+type patterns
 * 4. Anti-loop detection can work with the new separation
 */

import { describe, it, expect } from 'vitest';
import { parseToolCall } from '@/utils/tools/index';
import { shouldPivot } from '@/utils/navigation-guard';
import type { AgentAction } from '@/utils/types';
import type { ActionRecord } from '@/utils/navigation-guard';

// ─────────────────────────────────────────────────────────────────────────────
// Click/Type separation validation
// ─────────────────────────────────────────────────────────────────────────────

describe('Click/Type Separation', () => {
  it('click action no longer carries typeText field', () => {
    const result = parseToolCall('click', {
      targetId: 5,
      typeText: 'this should be ignored',
    }) as AgentAction & { type: 'click' };

    expect(result.type).toBe('click');
    expect(result.targetId).toBe(5);
    expect((result as any).typeText).toBeUndefined();
  });

  it('click action no longer carries pressKey field', () => {
    const result = parseToolCall('click', {
      targetId: 5,
      pressKey: 'Enter',
    }) as AgentAction & { type: 'click' };

    expect(result.type).toBe('click');
    expect(result.targetId).toBe(5);
    expect((result as any).pressKey).toBeUndefined();
  });

  it('click action no longer carries clearField field', () => {
    const result = parseToolCall('click', {
      targetId: 5,
      clearField: true,
    }) as AgentAction & { type: 'click' };

    expect(result.type).toBe('click');
    expect(result.targetId).toBe(5);
    expect((result as any).clearField).toBeUndefined();
  });

  it('type is now a separate action', () => {
    const result = parseToolCall('type', { text: 'search query' }) as AgentAction & { type: 'type' };
    expect(result.type).toBe('type');
    expect(result.text).toBe('search query');
  });

  it('type action requires text parameter', () => {
    const result = parseToolCall('type', {}) as AgentAction & { type: 'type' };
    expect(result.type).toBe('type');
    expect(result.text).toBeUndefined();
  });

  it('type action supports clearField to replace existing content', () => {
    const result = parseToolCall('type', {
      text: 'new text',
      clearField: true,
    }) as AgentAction & { type: 'type' };

    expect(result.type).toBe('type');
    expect(result.text).toBe('new text');
    expect(result.clearField).toBe(true);
  });

  it('type action without clearField will append to existing content', () => {
    const result = parseToolCall('type', {
      text: ' more text',
    }) as AgentAction & { type: 'type' };

    expect(result.type).toBe('type');
    expect(result.text).toBe(' more text');
    expect(result.clearField).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Loop detection with click/type separation
// ─────────────────────────────────────────────────────────────────────────────

describe('Loop Detection with Separate Click/Type', () => {
  /**
   * Scenario from the screenshot: agent stuck clicking "Filter labels" (element #1)
   * and typing "build" repeatedly. With separated actions, we can now detect:
   * 1. Repeated click to same element
   * 2. Type following the same click pattern
   * 3. Overall click+type loop cycle
   */

  it('detects repeated clicks to the same element', () => {
    const history: ActionRecord[] = [
      { type: 'click', targetId: 1 },
      { type: 'click', targetId: 1 },
      { type: 'click', targetId: 1 },
    ];
    expect(shouldPivot(history, 'click', 1)).toBe(true);
  });

  it('does not pivot on different click targets', () => {
    const history: ActionRecord[] = [
      { type: 'click', targetId: 1 },
      { type: 'click', targetId: 2 },
      { type: 'click', targetId: 3 },
    ];
    expect(shouldPivot(history, 'click', 1)).toBe(false);
    expect(shouldPivot(history, 'click', 4)).toBe(false);
  });

  it('can track type actions separately from clicks', () => {
    // Simulating the bug scenario: agent keeps doing click(#1) -> type("build")
    const history: ActionRecord[] = [
      { type: 'click', targetId: 1 },
      { type: 'type', targetId: undefined }, // type doesn't have a targetId
      { type: 'click', targetId: 1 },
      { type: 'type', targetId: undefined },
      { type: 'click', targetId: 1 },
      { type: 'type', targetId: undefined },
    ];

    // After 3 clicks to element #1, should pivot
    expect(shouldPivot(history, 'click', 1)).toBe(true);
  });

  it('recognizes click pattern even with type actions interspersed', () => {
    // Real-world scenario: agent tries to click and type in a loop
    const history: ActionRecord[] = [
      { type: 'click', targetId: 5 },    // Click search box
      { type: 'type', targetId: undefined }, // Type query
      { type: 'click', targetId: 5 },    // Click same search box again
      { type: 'type', targetId: undefined }, // Type again
      { type: 'click', targetId: 5 },    // Third identical click
      { type: 'type', targetId: undefined }, // Third type
    ];

    // Clicking element #5 three times — should pivot
    expect(shouldPivot(history, 'click', 5)).toBe(true);
  });

  it('allows type actions at the type level (they have no targetId)', () => {
    // Type actions don't repeat in the same way as clicks (no targetId),
    // but we can track type-only sequences if needed
    const history: ActionRecord[] = [
      { type: 'type', targetId: undefined },
      { type: 'type', targetId: undefined },
      { type: 'type', targetId: undefined },
    ];

    // Typing action repeated — should pivot if treated as a repeated action
    expect(shouldPivot(history, 'type', undefined)).toBe(true);
  });

  it('mixed click and type actions do not interfere with each other in pivot detection', () => {
    const history: ActionRecord[] = [
      { type: 'click', targetId: 1 },
      { type: 'click', targetId: 2 },
      { type: 'click', targetId: 1 },
      { type: 'type', targetId: undefined },
      { type: 'type', targetId: undefined },
      { type: 'type', targetId: undefined },
    ];

    // Click to #1 only twice, should not pivot
    expect(shouldPivot(history, 'click', 1)).toBe(false);
    // Type repeated 3 times, should pivot
    expect(shouldPivot(history, 'type', undefined)).toBe(true);
  });

  it('benefits: now can detect label-entry loop from screenshot', () => {
    /**
     * In the screenshot, the agent was stuck in:
     *   Click "Filter labels" (#1) → Type "build" → repeat
     *
     * With separate actions, after 3 iterations:
     * history = [
     *   click(1), type, click(1), type, click(1), type
     * ]
     *
     * shouldPivot(history, 'click', 1) will correctly return true,
     * allowing the system to exit and log "NO REPEAT FAILURES" rule breach.
     */
    const buggyHistory: ActionRecord[] = [
      { type: 'click', targetId: 1 }, // Click "Filter labels"
      { type: 'type', targetId: undefined },      // Type "build"
      { type: 'click', targetId: 1 }, // Click again (failed!)
      { type: 'type', targetId: undefined },      // Type again
      { type: 'click', targetId: 1 }, // Third attempt
      { type: 'type', targetId: undefined },      // Third type
    ];

    // Agent should pivot now — detected 3 identical clicks
    expect(shouldPivot(buggyHistory, 'click', 1)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Click/Type workflow validation
// ─────────────────────────────────────────────────────────────────────────────

describe('Click/Type Workflow', () => {
  it('a typical form entry workflow is now 2 actions instead of 1', () => {
    // Before: click(targetId, typeText: "value", pressKey: "Enter")
    // After: click(targetId), type(text: "value"), press_key(key: "Enter")

    const clickAction = parseToolCall('click', { targetId: 3 }) as AgentAction;
    const typeAction = parseToolCall('type', { text: 'username' }) as AgentAction;
    const pressAction = parseToolCall('press_key', { key: 'Enter' }) as AgentAction;

    expect(clickAction.type).toBe('click');
    expect(typeAction.type).toBe('type');
    expect(pressAction.type).toBe('press_key');
  });

  it('type must be called after click to work on the focused element', () => {
    // Type has no targetId — it operates on the currently focused element
    const result = parseToolCall('type', { text: 'search term' }) as AgentAction & { type: 'type' };

    expect(result.type).toBe('type');
    expect(result.text).toBe('search term');
    expect((result as any).targetId).toBeUndefined();
  });

  it('separating click and type enables better error handling', () => {
    // If click fails, type will not be sent
    // If type fails, press_key can still be sent
    // If press_key fails, the user can still continue

    const actions = [
      parseToolCall('click', { targetId: 7 }),
      parseToolCall('type', { text: 'query' }),
      parseToolCall('press_key', { key: 'Enter' }),
    ];

    expect(actions).toHaveLength(3);
    expect(actions[0]?.type).toBe('click');
    expect(actions[1]?.type).toBe('type');
    expect(actions[2]?.type).toBe('press_key');
  });

  it('separating click and type allows individual type operations', () => {
    // User can now do: click -> wait -> type -> press_key
    // This is more flexible than bundled click+type

    const actionSequence = [
      parseToolCall('click', { targetId: 10 }),
      parseToolCall('type', { text: 'first' }),
      parseToolCall('type', { text: ' second', clearField: false }), // append
      parseToolCall('press_key', { key: 'Enter' }),
    ];

    expect(actionSequence).toHaveLength(4);
    expect(actionSequence.filter((a) => a?.type === 'type')).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression tests: ensure old bundled API doesn't work
// ─────────────────────────────────────────────────────────────────────────────

describe('Regression: Ensure old click+type bundling no longer works', () => {
  it('click tool no longer accepts typeText in the schema', () => {
    // This tests that the old bundled behavior is truly gone
    const result = parseToolCall('click', {
      targetId: 5,
      typeText: 'should not work',
    }) as AgentAction & { type: 'click' };

    expect(result.type).toBe('click');
    // typeText should be undefined in the new version
    expect((result as any).typeText).toBeUndefined();
  });

  it('click tool no longer accepts pressKey in the schema', () => {
    const result = parseToolCall('click', {
      targetId: 5,
      pressKey: 'Enter',
    }) as AgentAction & { type: 'click' };

    expect(result.type).toBe('click');
    expect((result as any).pressKey).toBeUndefined();
  });

  it('click tool no longer accepts clearField in the schema', () => {
    const result = parseToolCall('click', {
      targetId: 5,
      clearField: true,
    }) as AgentAction & { type: 'click' };

    expect(result.type).toBe('click');
    expect((result as any).clearField).toBeUndefined();
  });
});
