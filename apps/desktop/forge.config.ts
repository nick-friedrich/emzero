import path from 'node:path';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';

const appIcon = path.resolve(import.meta.dirname, 'assets/emzero-logo.png');
const macAppIcon = path.resolve(import.meta.dirname, 'assets/emzero-logo.icns');

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    extraResource: [
      path.resolve(import.meta.dirname, '../../LICENSE'),
      path.resolve(import.meta.dirname, 'assets'),
    ],
    executableName: 'emzero',
    icon: process.platform === 'darwin' ? macAppIcon : appIcon,
  },
  rebuildConfig: {},
  makers: [
    new MakerZIP({}, ['darwin']),
    new MakerDeb({ options: { name: 'emzero', bin: 'emzero', maintainer: 'Nick Friedrich', icon: appIcon } }),
    new MakerRpm({ options: { name: 'emzero', bin: 'emzero', icon: appIcon } }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;
