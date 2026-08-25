import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginMicrosoftAuth,
  cancelMicrosoftAuth,
  finishMicrosoftAuth,
  refreshMicrosoftAccessToken,
} from './microsoft-oauth.js';

const response = (value: object, ok = true) =>
  ({ ok, json: async () => value }) as Response;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Microsoft OAuth', () => {
  it('starts device authorization and exchanges the approved code', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          device_code: 'device-code',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://microsoft.com/devicelogin',
          expires_in: 900,
          interval: 1,
          message: 'Enter the code to continue.',
        }),
      )
      .mockResolvedValueOnce(
        response({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const started = await beginMicrosoftAuth('00000000-0000-4000-8000-000000000000');
    expect(started).toMatchObject({ ok: true, userCode: 'ABCD-EFGH' });

    const finished = finishMicrosoftAuth(started.sessionId!);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(finished).resolves.toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 3600,
    });
  });

  it('keeps the existing refresh token when Microsoft does not rotate it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({ access_token: 'new-access-token', expires_in: 3600 }),
      ),
    );

    await expect(
      refreshMicrosoftAccessToken(
        '00000000-0000-4000-8000-000000000000',
        'existing-refresh-token',
      ),
    ).resolves.toEqual({
      accessToken: 'new-access-token',
      refreshToken: 'existing-refresh-token',
      expiresIn: 3600,
    });
  });

  it('stops an in-progress device authorization', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({
          device_code: 'device-code',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://microsoft.com/devicelogin',
          expires_in: 900,
          interval: 1,
        }),
      ),
    );
    const started = await beginMicrosoftAuth('00000000-0000-4000-8000-000000000000');
    const finished = finishMicrosoftAuth(started.sessionId!);
    expect(cancelMicrosoftAuth(started.sessionId!)).toBe(true);
    const assertion = expect(finished).rejects.toThrow('cancelled');
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });
});
