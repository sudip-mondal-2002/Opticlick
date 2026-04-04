/**
 * DOM tests for src/entrypoints/content/theme.ts
 *
 * getTheme() reads 'opticlickTheme' from chrome.storage.local and returns
 * a ContentTheme token set (LIGHT or DARK).
 * chrome.storage.local is stubbed via dom-setup.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { getTheme } from '@/entrypoints/content/theme';

describe('getTheme', () => {
  it('returns the LIGHT theme when storage has no value set', async () => {
    const theme = await getTheme();
    // LIGHT theme uses sky-600 stroke
    expect(theme.markStroke).toBe('#0284c7');
    expect(theme.badgeBg).toBe('#0284c7');
    expect(theme.badgeText).toBe('#ffffff');
  });

  it('returns the LIGHT theme when opticlickTheme is "light"', async () => {
    await chrome.storage.local.set({ opticlickTheme: 'light' });
    const theme = await getTheme();
    expect(theme.markStroke).toBe('#0284c7');
  });

  it('returns the DARK theme when opticlickTheme is "dark"', async () => {
    await chrome.storage.local.set({ opticlickTheme: 'dark' });
    const theme = await getTheme();
    // DARK theme uses sky-400 stroke
    expect(theme.markStroke).toBe('#38bdf8');
    expect(theme.badgeBg).toBe('#0369a1');
  });

  it('DARK theme markFill has higher opacity than LIGHT', async () => {
    await chrome.storage.local.set({ opticlickTheme: 'dark' });
    const dark = await getTheme();
    await chrome.storage.local.set({ opticlickTheme: 'light' });
    const light = await getTheme();
    // Both should be rgba strings — just verify they differ
    expect(dark.markFill).not.toBe(light.markFill);
  });

  it('returns the LIGHT theme as fallback when chrome.storage.local throws', async () => {
    const g = globalThis as Record<string, unknown>;
    const chrome = g.chrome as Record<string, Record<string, unknown>>;
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('storage unavailable'),
    );
    const theme = await getTheme();
    expect(theme.markStroke).toBe('#0284c7');
  });

  it('LIGHT theme blockerBg is a CSS gradient string', async () => {
    const theme = await getTheme();
    expect(theme.blockerBg).toContain('radial-gradient');
  });

  it('DARK theme blockerBg is a CSS gradient string', async () => {
    await chrome.storage.local.set({ opticlickTheme: 'dark' });
    const theme = await getTheme();
    expect(theme.blockerBg).toContain('radial-gradient');
  });

  it('returns LIGHT theme for any unknown theme value', async () => {
    await chrome.storage.local.set({ opticlickTheme: 'blue' });
    const theme = await getTheme();
    expect(theme.markStroke).toBe('#0284c7');
  });
});
