import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import type { PdfExportRequest, PdfExportResult } from '../shared/accounts.js';

const maxDocumentLength = 60 * 1024 * 1024;

export function validPdfExportRequest(value: unknown): value is PdfExportRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as { title?: unknown; html?: unknown };
  return typeof request.title === 'string' && request.title.length <= 1_000 &&
    typeof request.html === 'string' && request.html.length > 0 && request.html.length <= maxDocumentLength;
}

export function pdfFileName(title: string): string {
  const base = title
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120)
    .trim();
  return `${base || 'Message'}.pdf`;
}

async function renderPdf(html: string): Promise<Buffer> {
  const directory = path.join(os.tmpdir(), 'emzero-pdf', randomUUID());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const documentPath = path.join(directory, 'message.html');
  // The printable document is rendered without scripts in its own hidden window.
  const printWindow = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: {
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'emzero-pdf-export',
    },
  });
  printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  printWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  try {
    await writeFile(documentPath, html, { mode: 0o600 });
    await printWindow.loadFile(documentPath);
    return await printWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
    });
  } finally {
    printWindow.destroy();
    await rm(directory, { recursive: true, force: true });
  }
}

export async function exportPdf(
  parent: BrowserWindow | null,
  title: string,
  html: string,
): Promise<PdfExportResult> {
  try {
    const options = { title: 'Save as PDF', defaultPath: pdfFileName(title), filters: [{ name: 'PDF', extensions: ['pdf'] }] };
    const destination = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
    if (destination.canceled || !destination.filePath) return { ok: true, canceled: true };
    await writeFile(destination.filePath, await renderPdf(html));
    return { ok: true, message: `${path.basename(destination.filePath)} saved.` };
  } catch (error) {
    return { ok: false, message: `Could not save PDF: ${error instanceof Error ? error.message : String(error)}` };
  }
}

