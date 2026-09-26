import { existsSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

function packagedExecutable(): string | undefined {
  const bundle = path.resolve(`out/Emzero-${process.platform}-${process.arch}`);
  const candidates = process.platform === 'darwin'
    ? [path.join(bundle, 'Emzero.app', 'Contents', 'MacOS', 'Emzero')]
    : process.platform === 'win32'
      ? [path.join(bundle, 'emzero.exe'), path.join(bundle, 'Emzero.exe')]
      : [path.join(bundle, 'emzero')];
  return candidates.find(existsSync);
}

test('navigates the desktop app and reads sample mail', async () => {
  const testInfo = test.info();
  const profilePath = testInfo.outputPath('electron-profile');
  const executablePath = packagedExecutable();
  expect(executablePath, 'Build the packaged Electron app before running smoke tests').toBeDefined();
  const launchArgs = executablePath
    ? [`--user-data-dir=${profilePath}`]
    : [
        path.resolve('.vite/build/main.cjs'),
        `--user-data-dir=${profilePath}`,
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
    const userDataPath = await application.evaluate(({ app }) => app.getPath('userData'));
    expect(path.resolve(userDataPath)).toBe(path.resolve(profilePath));
    const page = await application.firstWindow();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByLabel('Emzero').click({ clickCount: 5 });

    await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Messages' }).getByRole('listitem')).toHaveCount(5);

    const appearanceShortcut = process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P';
    const appearance = page.getByRole('dialog', { name: 'Quick appearance' });
    await page.keyboard.press(appearanceShortcut);
    await expect(appearance.getByRole('radio', { name: 'Light', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.keyboard.press('Tab');
    await expect(appearance.getByRole('radio', { name: 'Inter', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('html')).toHaveAttribute('data-font', 'system');
    await page.keyboard.press('Escape');
    await expect(appearance).toBeHidden();
    await page.keyboard.press(appearanceShortcut);
    await expect(appearance.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
    await expect(appearance.getByRole('radio', { name: /^(SF Pro|System)$/ })).toBeChecked();
    await appearance.getByText('Light', { exact: true }).click();
    await appearance.getByText('Inter', { exact: true }).click();
    await page.keyboard.press(appearanceShortcut);
    await expect(appearance).toBeHidden();

    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(800, 700);
    });
    await page.setViewportSize({ width: 800, height: 700 });
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.getByRole('navigation', { name: 'Mailboxes' })).toBeVisible();
    await page.getByRole('button', { name: 'Close navigation' }).click();
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1280, 800);
    });
    await page.setViewportSize({ width: 1280, height: 800 });

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
    const replyButton = page.getByRole('button', { name: 'Reply', exact: true });
    await expect(replyButton).toBeVisible();
    await expect(replyButton).toBeDisabled();
    const messageDetails = page.getByRole('button', { name: 'Details', exact: true });
    await expect(messageDetails).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText(/Reply-To:/)).toHaveCount(0);
    await messageDetails.click();
    await expect(messageDetails).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText(/Reply-To:/)).toBeVisible();

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
    await expect(page.getByRole('checkbox', {
      name: 'Select conversation: Partnership details', exact: true,
    })).toBeVisible();

    await page.getByRole('navigation', { name: 'Mailboxes' })
      .getByRole('button', { name: 'Trash', exact: true })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Your trash is empty' })).toBeVisible();
  } finally {
    await application.close();
  }
});

