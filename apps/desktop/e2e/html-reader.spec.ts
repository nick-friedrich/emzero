import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('HTML mail grows with content and uses only the reader scrollbar', async () => {
  const executablePath = path.resolve(`out/Emzero-${process.platform}-${process.arch}`,
    process.platform === 'darwin' ? 'Emzero.app/Contents/MacOS/Emzero'
      : process.platform === 'win32' ? 'Emzero.exe' : 'emzero');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({ executablePath,
    args: [`--user-data-dir=${test.info().outputPath('html-profile')}`,
      ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } });
  try {
    await application.evaluate(({ ipcMain }) => {
      const account = {
        id: 'html-test', name: 'HTML Test', email: 'me@example.test', username: 'me@example.test',
        authentication: 'password', createdAt: '', color: 'blue',
        imap: { host: 'example.test', port: 993, secure: true },
        smtp: { host: 'example.test', port: 465, secure: true },
      };
      const folder = { path: 'INBOX', name: 'Inbox', specialUse: '\\Inbox', parentPath: '',
        delimiter: '/', selectable: true, unreadCount: 0 };
      const message = { folderPath: 'INBOX', uid: 1, messageId: '<html@example.test>',
        inReplyTo: null, references: [], subject: 'A long HTML newsletter',
        from: [{ name: 'Newsletter', address: 'news@example.test' }], to: [{ address: account.email }],
        sentAt: '2026-09-30T10:00:00Z', receivedAt: '2026-09-30T10:00:00Z',
        unread: false, flagged: false, important: false, dueDate: null, color: null, size: 2000 };
      const handlers: Record<string, Parameters<typeof ipcMain.handle>[1]> = {
        'accounts:list': () => [account],
        'folders:list': () => ({ ok: true, folders: [folder] }),
        'messages:list': () => ({ ok: true, messages: [message], total: 1 }),
        'messages:get': () => ({ ok: true, messageDetail: { ...message, cc: [], replyTo: [],
          text: 'Plain text version of the newsletter.', htmlHasQuotedText: true, attachments: [],
          html: `<div style="height:1400px;background:#f5f6f8;padding:20px"><h2>Newsletter</h2><p>A long message should flow through the reader.</p></div>
            <img src="https://images.example.test/banner.png" alt="Blocked remote image">
            <blockquote style="height:400px">An older quoted message</blockquote>
            <a href="https://example.test/article">Read the article</a>
            <script>window.senderScriptRan=true</script>`,
        } }),
      };
      for (const [channel, handler] of Object.entries(handlers)) {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, handler);
      }
    });
    const page = await application.firstWindow();
    await page.reload();
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 800);
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('button', { name: /Newsletter.*A long HTML newsletter/ }).click();
    const frameElement = page.locator('iframe[title="Email content"]');
    const frame = page.frameLocator('iframe[title="Email content"]');
    await expect(frameElement).toHaveAttribute('scrolling', 'no');
    await expect.poll(async () => (await frameElement.boundingBox())?.height ?? 0).toBeGreaterThan(1400);
    await expect(frameElement).toHaveCSS('border-top-width', '0px');
    await expect(page.getByRole('button', { name: 'Load images', exact: true })).toBeVisible();
    await expect(frame.locator('img')).toHaveJSProperty('naturalWidth', 0);
    await expect.poll(async () => frame.locator('body').evaluate(() =>
      (window as unknown as { senderScriptRan?: boolean }).senderScriptRan ?? false)).toBe(false);

    // Sender markup changes size after load; the outer reader follows it.
    const originalHeight = (await frameElement.boundingBox())!.height;
    await frame.locator('img').evaluate((image) => {
      image.setAttribute('src', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=');
      image.style.width = '200px';
      image.style.height = '200px';
      image.style.display = 'block';
    });
    await expect.poll(async () => (await frameElement.boundingBox())?.height ?? 0)
      .toBeGreaterThan(originalHeight + 150);
    const clickReaderButton = async (name: string) => {
      const button = page.getByRole('button', { name, exact: true });
      await button.scrollIntoViewIfNeeded();
      // Let Electron paint the new frame bounds before sending native input.
      await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
      await button.click();
    };
    await clickReaderButton('Show quoted text');
    await expect(page.getByRole('button', { name: 'Hide quoted text', exact: true })).toBeVisible();
    await expect(frame.getByText('An older quoted message')).toBeVisible();
    await expect.poll(async () => (await frameElement.boundingBox())?.height ?? 0)
      .toBeGreaterThan(originalHeight + 350);
    await clickReaderButton('Hide quoted text');
    await expect.poll(async () => (await frameElement.boundingBox())?.height ?? 0)
      .toBeLessThan(originalHeight + 10);

    // A sandboxed link still goes through the application's confirmation.
    await frame.getByRole('link', { name: 'Read the article', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toContainText('https://example.test/article');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await clickReaderButton('Plain text');
    await expect(frameElement).toHaveCount(0);
    await expect(page.getByText('Plain text version of the newsletter.', { exact: true })).toBeVisible();
    await clickReaderButton('HTML');
    await expect.poll(async () => (await frameElement.boundingBox())?.height ?? 0).toBeGreaterThan(1400);
    await page.screenshot({ path: test.info().outputPath('html-reader.png') });
  } finally {
    await application.close();
  }
});
