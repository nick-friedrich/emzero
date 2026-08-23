import { describe, expect, it } from 'vitest';
import { findProvider } from './provider-discovery.js';

describe('findProvider', () => {
  it('recognizes a provider-owned email domain', () => {
    expect(findProvider('web.de')).toMatchObject({
      provider: { id: 'webde' },
      detectedBy: 'domain',
    });
  });

  it('recognizes IONOS behind a custom domain from MX records', () => {
    expect(findProvider('launchie.app', ['mx01.ionos.de.', 'mx00.ionos.de.'])).toMatchObject({
      provider: { id: 'ionos-de' },
      detectedBy: 'mx',
    });
  });

  it('does not use partial hostname matches', () => {
    expect(findProvider('example.com', ['mx.ionos.de.attacker.example'])).toEqual({
      provider: null,
      detectedBy: null,
    });
  });
});
