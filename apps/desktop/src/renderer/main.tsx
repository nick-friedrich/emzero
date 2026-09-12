import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import '@/styles.css';
import {
  applyInterfaceFont,
  applyTheme,
  storedInterfaceFont,
  storedTheme,
  ThemeProvider,
} from '@/theme';
import { MailWindowBootstrap, parsedMailWindowId } from '@/mail-window';
import { SettingsWindow } from '@/features/account-settings';
import { AppearanceSwitcher } from '@/features/appearance-switcher';
import { loadSignatures } from '@/features/signatures';

const root = document.getElementById('root');

if (!root) throw new Error('Missing application root');

applyTheme(storedTheme());
applyInterfaceFont(storedInterfaceFont());

const mailWindowId = parsedMailWindowId();

// Composers read signatures synchronously while rendering, so hydrate the cache from the main
// process first. Rendering still proceeds if that fails; the app just starts without signatures.
void loadSignatures().finally(() => {
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider>
        {window.location.hash === '#settings'
          ? <SettingsWindow />
          : mailWindowId
            ? <MailWindowBootstrap windowId={mailWindowId} />
            : <App />}
        <AppearanceSwitcher />
      </ThemeProvider>
    </StrictMode>,
  );
});