for (const mailbox of ['unified', 'folder'] as const) {
  test(`preserves docked replies across sync and navigation in ${mailbox} inbox`, async () => {
    const executablePath = packagedExecutable();
    expect(executablePath).toBeDefined();
    const launchEnv = { ...process.env };
    delete launchEnv.ELECTRON_RUN_AS_NODE;
    const application = await electron.launch({
      executablePath,
      args: [
        `--user-data-dir=${test.info().outputPath('reply-profile')}`,
        ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      ],
      env: { ...launchEnv, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    });
    try {
      // Replace mail IPC only in this isolated test process; no server is contacted.
      await application.evaluate(({ ipcMain }) => {
        const account = {
          id: 'reply-test', name: 'Reply Test', email: 'me@example.test',
          username: 'me@example.test', authentication: 'password', createdAt: '', color: 'blue',
          imap: { host: 'example.test', port: 993, secure: true },
          smtp: { host: 'example.test', port: 465, secure: true },
        };
        const folders = [
          { path: 'INBOX', name: 'Inbox', specialUse: '\\Inbox' },
          { path: 'Drafts', name: 'Drafts', specialUse: '\\Drafts' },
        ].map((folder) => ({
          ...folder, parentPath: '', delimiter: '/', selectable: true, unreadCount: 0,
        }));
        const message = {
          folderPath: 'INBOX', uid: 1, messageId: '<reply-test@example.test>',
          inReplyTo: null, references: [], subject: 'Reply persistence test',
          from: [{ name: 'Sender', address: 'sender@example.test' }],
          to: [{ address: account.email }], sentAt: '2026-09-18T10:00:00Z',
          receivedAt: '2026-09-18T10:00:00Z', unread: false, flagged: false,
          important: false, dueDate: null, color: null, size: 100,
        };
        const state = {
          saves: [] as { text: string; previous: unknown }[],
          completed: 0, deleted: 0, lists: 0,
        };
        Object.assign(globalThis, { replyTestState: state });
        const handlers: Record<string, Parameters<typeof ipcMain.handle>[1]> = {
          'accounts:list': () => [account],
          'folders:list': () => ({ ok: true, folders }),
          'messages:list': (_event, _account, folder) => {
            state.lists += 1;
            return { ok: true, messages: folder === 'INBOX' ? [message] : [], total: 1 };
          },
          'messages:get': () => ({ ok: true, messageDetail: {
            ...message, cc: [], replyTo: [], text: 'Please reply.', html: null,
            htmlHasQuotedText: false, attachments: [],
          } }),
          'drafts:save': async (_event, _account, draft, previous) => {
            state.saves.push({ text: draft.text, previous });
            const uid = state.saves.length;
            await new Promise((resolve) => setTimeout(resolve, 400));
            state.completed += 1;
            return { ok: true, draft: { folderPath: 'Drafts', uid } };
          },
          'drafts:delete': () => { state.deleted += 1; return { ok: true }; },
        };
        for (const [channel, handler] of Object.entries(handlers)) {
          ipcMain.removeHandler(channel);
          ipcMain.handle(channel, handler);
        }
      });
      const page = await application.firstWindow();
      await page.reload();
      await page.setViewportSize({ width: 1280, height: 800 });
      if (mailbox === 'folder') {
        await page.getByRole('button', { name: 'R Reply Test me@example.test', exact: true }).click();
      }
      const readState = () => application.evaluate(() =>
        (globalThis as unknown as { replyTestState: {
          saves: { text: string; previous?: { uid: number } }[];
          completed: number; deleted: number; lists: number;
        } }).replyTestState,
      );
      const openReply = async () => {
        await page.getByRole('button', { name: /Sender.*Reply persistence test/ }).click();
        await page.getByRole('button', { name: 'Reply', exact: true }).click();
      };
      await openReply();
      const editor = page.getByRole('region', { name: 'Reply composer' }).getByRole('textbox', { name: 'Message', exact: true });
      const composer = page.getByRole('region', { name: 'Reply composer' });
      await expect(composer).toHaveCSS('position', 'fixed');
      await expect(composer).toHaveCSS('right', '16px');
      await expect(composer).toHaveCSS('bottom', '16px');
      await editor.fill('First part');
      const listsBeforeSync = (await readState()).lists;
      await application.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('sync:mailbox-changed', {});
        BrowserWindow.getAllWindows()[0].webContents.send('sync:changed', {
          state: 'idle', lastSyncedAt: null,
        });
      });
      await expect.poll(async () => (await readState()).lists).toBeGreaterThan(listsBeforeSync);
      await expect(editor).toHaveText('First part');
      await expect.poll(async () => (await readState()).saves.length).toBe(1);
      // Leave with new text before the debounce, while the first save is in flight.
      await editor.fill('First part\nThe complete final paragraph.');
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect.poll(async () => (await readState()).completed).toBe(2);
      const saved = (await readState()).saves;
      expect(saved[1].text).toContain('First part\nThe complete final paragraph.');
      expect(saved[1].previous?.uid).toBe(1);

      await openReply();
      await editor.fill('A reply written before the first autosave.');
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect.poll(async () => (await readState()).completed).toBe(3);
      expect((await readState()).saves[2].text).toContain(
        'A reply written before the first autosave.',
      );

      await openReply();
      await editor.fill('Discard this draft');
      await page.getByRole('button', { name: 'Delete draft', exact: true }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: /Delete/ }).click();
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      // Give a wrongly retained debounce a chance to run after discard/unmount.
      await page.waitForTimeout(1_400);
      expect((await readState()).saves).toHaveLength(3);
    } finally {
      await application.close();
    }
  });
}
