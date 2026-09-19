/** Appearance values shared by the renderer and main-process backup validation. */
export const THEME_VALUES = [
  'light',
  'dark',
  'catppuccin',
  'catppuccin-latte',
  'nord',
  'tokyo-night',
  'solarized-dark',
  'gruvbox-dark',
  'rose-pine-dawn',
] as const;

export type Theme = (typeof THEME_VALUES)[number];

export const INTERFACE_FONT_VALUES = ['inter', 'system', 'jetbrains-mono', 'source-serif'] as const;

export type InterfaceFont = (typeof INTERFACE_FONT_VALUES)[number];
