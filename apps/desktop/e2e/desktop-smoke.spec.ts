import { existsSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

function packagedExecutable(): string | undefined {
  const bundle = path.resolve(`out/Emzero-${process.platform}-${process.arch}`);
  const candidates = process.platform === 'darwin'
    ? [path.join(bundle, 'Emzero.app', 'Contents', 'MacOS', 'emzero')]
    : process.platform === 'win32'
      ? [path.join(bundle, 'emzero.exe'), path.join(bundle, 'Emzero.exe')]
      : [path.join(bundle, 'emzero')];
  return candidates.find(existsSync);
}

test('navigates the desktop app and reads sample mail', async () => {
  const testInfo = test.info();
  const executablePath = packagedExecutable();
  const launchArgs = executablePath
    ? [`--user-data-dir=${testInfo.outputPath('electron-profile')}`]
    : [
        path.resolve('.vite/build/main.cjs'),
        `--user-data-dir=${testInfo.outputPath('electron-profile')}`,
      ];
  if (process.platform === 'linux') launchArgs.push('--no-sandbox');
  const launchEnv = { ...process.env };
  delete launchEnv.ELECTRON_RUN_AS_NODE;

  const application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: launchArgs,
    env: {
      ...launchEnv,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
  });

  try {
    const page = await application.firstWindow();
    await page.getByLabel('Emzero').click({ clickCount: 5 });

    await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Messages' }).getByRole('listitem')).toHaveCount(5);

    await page.keyboard.press('ArrowDown');
    const launchConversation = page.getByRole('button', {
      name: /The launch page is ready for review/,
    });
    await expect(launchConversation).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', {
      name: 'The launch page is ready for review',
    })).toBeVisible();
    await expect(page.getByText('launch-checklist.pdf')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Show unread only' }).click();
    await expect(page.getByRole('list', { name: 'Messages' }).getByRole('listitem')).toHaveCount(2);
    await expect(launchConversation).toHaveCount(0);
    await page.getByRole('button', { name: 'Show all mail' }).click();

    await page.getByRole('navigation', { name: 'Mailboxes' })
      .getByRole('button', { name: 'Starred', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Starred', exact: true })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Messages' }).getByRole('listitem')).toHaveCount(2);

    await page.getByRole('navigation', { name: 'Mailboxes' })
      .getByRole('button', { name: /^Drafts \d+ drafts$/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Drafts', exact: true })).toBeVisible();
    await expect(page.getByText('Partnership details', { exact: true })).toBeVisible();

    await page.getByRole('navigation', { name: 'Mailboxes' })
      .getByRole('button', { name: 'Trash', exact: true })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Your trash is empty' })).toBeVisible();
  } finally {
    await application.close();
  }
});
