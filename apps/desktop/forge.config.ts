import path from 'node:path';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';

const appIcon = path.resolve(import.meta.dirname, 'assets/emzero-logo.png');
const macAppIcon = path.resolve(import.meta.dirname, 'assets/emzero-logo.icns');
const entitlements = path.resolve(import.meta.dirname, 'entitlements.plist');

// Signing/notarization only activate when the Apple identity is present, so
// unsigned CI checks and local builds keep working without these secrets.
const macSigningIdentity = process.env.APPLE_SIGNING_IDENTITY;
const osxSign = macSigningIdentity
  ? {
      identity: macSigningIdentity,
      optionsForFile: () => ({
        entitlements,
        hardenedRuntime: true,
      }),
    }
  : undefined;
const osxNotarize =
  macSigningIdentity && process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID
    ? {
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID,
      }
    : undefined;

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    extraResource: [
      path.resolve(import.meta.dirname, '../../LICENSE'),
      path.resolve(import.meta.dirname, 'assets'),
    ],
    executableName: 'emzero',
    icon: process.platform === 'darwin' ? macAppIcon : appIcon,
    osxSign,
    osxNotarize,
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
