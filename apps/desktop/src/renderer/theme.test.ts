import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyInterfaceFont,
  storedInterfaceFont,
  themeColorSchemes,
  themes,
} from './theme';

function stubBrowser(storedFont: string | null) {
  const dataset: Record<string, string> = {};
  vi.stubGlobal('window', {
    localStorage: {
      getItem: vi.fn(() => storedFont),
    },
  });
  vi.stubGlobal('document', { documentElement: { dataset } });
  return dataset;
}

describe('interface font preference', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('defaults to bundled Inter for an unknown stored value', () => {
    stubBrowser('comic-sans');
    expect(storedInterfaceFont()).toBe('inter');
  });

  it('restores JetBrains Mono', () => {
    stubBrowser('jetbrains-mono');
    expect(storedInterfaceFont()).toBe('jetbrains-mono');
  });

  it('restores Source Serif 4', () => {
    stubBrowser('source-serif');
    expect(storedInterfaceFont()).toBe('source-serif');
  });

  it('applies the selected font to the document', () => {
    const dataset = stubBrowser(null);
    applyInterfaceFont('jetbrains-mono');
    expect(dataset.font).toBe('jetbrains-mono');
  });
});

describe('Catppuccin themes', () => {
  it('offers both Mocha and Latte', () => {
    expect(themes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Catppuccin Mocha' }),
        expect.objectContaining({ label: 'Catppuccin Latte' }),
      ]),
    );
  });

  it('uses the correct browser color schemes', () => {
    expect(themeColorSchemes.catppuccin).toBe('dark');
    expect(themeColorSchemes['catppuccin-latte']).toBe('light');
  });
});
