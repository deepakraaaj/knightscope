import { create } from 'zustand';

export type ThemePref = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';
const KEY = 'ks-theme';

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'dark';
  } catch {
    return 'dark';
  }
}

function systemTheme(): ResolvedTheme {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function resolve(pref: ThemePref): ResolvedTheme {
  return pref === 'system' ? systemTheme() : pref;
}

function apply(theme: ResolvedTheme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#F5F7FB' : '#0B1020');
}

interface ThemeState {
  pref: ThemePref;
  resolved: ResolvedTheme;
  setPref: (p: ThemePref) => void;
  toggle: () => void;
}

const initialPref = readPref();

export const useTheme = create<ThemeState>((set, get) => ({
  pref: initialPref,
  resolved: resolve(initialPref),
  setPref: (pref) => {
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      /* storage blocked: theme still applies for this session */
    }
    const resolved = resolve(pref);
    apply(resolved);
    set({ pref, resolved });
  },
  toggle: () => get().setPref(get().resolved === 'dark' ? 'light' : 'dark'),
}));

/** Apply the stored theme and follow OS changes while "system" is selected. Call once at startup. */
export function initTheme() {
  apply(useTheme.getState().resolved);
  if (typeof matchMedia !== 'function') return;
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    const { pref } = useTheme.getState();
    if (pref !== 'system') return;
    const resolved = systemTheme();
    apply(resolved);
    useTheme.setState({ resolved });
  });
}

/** Concrete colours for SVG charts (SVG attributes cannot use CSS variables). */
export function useChartColors() {
  const light = useTheme((s) => s.resolved) === 'light';
  return light
    ? { axis: '#5B6B82', grid: '#DCE3EE', tooltipBg: '#FFFFFF', tooltipBorder: '#DCE3EE', text: '#0F172A', primary: '#3F5FD9', cursor: '#EEF2F8' }
    : { axis: '#94A3B8', grid: '#29364A', tooltipBg: '#1A2538', tooltipBorder: '#29364A', text: '#F5F7FB', primary: '#7C9CFF', cursor: '#1A2538' };
}

/** Readable text colour for a status/classification colour in the current theme. */
export function tone(color: string): string {
  return `color-mix(in srgb, ${color}, #000 var(--tone-amount))`;
}
