import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class {}, dialog: {} }));

const { pdfFileName, validPdfExportRequest } = await import('./pdf-export.js');

describe('PDF export', () => {
  it('derives a safe file name from the subject', () => {
    expect(pdfFileName('Re: Invoice 12/2026 <final>')).toBe('Re Invoice 12 2026 final.pdf');
    expect(pdfFileName('...hidden')).toBe('hidden.pdf');
    expect(pdfFileName('   ')).toBe('Message.pdf');
    expect(pdfFileName('a'.repeat(300))).toBe(`${'a'.repeat(120)}.pdf`);
  });

  it('validates export requests', () => {
    expect(validPdfExportRequest({ title: 'Hi', html: '<p>Hi</p>' })).toBe(true);
    expect(validPdfExportRequest({ title: 'Hi', html: '' })).toBe(false);
    expect(validPdfExportRequest({ title: 1, html: '<p>Hi</p>' })).toBe(false);
    expect(validPdfExportRequest(null)).toBe(false);
  });
});
