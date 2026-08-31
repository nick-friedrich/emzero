# Emzero code map

This index records where application responsibilities live. Read it before making changes, and update it whenever files or ownership change.

## Repository entry points

- `README.md` — local development requirements and commands.
- `plan.md` — current product scope and delivery plan.
- `package.json` — workspace commands; `pnpm check` runs lint, type checking, and tests.
- `apps/desktop/package.json` — Electron application dependencies and package-level scripts.
- `apps/web/` — Laravel 13 / Inertia React website for the public landing page, waitlist, blog, and private admin.

## Website

- `apps/web/routes/web.php` — public landing, waitlist, blog, and authenticated admin routes.
- `apps/web/app/Models/` — users, waitlist subscribers, and blog posts.
- `apps/web/app/Http/Controllers/` — public landing/blog/waitlist request handling.
- `apps/web/app/Http/Controllers/Admin/` — admin dashboard, subscriber management/export, and blog CRUD.
- `apps/web/app/Actions/` — waitlist subscription and blog post creation/update operations.
- `apps/web/resources/js/pages/home.tsx` — public landing page.
- `apps/web/resources/js/pages/blog/` — public blog index and post pages.
- `apps/web/resources/js/pages/admin/` — private dashboard, waitlist, and blog management UI.
- `apps/web/resources/js/components/public/` — public navigation, waitlist form, and blog card primitives.
- `apps/web/resources/js/components/admin/` — reusable admin post editor.
- `apps/web/public/brand/` — original and optimized brand assets, favicons, and product screenshots served directly by the website.
- `apps/web/database/migrations/` — website database schema; production should use a persistent database shared with PHP-FPM.
- `apps/web/tests/Feature/` — public, authentication, and admin feature coverage.

## Desktop process boundaries

- `apps/desktop/src/main/index.ts` — Electron main-process startup, window creation, and lifecycle.
- `apps/desktop/assets/` — renderer and native package branding assets, including the macOS `.icns` application icon.
- `apps/desktop/src/main/accounts.ts` — trusted IPC validation and handler registration; delegates privileged work to focused main-process services.
- `apps/desktop/src/main/account-storage.ts` — persisted, user-ordered account records and conversion to renderer-safe account summaries.
- `apps/desktop/src/main/account-backup.ts` — backward-compatible password-encrypted backup export/import for accounts, optional app settings and signatures, destination-machine credential re-wrapping, and signature account-ID remapping.
- `apps/desktop/src/main/account-connection.ts` — IMAP/SMTP account connectivity verification.
- `apps/desktop/src/main/microsoft-oauth.ts` — personal Microsoft device-code authorization, token exchange, and refresh-token renewal.
- `apps/desktop/src/main/account-folders.ts` — cached/server folder listing, validation, creation, rename, move, deletion, and ordering.
- `apps/desktop/src/main/background-sync.ts` — foreground-safe scheduled and on-demand Inbox/Sent synchronization state and execution.
- `apps/desktop/src/main/mail-notifications.ts` — new-mail detection, notification preference state, native desktop alerts, and notification activation behavior.
- `apps/desktop/src/main/mail-runtime.ts` — shared mail-cache lifecycle, credential caching, safe error formatting, and sleep-safe isolated interactive/background per-account IMAP connections.
- `apps/desktop/src/main/message-reader.ts` — incremental folder-message synchronization with periodic full reconciliation, message parsing, and cached/server message reading.
- `apps/desktop/src/main/message-sender.ts` — SMTP delivery, IMAP Sent-copy persistence, and sent-message cache updates.
- `apps/desktop/src/main/mail-drafts.ts` — MIME draft compilation plus append-first IMAP draft autosave and deletion.
- `apps/desktop/src/main/attachment-files.ts` — native file selection, opaque outgoing-file authorization, attachment limits, retained-draft attachment authorization, and received-attachment saving.
- `apps/desktop/src/main/message-actions.ts` — read/unread, star/unstar, delete, same-account move, and cross-account message-transfer operations.
- `apps/desktop/src/main/bulk-message-jobs.ts` — bulk-action request validation, execution, cancellation, and progress publication.
- `apps/desktop/src/main/mail-cache.ts` — local SQLite-backed mail metadata/body cache and search.
- `apps/desktop/src/main/message-html.ts` — sanitization and quoted-content detection for message HTML.
- `apps/desktop/src/main/mail-windows.ts` — validated creation of standalone message, composer, and single-instance settings windows.
- `apps/desktop/src/main/provider-discovery.ts` — provider catalog lookup and domain/MX discovery.
- `apps/desktop/src/main/folder-subscriptions.ts` — IMAP folder subscription and deletion helpers.
- `apps/desktop/src/preload/index.ts` — typed `window.emzero` bridge exposed to the sandboxed renderer.
- `apps/desktop/src/providers/catalog.json` — known mail-provider connection settings.

