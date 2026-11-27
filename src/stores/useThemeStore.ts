import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'nocta_theme_mode';
const NATIVE_GLASS_STORAGE_KEY = 'nocta_native_glass';

export function resolveThemeMode(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  }
  return mode;
}

export function applyThemeToDom(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(resolved);
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

function readInitialMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') {
      return raw;
    }
  } catch {
    // ignore storage errors
  }
  return 'light';
}

function readInitialNativeGlass(): boolean {
  try {
    const raw = localStorage.getItem(NATIVE_GLASS_STORAGE_KEY);
    if (raw === '0') return false;
  } catch {
    // ignore storage errors
  }
  return true;
}

const initialMode = readInitialMode();
const initialResolved = resolveThemeMode(initialMode);
applyThemeToDom(initialResolved);

interface ThemeState {
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  nativeGlass: boolean;
  setMode: (mode: ThemeMode) => void;
  toggleLightDark: () => void;
  setNativeGlass: (enabled: boolean) => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: initialMode,
  resolvedTheme: initialResolved,
  nativeGlass: readInitialNativeGlass(),

  setMode: (mode) => {
    const resolved = resolveThemeMode(mode);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // ignore storage errors
    }
    applyThemeToDom(resolved);
    set({ mode, resolvedTheme: resolved });
  },

  toggleLightDark: () => {
    const next: ThemeMode = get().resolvedTheme === 'light' ? 'dark' : 'light';
    get().setMode(next);
  },

  setNativeGlass: (enabled) => {
    try {
      localStorage.setItem(NATIVE_GLASS_STORAGE_KEY, enabled ? '1' : '0');
    } catch {
      // ignore storage errors
    }
    set({ nativeGlass: enabled });
  },
}));

if (typeof window !== 'undefined' && window.matchMedia) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onSystemThemeChange = () => {
    const { mode } = useThemeStore.getState();
    if (mode !== 'system') return;
    const resolved = resolveThemeMode('system');
    applyThemeToDom(resolved);
    useThemeStore.setState({ resolvedTheme: resolved });
  };
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', onSystemThemeChange);
  }

  window.addEventListener('storage', (e) => {
    if (e.key !== THEME_STORAGE_KEY) return;
    const raw = e.newValue;
    const nextMode: ThemeMode =
      raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'light';
    const nextResolved = resolveThemeMode(nextMode);
    applyThemeToDom(nextResolved);
    useThemeStore.setState({ mode: nextMode, resolvedTheme: nextResolved });
  });
}
