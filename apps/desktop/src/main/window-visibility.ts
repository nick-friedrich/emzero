import { app, type BrowserWindow } from 'electron';

// End-to-end tests set this so the packaged app runs without windows or a
// Dock icon appearing on the developer's screen. Hidden windows still render,
// so Playwright can drive and screenshot them normally. Only macOS honors it:
// hidden windows stall under Linux X11, and Linux CI already runs in xvfb.
const hiddenWindows = process.env.EMZERO_HIDDEN_WINDOWS === '1' && process.platform === 'darwin';

// Chromium throttles timers in hidden windows, which would shift debounce
// timing (such as draft autosave) away from what a visible window does.
export const hiddenWindowWebPreferences = hiddenWindows ? { backgroundThrottling: false } : {};

export function hideDockForHiddenWindows(): void {
  if (hiddenWindows && process.platform === 'darwin') app.dock?.hide();
}

export function revealWindow(window: BrowserWindow, { focus = false } = {}): void {
  if (hiddenWindows) return;
  window.show();
  if (focus) window.focus();
}