## Shared contracts and domain logic

- `apps/desktop/src/shared/accounts.ts` — IPC contracts, account/folder/message types, folder-tree operations, bulk-job types, and account validation.
- `apps/desktop/src/shared/conversations.ts` — conversation grouping and quoted-text splitting.
- `apps/desktop/src/shared/replies.ts` — reply construction, address parsing, and outgoing-draft validation.

Shared modules must remain usable by both Electron and renderer code; do not import renderer components or browser-only state into them.

## Renderer shell

- `apps/desktop/src/renderer/main.tsx` — React renderer entry point and providers.
- `apps/desktop/src/renderer/mail-window.tsx` — standalone composer and conversation window loading and actions.
- `apps/desktop/src/renderer/App.tsx` — application-level orchestration only: account loading and cross-window refresh, current mailbox selection, persisted sidebar/mail-layout preferences, dialog visibility, sync revision, and active bulk-operation state.
- `apps/desktop/src/renderer/styles.css` — global Tailwind styles and visual tokens.
- `apps/desktop/src/renderer/theme.tsx` — synchronized appearance and mail-behavior preference persistence/context, plus message color schemes.
- `apps/desktop/src/renderer/lib/utils.ts` — small renderer-wide helpers such as class merging and range selection.
- `apps/desktop/src/renderer/components/ui/` — reusable low-level UI primitives.

## Renderer features

- `features/sidebar.tsx` — desktop/mobile navigation with a fixed brand header and action footer, scrollable mailbox/account navigation, drag-to-reorder accounts, folder CRUD, drag-and-drop folder moves, and sync status.
- `features/demo-mode.tsx` — persistent, privacy-safe show-off dataset injected into the existing mailbox and conversation UI for screenshots.
- `features/account-setup.tsx` — provider detection, password/app-password setup, and personal Microsoft device-code connection flow.
- `features/account-settings.tsx` — standalone tabbed settings window for general mail behavior, accounts, signatures, and encrypted backup/restore.
- `features/signatures.ts` — persisted account-to-signature assignments and outgoing-message signature formatting.
- `features/signature-picker.tsx` — compose-time signature selection shared by new-message and reply composers.
- `features/compose-dialog.tsx` — reusable docked, full-area, inline-draft, and standalone composer with recipient suggestions, attachments, validation, confirmation, and sending.
- `features/mail-search.tsx` — search form/results and selected-result reader.
- `features/message-list.tsx` — one account-folder conversation list, selection, and folder-scoped actions.
- `features/unified-inbox.tsx` — multi-account Inbox, Starred, and Trash aggregation, selection, and actions.
- `features/mail-common.tsx` — shared mail-list building blocks used by folder, unified, and search views: action controls, selection toolbar, and mail-view types/helpers.
- `features/inbox-view-options.tsx` — persisted icon filters and Starred/Unread inbox grouping shared by account and unified inboxes.
- `features/mail-split-layout.tsx` — persisted, pointer- and keyboard-resizable list/reader layout shared by three-column mail views.
- `features/mail-common.test.ts` — renderer tests for isolated HTML-email document generation and remote-image privacy controls.
- `features/message-move.tsx` — account-and-folder destination picker for single and bulk message moves.
- `features/conversation-reader.tsx` — conversation reader, message body/thread cards, received-attachment saving, quoted-content display, and inline reply composer.
- `features/message-prefetch.ts` — bounded idle, hover, and keyboard-focus message-body prefetching shared by folder, unified, and search lists.
- `features/attachment-picker.tsx` — reusable outgoing-attachment selection and removal UI for compose and reply.
- `features/draft-autosave.ts` — debounced, sequential IMAP autosave state shared by compose and inline reply.
- `features/bulk-operation.tsx` — persistent progress/status bar for background bulk message jobs.
- `features/undoable-delete.tsx` — shared delayed-action controller and Undo bar for optimistic conversation deletion, archiving, and moves.
- `features/app-shared.ts` — small cross-feature status and send-shortcut preferences/hooks.
- `features/form-field.tsx` — shared labeled form-field wrapper.

All paths in this section are relative to `apps/desktop/src/renderer/`.

## Tests

- Tests live beside their implementation as `*.test.ts` or `*.test.tsx`.
- `apps/desktop/src/main/` tests cover cache, HTML sanitization, provider discovery, folder subscriptions, folder input rules, message parsing helpers, message-action rules, draft-folder discovery, and bulk-job validation/progress.
- `apps/desktop/src/shared/` tests cover domain helpers and contracts.
- `apps/desktop/src/renderer/` tests cover renderer utilities and theming.
- Run the complete suite with `pnpm check` from the repository root.
