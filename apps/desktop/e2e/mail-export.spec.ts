import { readFileSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

// A 1x1 red PNG, scaled up in the message so it is easy to right-click.
const redPixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

test('copies embedded images and saves a conversation as PDF', async () => {
  const executablePath = path.resolve(`out/Emzero-${process.platform}-${process.arch}`,
    process.platform === 'darwin' ? 'Emzero.app/Contents/MacOS/Emzero'
      : process.platform === 'win32' ? 'Emzero.exe' : 'emzero');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({ executablePath,
    args: [`--user-data-dir=${test.info().outputPath('export-profile')}`,
      ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        EMZERO_HIDDEN_WINDOWS: process.env.EMZERO_E2E_SHOW_WINDOWS === '1' ? '' : '1' } });
  const pdfPath = test.info().outputPath('exported.pdf');
  try {
    await application.evaluate(({ dialog, ipcMain, Menu }, { image, savePath }) => {
      const account = {
        id: 'export-test', name: 'Export Test', email: 'me@example.test', username: 'me@example.test',
        authentication: 'password', createdAt: '', color: 'blue', aliases: [],
        imap: { host: 'example.test', port: 993, secure: true },
        smtp: { host: 'example.test', port: 465, secure: true },
      };
      const folder = { path: 'INBOX', name: 'Inbox', specialUse: '\\Inbox', parentPath: '',
        delimiter: '/', selectable: true, unreadCount: 0 };
      const message = { folderPath: 'INBOX', uid: 1, messageId: '<export@example.test>',
        inReplyTo: null, references: [], subject: 'Invoice 10/2026',
        from: [{ name: 'Billing', address: 'billing@example.test' }], to: [{ address: account.email }],
        sentAt: '2026-10-01T10:00:00Z', receivedAt: '2026-10-01T10:00:00Z',
        unread: false, flagged: false, important: false, dueDate: null, color: null, size: 2000 };
      const handlers: Record<string, Parameters<typeof ipcMain.handle>[1]> = {
        'accounts:list': () => [account],
        'folders:list': () => ({ ok: true, folders: [folder] }),
        'messages:list': () => ({ ok: true, messages: [message], total: 1 }),
        'messages:get': () => ({ ok: true, messageDetail: { ...message, cc: [], replyTo: [],
          text: 'Your invoice is attached.', htmlHasQuotedText: false, attachments: [],
          html: `<p>Your invoice is attached.</p><img alt="Logo" style="display:block;width:120px;height:120px" src="data:image/png;base64,${image}">`,
        } }),
      };
      for (const [channel, handler] of Object.entries(handlers)) {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, handler);
      }
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: savePath })) as typeof dialog.showSaveDialog;
      // Capture the native context menu instead of showing it.
      const state = globalThis as unknown as { contextMenu?: Electron.MenuItemConstructorOptions[] };
      Menu.buildFromTemplate = ((template: Electron.MenuItemConstructorOptions[]) => {
        state.contextMenu = template;
        return { popup: () => undefined } as unknown as Electron.Menu;
      }) as typeof Menu.buildFromTemplate;
    }, { image: redPixel, savePath: pdfPath });
    const page = await application.firstWindow();
    await page.reload();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('button', { name: /Billing.*Invoice 10\/2026/ }).click();

    const image = page.frameLocator('iframe[title="Email content"]').locator('img');
    await expect(image).toHaveJSProperty('complete', true);
    await image.click({ button: 'right' });
    await expect.poll(() => application.evaluate(() =>
      ((globalThis as unknown as { contextMenu?: { label?: string }[] }).contextMenu ?? [])
        .map((item) => item.label))).toContain('Copy Image');
    await application.evaluate(({ clipboard }) => {
      clipboard.clear();
      const menu = (globalThis as unknown as { contextMenu: Electron.MenuItemConstructorOptions[] }).contextMenu;
      const copy = menu.find((item) => item.label === 'Copy Image')!;
      (copy.click as () => void)();
    });
    await expect.poll(() => application.evaluate(({ clipboard }) => clipboard.readImage().getSize().width))
      .toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Save as PDF', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('exported.pdf saved.');
    const pdf = readFileSync(pdfPath);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1_000);
  } finally {
    await application.close();
  }
});
