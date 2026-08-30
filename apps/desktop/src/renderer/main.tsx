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

const root = document.getElementById('root');

if (!root) throw new Error('Missing application root');

applyTheme(storedTheme());
applyInterfaceFont(storedInterfaceFont());

const mailWindowId = parsedMailWindowId();

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      {window.location.hash === '#settings'
        ? <SettingsWindow />
        : mailWindowId
          ? <MailWindowBootstrap windowId={mailWindowId} />
          : <App />}
    </ThemeProvider>
  </StrictMode>,
);
