import { describe, it, expect } from 'vitest';
import { getKeyCode, CDP_MODIFIER } from '@/utils/cdp';

describe('getKeyCode', () => {
  it.each([
    ['Enter', 13],
    ['Tab', 9],
    ['Escape', 27],
    ['Backspace', 8],
    ['Delete', 46],
    ['ArrowUp', 38],
    ['ArrowDown', 40],
    ['ArrowLeft', 37],
    ['ArrowRight', 39],
    ['Space', 32],
    ['Home', 36],
    ['End', 35],
    ['PageUp', 33],
    ['PageDown', 34],
  ])('returns %i for "%s"', (key, expected) => {
    expect(getKeyCode(key)).toBe(expected);
  });

  it('falls back to charCodeAt(0) for unknown key "A"', () => {
    expect(getKeyCode('A')).toBe(65);
  });

  it('falls back to charCodeAt(0) for unknown key "z"', () => {
    expect(getKeyCode('z')).toBe(122);
  });

  it('falls back to charCodeAt(0) for single-char "!"', () => {
    expect(getKeyCode('!')).toBe(33);
  });
});

describe('CDP_MODIFIER', () => {
  it('alt is 1', () => expect(CDP_MODIFIER.alt).toBe(1));
  it('ctrl is 2', () => expect(CDP_MODIFIER.ctrl).toBe(2));
  it('meta is 4', () => expect(CDP_MODIFIER.meta).toBe(4));
  it('shift is 8', () => expect(CDP_MODIFIER.shift).toBe(8));

  it('OR-ing ctrl + shift yields 10', () => {
    expect(CDP_MODIFIER.ctrl | CDP_MODIFIER.shift).toBe(10);
  });

  it('OR-ing all four yields 15', () => {
    expect(
      CDP_MODIFIER.alt | CDP_MODIFIER.ctrl | CDP_MODIFIER.meta | CDP_MODIFIER.shift,
    ).toBe(15);
  });
});
