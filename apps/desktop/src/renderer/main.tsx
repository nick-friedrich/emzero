import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import '@/styles.css';
import { applyTheme, storedTheme, ThemeProvider } from '@/theme';

const root = document.getElementById('root');

if (!root) throw new Error('Missing application root');

applyTheme(storedTheme());

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
