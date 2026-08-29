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
  { value: 'catppuccin', label: 'Catppuccin Mocha' },
  { value: 'catppuccin-latte', label: 'Catppuccin Latte' },
  { value: 'nord', label: 'Nord' },
  { value: 'tokyo-night', label: 'Tokyo Night' },
  { value: 'solarized-dark', label: 'Solarized Dark' },
] as const;

export type Theme = (typeof themes)[number]['value'];

export const interfaceFonts = [
  { value: 'inter', label: 'Inter' },
  { value: 'jetbrains-mono', label: 'JetBrains Mono' },
  { value: 'source-serif', label: 'Source Serif 4' },
] as const;

export type InterfaceFont = (typeof interfaceFonts)[number]['value'];

const themeStorageKey = 'emzero-theme';
const fontStorageKey = 'emzero-interface-font';
const alwaysLoadRemoteImagesStorageKey = 'emzero-always-load-remote-images';
const themeValues = new Set<Theme>(themes.map(({ value }) => value));
const fontValues = new Set<InterfaceFont>(interfaceFonts.map(({ value }) => value));

function isTheme(value: string | null): value is Theme {
  return value !== null && themeValues.has(value as Theme);
}

export function storedTheme(): Theme {
  try {
    const value = window.localStorage.getItem(themeStorageKey);
    return isTheme(value) ? value : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

function isInterfaceFont(value: string | null): value is InterfaceFont {
  return value !== null && fontValues.has(value as InterfaceFont);
}

export function storedInterfaceFont(): InterfaceFont {
  try {
    const value = window.localStorage.getItem(fontStorageKey);
    return isInterfaceFont(value) ? value : 'inter';
  } catch {
    return 'inter';
  }
}

export function applyInterfaceFont(font: InterfaceFont): void {
  document.documentElement.dataset.font = font;
}

export function storedAlwaysLoadRemoteImages(): boolean {
  try {
    return window.localStorage.getItem(alwaysLoadRemoteImagesStorageKey) === 'true';
  } catch {
    return false;
  }
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  interfaceFont: InterfaceFont;
  setInterfaceFont: (font: InterfaceFont) => void;
  alwaysLoadRemoteImages: boolean;
  setAlwaysLoadRemoteImages: (enabled: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const [interfaceFont, setInterfaceFont] = useState<InterfaceFont>(storedInterfaceFont);
  const [alwaysLoadRemoteImages, setAlwaysLoadRemoteImages] = useState(
    storedAlwaysLoadRemoteImages,
  );

  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(themeStorageKey, theme);
    } catch {
      // A read-only storage context should not prevent theme changes for this session.
    }
  }, [theme]);

  useEffect(() => {
    applyInterfaceFont(interfaceFont);
    try {
      window.localStorage.setItem(fontStorageKey, interfaceFont);
    } catch {
      // A read-only storage context should not prevent font changes for this session.
    }
  }, [interfaceFont]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        alwaysLoadRemoteImagesStorageKey,
        String(alwaysLoadRemoteImages),
      );
    } catch {
      // A read-only storage context should not prevent preference changes for this session.
    }
  }, [alwaysLoadRemoteImages]);

  return (
    <ThemeContext value={{
      theme,
      setTheme,
      interfaceFont,
      setInterfaceFont,
      alwaysLoadRemoteImages,
      setAlwaysLoadRemoteImages,
    }}>
      {children}
    </ThemeContext>
  );
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}

export const messageThemeColors: Record<
  Theme,
  { background: string; foreground: string; primary: string }
> = {
  light: { background: '#f8faff', foreground: '#202a3b', primary: '#316dcc' },
  dark: { background: '#111827', foreground: '#e8edf7', primary: '#7aa2e8' },
  catppuccin: { background: '#1e1e2e', foreground: '#cdd6f4', primary: '#cba6f7' },
  'catppuccin-latte': {
    background: '#eff1f5',
    foreground: '#4c4f69',
    primary: '#8839ef',
  },
  nord: { background: '#2e3440', foreground: '#d8dee9', primary: '#88c0d0' },
  'tokyo-night': { background: '#1a1b26', foreground: '#c0caf5', primary: '#7aa2f7' },
  'solarized-dark': { background: '#002b36', foreground: '#93a1a1', primary: '#2aa198' },
};

export const themeColorSchemes: Record<Theme, 'light' | 'dark'> = {
  light: 'light',
  dark: 'dark',
  catppuccin: 'dark',
  'catppuccin-latte': 'light',
  nord: 'dark',
  'tokyo-night': 'dark',
  'solarized-dark': 'dark',
};
