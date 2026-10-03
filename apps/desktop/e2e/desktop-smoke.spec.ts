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
    await page.screenshot({ path: testInfo.outputPath('modern-inbox.png') });

    await page.getByRole('button', { name: 'View options', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('modern-view-options.png') });
    await page.getByRole('button', { name: 'Use three-column layout' }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /The launch page is ready for review/ }).click();
    await expect(page.getByRole('heading', { name: 'The launch page is ready for review' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('modern-split.png') });
    await page.getByRole('button', { name: 'Close message', exact: true }).click();
    await page.getByRole('button', { name: 'View options', exact: true }).click();
    await page.getByRole('button', { name: 'Use list layout' }).click();
    await page.keyboard.press('Escape');

    const appearanceShortcut = process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P';
    const appearance = page.getByRole('dialog', { name: 'Quick appearance' });
    await page.keyboard.press(appearanceShortcut);
    await expect(appearance.getByRole('radio', { name: 'Light', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.keyboard.press('Escape');
    await page.screenshot({ path: testInfo.outputPath('modern-dark.png') });
    await page.getByRole('button', { name: /The launch page is ready for review/ }).click();
    await expect(page.getByRole('heading', { name: 'The launch page is ready for review' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('modern-dark-reader.png') });
    await page.keyboard.press('Escape');
    await page.keyboard.press(appearanceShortcut);
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
    await page.screenshot({ path: testInfo.outputPath('modern-narrow-navigation.png') });
    await page.getByRole('button', { name: 'Close navigation' }).click();
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('modern-narrow-inbox.png') });
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1280, 800);
    });
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    const launchConversation = page.getByRole('button', {
      name: /The launch page is ready for review/,
    });
    await expect(launchConversation).toBeFocused();
    await expect(launchConversation).toHaveCSS('box-shadow', 'none');
    await expect(launchConversation.locator('..')).toHaveCSS('box-shadow', /1px.*inset|inset.*1px/);
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', {
      name: 'The launch page is ready for review',
    })).toBeVisible();
    await expect(page.getByText('launch-checklist.pdf')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('modern-reader.png') });
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

    await page.getByRole('button', { name: 'View options', exact: true }).click();
    await page.getByRole('button', { name: 'Show unread only' }).click();
    await expect(page.getByRole('list', { name: 'Messages' }).getByRole('listitem')).toHaveCount(2);
    await expect(launchConversation).toHaveCount(0);
    await page.getByRole('button', { name: 'Show all mail' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'View options', exact: true })).toBeFocused();

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

    await page.getByRole('combobox', { name: 'Switch account' }).selectOption('demo-personal');
    await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Switch account' })).toHaveValue('demo-personal');
    await page.getByRole('combobox', { name: 'Switch account' }).selectOption('');

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
  test(`preserves inline replies across sync and navigation in ${mailbox} inbox`, async () => {
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
          saves: [] as { text: string; html?: string; previous: unknown }[],
          completed: 0, deleted: 0, lists: 0,
        };
        Object.assign(globalThis, { replyTestState: state });
        const handlers: Record<string, Parameters<typeof ipcMain.handle>[1]> = {
          'accounts:list': () => [account],
          'signatures:list': () => ({
            signatures: [{ id: 'sig', name: 'Default', body: 'Nick\nEmzero', accountIds: [account.id] }],
            initialized: true,
          }),
          'folders:list': () => ({ ok: true, folders }),
          'messages:list': (_event, _account, folder) => {
            state.lists += 1;
            return { ok: true, messages: folder === 'INBOX' ? [message] : [], total: 1 };
          },
          'messages:get': () => ({ ok: true, messageDetail: {
            ...message, cc: [], replyTo: [],
            text: `Please reply.\n\n${'A long paragraph that pushes the reply box below the fold.\n\n'.repeat(40)}`,
            html: null,
            htmlHasQuotedText: false, attachments: [],
          } }),
          'drafts:save': async (_event, _account, draft, previous) => {
            state.saves.push({ text: draft.text, html: draft.html, previous });
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
          saves: { text: string; html?: string; previous?: { uid: number } }[];
          completed: number; deleted: number; lists: number;
        } }).replyTestState,
      );
      const openReply = async (entry: 'Write a reply…' | 'Reply' = 'Write a reply…') => {
        await page.getByRole('button', { name: /Sender.*Reply persistence test/ }).click();
        await page.getByRole('button', { name: entry, exact: true }).click();
      };
      await openReply('Reply');
      const editor = page.getByRole('region', { name: 'Reply composer' }).getByRole('textbox', { name: 'Message', exact: true });
      const composer = page.getByRole('region', { name: 'Reply composer' });
      await expect(composer).toHaveCSS('position', 'relative');
      await expect(composer).toBeVisible();
      // Opening a reply below a long message brings the composer into view, ready to type.
      await expect(composer).toBeInViewport();
      await expect(editor).toBeFocused();
      // Google Docs wraps pasted text in a normal-weight <b>; only truly bold text stays bold.
      await editor.evaluate((node) => {
        const data = new DataTransfer();
        data.setData('text/html', '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1">'
          + '<span style="font-weight:400">Pasted from Docs </span><span style="font-weight:700">bold part</span></b>');
        data.setData('text/plain', 'Pasted from Docs bold part');
        node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      });
      await expect(editor).toContainText('Pasted from Docs bold part');
      await expect(editor.locator('b')).toHaveText('bold part');
      if (mailbox === 'unified') await page.screenshot({ path: test.info().outputPath('reply-scrolled.png') });
      // Files dropped on the composer are handed to the main process and attached.
      await composer.evaluate((node) => {
        const data = new DataTransfer();
        data.items.add(new File(['quarterly numbers'], 'report.txt', { type: 'text/plain' }));
        for (const type of ['dragenter', 'dragover', 'drop']) {
          node.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }));
        }
      });
      await expect(composer.getByLabel('Selected attachments')).toContainText('report.txt');
      await composer.getByRole('button', { name: 'Remove report.txt' }).click();
      await expect(composer.getByRole('textbox', { name: 'Subject', exact: true })).toBeHidden();
      await composer.getByRole('button', { name: 'Edit details', exact: true }).click();
      await expect(composer.getByRole('textbox', { name: 'Subject', exact: true })).toBeVisible();
      await composer.getByRole('button', { name: 'Hide details', exact: true }).click();
      await editor.fill('First part');
      if (mailbox === 'unified') {
        await page.setViewportSize({ width: 1440, height: 1100 });
        await page.screenshot({ path: test.info().outputPath('modern-reply.png') });
        await page.setViewportSize({ width: 1280, height: 800 });
      }
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
      // Give a wrongly retained debounce a chance to run after discard.
      await page.waitForTimeout(1_400);
      expect((await readState()).saves).toHaveLength(3);
      await page.getByRole('button', { name: 'Write a reply…', exact: true }).click();
      await expect(editor).not.toContainText('Discard this draft');
      // The signature shows without a divider; the plain-text part carries the "-- " delimiter.
      await expect(editor.locator('#Signature')).toHaveText('NickEmzero');
      await expect(editor).not.toContainText('--');
      await page.keyboard.type('Thanks');
      await expect.poll(async () => (await readState()).saves.length).toBe(4);
      const signed = (await readState()).saves[3];
      expect(signed.text).toBe('Thanks\n\n-- \nNick\nEmzero');
      expect(signed.html).toContain('<div id="Signature">Nick<br>Emzero</div>');
      expect(signed.html).not.toContain('--');
      await composer.getByRole('button', { name: 'Edit details', exact: true }).click();
      await expect(composer.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('Re: Reply persistence test');
      await page.getByRole('button', { name: 'Delete draft', exact: true }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: /Delete/ }).click();
      await page.getByRole('button', { name: 'Back', exact: true }).click();

      // New messages occupy the mail area and autosave when navigating away.
      await page.getByRole('button', { name: 'Compose', exact: true }).click();
      const newMessage = page.getByRole('region', { name: 'New message', exact: true });
      await expect(newMessage).toHaveCSS('position', 'relative');
      await expect(page.getByRole('list', { name: 'Messages' })).toHaveCount(0);
      await expect(newMessage.getByRole('button', { name: 'Expand to message area' })).toHaveCount(0);
      await newMessage.getByRole('combobox', { name: 'To', exact: true }).fill('friend@example.test');
      await newMessage.getByRole('textbox', { name: 'Subject', exact: true }).fill('A dedicated compose page');
      const newEditor = newMessage.getByRole('textbox', { name: 'Message', exact: true });
      await newEditor.fill('Room to write without covering the inbox.');
      await page.getByRole('button', { name: 'Compose', exact: true }).click();
      await expect(newEditor).toHaveText('Room to write without covering the inbox.');
      if (mailbox === 'unified') {
        await page.setViewportSize({ width: 1440, height: 1100 });
        await page.screenshot({ path: test.info().outputPath('modern-compose-page.png') });
        await page.setViewportSize({ width: 1280, height: 800 });
      }
      await page.getByRole('navigation', { name: 'Mailboxes' }).getByRole('button', { name: 'Inbox', exact: true }).first().click();
      await expect(newMessage).toHaveCount(0);
      await expect(page.getByRole('list', { name: 'Messages' })).toBeVisible();
      await expect.poll(async () => (await readState()).completed).toBe(5);
      expect((await readState()).saves[4].text).toBe('Room to write without covering the inbox.');
    } finally {
      await application.close();
    }
  });
}
