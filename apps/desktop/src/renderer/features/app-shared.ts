import {
  useEffect,
} from 'react';


export const skipSendConfirmationStorageKey = 'emzero-skip-send-confirmation';

export function storedSkipSendConfirmation(): boolean {
  try {
    return window.localStorage.getItem(skipSendConfirmationStorageKey) === 'true';
  } catch {
    return false;
  }
}

export function sendShortcutLabel(): string {
  return window.emzero.platform === 'darwin' ? '⌘ + Enter' : 'Ctrl + Enter';
}

export function useSendShortcut(enabled: boolean, onSend: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.key !== 'Enter' ||
        (!event.ctrlKey && !event.metaKey)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onSend();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [enabled, onSend]);
}

export interface Status {
  kind: 'success' | 'error';
  message: string;
}
