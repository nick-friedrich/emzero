# Emzero

A private, multi-account desktop mail client for Linux and macOS, with a Laravel-powered product website.

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
- `pnpm check` — run linting, type checks, unit tests, and packaged Electron smoke tests
- `pnpm build` — create an unpacked application in `apps/desktop/out`
- `pnpm --filter @emzero/desktop make` — create platform installers

See [plan.md](./plan.md) for the current product scope.

## Website

The Laravel 13 website lives in `apps/web` and uses Inertia, React, and SQLite locally. It includes the public landing page, waitlist, blog, and a private admin area.

```sh
cd apps/web
composer run setup
php artisan app:create-admin you@example.com --name="Your Name"
composer run dev
```

Open <http://localhost:8000>. The development command runs PHP, the queue listener, logs, and Vite together.

Production does not need a Node.js server. Run `npm ci && npm run build` during deployment, deploy the resulting application and `public/build` assets, point the web server document root at `apps/web/public`, and send PHP requests to the shared PHP-FPM container. Then run `php artisan migrate --force` and the usual Laravel cache commands. Configure a persistent production database; SQLite is only the local default.

Public registration is disabled. Create or promote the owner account on the production host with `php artisan app:create-admin you@example.com`; the command prompts securely for the password.

## Personal provider setup

### Gmail

Emzero currently connects to Gmail over IMAP and SMTP with a Google app password:

1. Turn on 2-Step Verification for your Google account.
2. Create a 16-character [Google app password](https://myaccount.google.com/apppasswords).
3. Add the account in Emzero, select **Gmail / Google Workspace**, and enter the app password instead of your normal Google password.

This transitional flow requires no Emzero Google OAuth project. Native Google OAuth and a Gmail API backend can replace it later without changing password-based accounts.

### Outlook and Microsoft 365

Emzero uses its registered Microsoft public-client application and device-code OAuth:

1. Add an account and select **Outlook / Microsoft 365**.
2. Select **Connect with Microsoft**.
3. Copy the displayed device code, select **Open Microsoft**, and approve mail access in the browser.

The public Microsoft application ID is stored with the account. The Microsoft refresh token is encrypted with Electron's operating-system credential storage; access tokens are kept in memory and refreshed as needed.

## License

Emzero is licensed under the [MIT License](./LICENSE). Third-party dependencies retain their own licenses and notices.

## Automated checks

The root GitHub Actions workflow runs on pushes to `main`, version tags (`v*`), pull requests, and manual dispatch. It scans the full Git history with Gitleaks, runs desktop checks and creates packages on Linux and macOS, and builds and checks the website. The nested website workflow is a starter-template file; GitHub uses the root workflow for this monorepo.

To scan locally with Gitleaks 8.30.1:

```sh
gitleaks git . --log-opts="--all" --config=.gitleaks.toml --redact=100
```

These checks validate unsigned packages. Public macOS releases still need Apple signing and notarization, and a release publishing workflow. Passing CI alone does not publish a release or change repository visibility.
