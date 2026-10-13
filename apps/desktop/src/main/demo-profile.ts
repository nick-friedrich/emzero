import path from 'node:path';
import { app } from 'electron';

const DEMO_SWITCH = 'demo';

let primaryUserData: string | null = null;

/**
 * Switches to the separate demo profile when Emzero starts with `--demo` or `EMZERO_DEMO=1`.
 * Must run before the app is ready so Chromium and every store use the demo directory; real
 * accounts and mail are then never read.
 */
export function useDemoProfileWhenRequested(): void {
  if (!app.commandLine.hasSwitch(DEMO_SWITCH) && process.env.EMZERO_DEMO !== '1') return;
  primaryUserData = app.getPath('userData');
  app.setPath('userData', path.join(primaryUserData, 'Demo'));
}

export function demoModeEnabled(): boolean {
  return primaryUserData !== null;
}

/** The real profile, which keeps owning settings the demo borrows, such as the AI provider key. */
export function primaryUserDataPath(): string {
  return primaryUserData ?? app.getPath('userData');
}

export function relaunchWithDemoMode(enabled: boolean): void {
  const args = process.argv.slice(1).filter((arg) => arg !== `--${DEMO_SWITCH}`);
  if (enabled) args.push(`--${DEMO_SWITCH}`);
  delete process.env.EMZERO_DEMO;
  app.relaunch({ args });
  app.exit(0);
}
