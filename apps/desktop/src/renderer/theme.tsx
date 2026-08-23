import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

export const themes = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'catppuccin', label: 'Catppuccin' },
] as const;

export type Theme = (typeof themes)[number]['value'];

const storageKey = 'emzero-theme';
const themeValues = new Set<Theme>(themes.map(({ value }) => value));

function isTheme(value: string | null): value is Theme {
  return value !== null && themeValues.has(value as Theme);
}

export function storedTheme(): Theme {
  try {
    const value = window.localStorage.getItem(storageKey);
    return isTheme(value) ? value : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(storedTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(storageKey, theme);
    } catch {
      // A read-only storage context should not prevent theme changes for this session.
    }
  }, [theme]);

  return <ThemeContext value={{ theme, setTheme }}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}

export const messageThemeColors: Record<Theme, { background: string; foreground: string }> = {
  light: { background: '#ffffff', foreground: '#292524' },
  dark: { background: '#222423', foreground: '#e8e9e8' },
  catppuccin: { background: '#1e1e2e', foreground: '#cdd6f4' },
};
