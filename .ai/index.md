# Emzero code map

This index records where application responsibilities live. Read it before making changes, and update it whenever files or ownership change.

## Repository entry points

- `README.md` — local development requirements and commands.
- `plan.md` — current product scope and delivery plan.
- `package.json` — workspace commands; `pnpm check` runs lint, type checking, and tests.
- `apps/desktop/package.json` — Electron application dependencies and package-level scripts.

## Desktop process boundaries

- `apps/desktop/src/main/index.ts` — Electron main-process startup, window creation, and lifecycle.
- `apps/desktop/src/main/accounts.ts` — trusted IPC validation and handler registration; delegates privileged work to focused main-process services.
- `apps/desktop/src/main/account-storage.ts` — persisted account records and conversion to renderer-safe account summaries.
- `apps/desktop/src/main/account-connection.ts` — IMAP/SMTP account connectivity verification.
- `apps/desktop/src/main/microsoft-oauth.ts` — personal Microsoft device-code authorization, token exchange, and refresh-token renewal.
- `apps/desktop/src/main/account-folders.ts` — cached/server folder listing, validation, creation, rename, move, deletion, and ordering.
- `apps/desktop/src/main/background-sync.ts` — scheduled and on-demand multi-account synchronization state and execution.
- `apps/desktop/src/main/mail-runtime.ts` — shared mail-cache lifecycle, credential decryption, safe error formatting, and IMAP client lifecycle helpers.
- `apps/desktop/src/main/message-reader.ts` — incremental folder-message synchronization, message parsing, and cached/server message reading.
- `apps/desktop/src/main/message-sender.ts` — SMTP delivery, IMAP Sent-copy persistence, and sent-message cache updates.
- `apps/desktop/src/main/mail-drafts.ts` — MIME draft compilation plus append-first IMAP draft autosave and deletion.
- `apps/desktop/src/main/attachment-files.ts` — native file selection, opaque outgoing-file authorization, attachment limits, and received-attachment saving.
- `apps/desktop/src/main/message-actions.ts` — read/unread, star/unstar, delete, same-account move, and cross-account message-transfer operations.
- `apps/desktop/src/main/bulk-message-jobs.ts` — bulk-action request validation, execution, cancellation, and progress publication.
- `apps/desktop/src/main/mail-cache.ts` — local SQLite-backed mail metadata/body cache and search.
- `apps/desktop/src/main/message-html.ts` — sanitization and quoted-content detection for message HTML.
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
- `apps/desktop/src/renderer/App.tsx` — application-level orchestration only: account loading, current mailbox selection, dialog visibility, sync revision, and active bulk-operation state.
- `apps/desktop/src/renderer/styles.css` — global Tailwind styles and visual tokens.
- `apps/desktop/src/renderer/theme.tsx` — theme/font persistence, context, and message color schemes.
- `apps/desktop/src/renderer/lib/utils.ts` — small renderer-wide helpers such as class merging and range selection.
- `apps/desktop/src/renderer/components/ui/` — reusable low-level UI primitives.

## Renderer features

- `features/sidebar.tsx` — desktop/mobile navigation content, account folder trees, folder CRUD, drag-and-drop folder moves, sync status, and theme controls.
- `features/account-setup.tsx` — provider detection, password/app-password setup, and personal Microsoft device-code connection flow.
- `features/account-settings.tsx` — account rename/removal dialog.
- `features/compose-dialog.tsx` — new-message composer, recipient suggestions, attachments, validation, confirmation, and sending.
- `features/mail-search.tsx` — search form/results and selected-result reader.
- `features/message-list.tsx` — one account-folder conversation list, selection, and folder-scoped actions.
- `features/unified-inbox.tsx` — multi-account inbox aggregation, selection, and actions.
- `features/mail-common.tsx` — shared mail-list building blocks used by folder, unified, and search views: action controls, selection toolbar, and mail-view types/helpers.
- `features/message-move.tsx` — account-and-folder destination picker for single and bulk message moves.
- `features/conversation-reader.tsx` — conversation reader, message body/thread cards, received-attachment saving, quoted-content display, and inline reply composer.
- `features/attachment-picker.tsx` — reusable outgoing-attachment selection and removal UI for compose and reply.
- `features/draft-autosave.ts` — debounced, sequential IMAP autosave state shared by compose and inline reply.
- `features/bulk-operation.tsx` — persistent progress/status bar for background bulk message jobs.
- `features/app-shared.ts` — small cross-feature status and send-shortcut preferences/hooks.
- `features/form-field.tsx` — shared labeled form-field wrapper.

All paths in this section are relative to `apps/desktop/src/renderer/`.

## Tests

- Tests live beside their implementation as `*.test.ts` or `*.test.tsx`.
- `apps/desktop/src/main/` tests cover cache, HTML sanitization, provider discovery, folder subscriptions, folder input rules, message parsing helpers, message-action rules, draft-folder discovery, and bulk-job validation/progress.
- `apps/desktop/src/shared/` tests cover domain helpers and contracts.
- `apps/desktop/src/renderer/` tests cover renderer utilities and theming.
- Run the complete suite with `pnpm check` from the repository root.
