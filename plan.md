# Emzero Mail — Initial Plan

## Goal

A fast, private desktop mail client for Linux and macOS. It connects directly to multiple email accounts, provides unified and per-account views, and leaves room for a future mobile client in the same monorepo.

## MVP

- Add, edit, and remove multiple IMAP/SMTP accounts
- Secure credential storage using the operating system keychain
- Sync IMAP folders and messages into a local database for fast/offline browsing
- Unified inbox plus per-account inboxes and standard IMAP folders
- Conversation view grouped by message headers, with a readable HTML/plain-text renderer
- Compose, reply, reply all, and forward; send through SMTP
- Drafts, sent-mail handling, attachments, read/unread, star, move, archive, and delete
- Background sync, connection status, useful errors, and desktop notifications
- Search cached message headers and bodies

## Product Constraints

- Linux is a first-class platform; macOS is supported from the start
- Mail data stays local except when communicating with configured mail servers
- Account state and folders remain separate even when shown in unified views
- UI must stay responsive while syncing large mailboxes
- Provider authentication is introduced incrementally: passwords/app passwords remain the generic baseline, with Microsoft device-code OAuth as the first provider-specific path and native provider APIs left behind explicit adapters

## Initial Stack

- pnpm workspace with the application in `apps/desktop`
- Electron Forge with Vite, React, and TypeScript
- Tailwind CSS and locally owned shadcn/ui components
- SQLite with full-text search for the local cache
- ImapFlow for IMAP and Nodemailer for SMTP
- Vitest for unit tests; Playwright will be added with end-to-end flows

## Repository Shape

```text
apps/
  desktop/        # initial desktop application
```

The repository starts as a small pnpm workspace, but all application code initially lives together under `apps/desktop`. Desktop-specific IMAP, SMTP, database, keychain, and filesystem code should still sit behind clear internal interfaces.

If a mobile client is actually started, reusable domain logic and UI primitives can then be extracted into `packages/` based on real shared requirements rather than anticipated ones.

Within the desktop app, Electron main owns privileged operations, preload exposes a small typed API, and the sandboxed React renderer owns presentation. Email HTML is treated as untrusted content and will be sanitized and isolated before display.

## Delivery Steps

1. Desktop shell and UI foundation
2. Account setup, secure credential storage, and connectivity checks
3. IMAP sync, local database, folder navigation, and unified inbox
4. Message/conversation reader, composer, SMTP sending, and attachments
5. Mail actions, search, notifications, packaging, and Linux/macOS testing

## Not in the First Version

- Mobile app, calendar, contacts, rules, extensions, encryption, or Exchange support
- Advanced provider integrations beyond what IMAP/SMTP requires
- Cross-device synchronization of app settings
