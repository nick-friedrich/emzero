# Emzero

A private, multi-account desktop mail client for Linux and macOS.

## Development

Requirements: Node.js 24 and pnpm 11.22.

```sh
corepack enable
pnpm install
pnpm dev
```

The initial application lives in `apps/desktop`. Electron main and preload own desktop capabilities; the sandboxed React renderer contains the shadcn-based UI.

## Commands

- `pnpm dev` — start the desktop app with hot reload
- `pnpm check` — run linting, type checks, and unit tests
- `pnpm build` — create an unpacked application in `apps/desktop/out`
- `pnpm --filter @emzero/desktop make` — create platform installers

See [plan.md](./plan.md) for the current product scope.

## Personal provider setup

### Gmail

Emzero currently connects to Gmail over IMAP and SMTP with a Google app password:

1. Turn on 2-Step Verification for your Google account.
2. Create a 16-character [Google app password](https://myaccount.google.com/apppasswords).
3. Add the account in Emzero, select **Gmail / Google Workspace**, and enter the app password instead of your normal Google password.

This transitional flow requires no Emzero Google OAuth project. Native Google OAuth and a Gmail API backend can replace it later without changing password-based accounts.

### Outlook and Microsoft 365

The current personal setup uses Microsoft device-code OAuth with a client ID that you own:

1. In [Microsoft Entra app registrations](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade), create an app registration.
2. Choose **Accounts in any organizational directory and personal Microsoft accounts** as the supported account type.
3. Under **Authentication**, enable **Allow public client flows**.
4. Under **API permissions**, add the delegated **Office 365 Exchange Online** permissions `IMAP.AccessAsUser.All` and `SMTP.Send`.
5. Copy the **Application (client) ID**, select **Outlook / Microsoft 365** in Emzero, and paste the ID into the setup form.
6. Select **Connect with Microsoft** and finish the device sign-in in the browser that opens.

The client ID is stored with the account and is not a secret. The Microsoft refresh token is encrypted with Electron's operating-system credential storage; access tokens are kept in memory and refreshed as needed.
