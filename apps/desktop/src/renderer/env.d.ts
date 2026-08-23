import type { EmzeroDesktopApi } from '../preload/index.js';

declare global {
  interface Window {
    emzero: EmzeroDesktopApi;
  }
}

export {};
