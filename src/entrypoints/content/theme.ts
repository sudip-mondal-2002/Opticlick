/**
 * Content-script theme tokens — mirrors the popup's sky-600 palette.
 * Reads the user's dark/light preference from chrome.storage.local,
 * where the popup's ThemeProvider writes it (key: "opticlickTheme").
 */

export interface ContentTheme {
  markStroke: string;
  markFill: string;
  badgeBg: string;
  badgeText: string;
  blockerBg: string;
  blockerBorder: string;
  bannerBg: string;
}

const LIGHT: ContentTheme = {
  markStroke:    '#0284c7',               // sky-600
  markFill:      'rgba(2, 132, 199, 0.07)',
  badgeBg:       '#0284c7',               // sky-600
  badgeText:     '#ffffff',
  blockerBg:     'radial-gradient(ellipse at center, rgba(14, 165, 233, 0) 60%, rgba(14, 165, 233, 0.9) 120%)',
  bannerBg:      'rgba(2, 132, 199, 0)',
};

const DARK: ContentTheme = {
  markStroke:    '#38bdf8',               // sky-400
  markFill:      'rgba(56, 189, 248, 0.08)',
  badgeBg:       '#0369a1',               // sky-700
  badgeText:     '#ffffff',
  blockerBg:     'radial-gradient(ellipse at center, rgba(2, 132, 199, 0.20) 60%, rgba(2, 132, 199, 0.9) 120%)',
  bannerBg:      'rgba(3, 105, 161, 0)',
};

export async function getTheme(): Promise<ContentTheme> {
  try {
    const result = await chrome.storage.local.get('opticlickTheme');
    return result['opticlickTheme'] === 'dark' ? DARK : LIGHT;
  } catch {
    return LIGHT;
  }
}
