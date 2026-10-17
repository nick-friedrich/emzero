# Emzero code map

This index records where application responsibilities live. Read it before making changes, and update it whenever files or ownership change.

## Repository entry points

- `LICENSE` — MIT license for the project; third-party notices retain their own terms.
- `.github/workflows/checks.yml` — full-history secret scanning, Linux/macOS desktop checks and packaging, and website CI.
- `.gitleaks.toml` — standard secret-detection rules with one narrowly scoped documentation placeholder exception.

- `README.md` — local development requirements and commands.
- `plan.md` — current product scope and delivery plan.
- `package.json` — workspace commands; `pnpm check` runs lint, type checking, and tests.
- `apps/desktop/package.json` — Electron application dependencies and package-level scripts.
- `apps/desktop/forge.config.ts` — platform packaging, including the MIT license and runtime branding assets in packaged resources.
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
- `apps/desktop/assets/` — renderer and native package branding assets. `emzero-logo-macos.png` supplies the development-only Dock icon and the macOS `.icns` fallback: 824-pixel artwork centered on a transparent 1024-pixel canvas. The Linux PNG and 192-pixel header WebP use the unpadded artwork.
- `media/` — source Icon Composer project and exported logo used to generate the desktop branding assets. Packaging compiles `media/icon_composer.icon` into the macOS bundle's `Assets.car` for the macOS 26 dark, clear, and tinted icon appearances, which requires packaging on macOS 26 with Xcode 26+.
- `apps/desktop/src/main/accounts.ts` — trusted IPC validation and handler registration; delegates privileged work to focused main-process services.
- `apps/desktop/src/main/account-storage.ts` — persisted, user-ordered account records (including sanitized send-as aliases), keyring-backed secret encryption, the account-list change hook background sync uses to restart push connections, and conversion to renderer-safe account summaries.
- `apps/desktop/src/main/signature-storage.ts` — mail signatures persisted in the user data directory, validated and reduced to signature fields on every read and write.
- `apps/desktop/src/main/ai-assistant.ts` — encrypted OpenAI-compatible provider settings and prompt-driven reply, new-message, and saved-draft generation.
- `apps/desktop/src/main/ai-stream.ts` — incremental OpenAI-compatible SSE parsing for streamed AI draft generation.
- `apps/desktop/src/main/mail-insights.ts` — smart-inbox settings storage and IPC, plus the background classifier that sends new Inbox mail previews to TypeSafe Jev through OpenRouter's Decisions API and stores tags and rule scores in the mail cache.
- `apps/desktop/src/main/account-backup.ts` — backward-compatible password-encrypted backup export/import for accounts, optional app settings and signatures, destination-machine credential re-wrapping, and signature account-ID remapping.
- `apps/desktop/src/main/account-connection.ts` — IMAP/SMTP account connectivity verification.
- `apps/desktop/src/main/account-connection-update.ts` — validated, connection-verified changes to an existing password account's username, password, and IMAP/SMTP servers.
- `apps/desktop/src/main/microsoft-oauth.ts` — personal Microsoft device-code authorization, token exchange, and refresh-token renewal.
- `apps/desktop/src/main/account-folders.ts` — cached/server folder listing, validation, creation, rename, move, deletion, and ordering.
- `apps/desktop/src/main/background-sync.ts` — foreground-safe scheduled, on-demand, and push-triggered Inbox/Sent synchronization state and execution, with per-account serialized Inbox syncs.
- `apps/desktop/src/main/inbox-watch.ts` — one dedicated IMAP IDLE connection per account on the Inbox, reconnect backoff, and account-change reconciliation, reporting new-mail pushes to background sync.
- `apps/desktop/src/main/mail-notifications.ts` — new-mail detection, notification preference state, native desktop alerts, and notification activation behavior.
- `apps/desktop/src/main/mail-runtime.ts` — shared mail-cache lifecycle, credential caching and per-account invalidation, safe error formatting, and sleep-safe isolated interactive/background per-account IMAP connections.
- `apps/desktop/src/main/message-reader.ts` — incremental folder-message synchronization (reopening an already-selected folder so UIDNEXT/HIGHESTMODSEQ are current) with periodic full reconciliation, message parsing, and cached/server message reading.
- `apps/desktop/src/main/message-sender.ts` — up-front send-draft validation, SMTP delivery from the account or a chosen alias, IMAP Sent-copy persistence, and sent-message cache updates.
- `apps/desktop/src/main/outgoing-mail.ts` — background send queue: send IPC returns once a draft is queued; delivery then deletes the handed-over autosaved draft, or rewrites it into Drafts on failure and keeps the job for Retry; status broadcast to every window, and quitting waits for in-flight sends.
- `apps/desktop/src/main/mail-drafts.ts` — MIME draft compilation plus append-first IMAP draft autosave and deletion.
- `apps/desktop/src/main/attachment-files.ts` — native file selection, byte-backed registration of files dropped or pasted into a composer, opaque outgoing-file authorization, attachment limits, retained-draft attachment authorization, and received-attachment saving.
- `apps/desktop/src/main/server-search.ts` — on-demand IMAP TEXT search scoped by account, folder, or special use (All Mail/Trash/Spam on Gmail-style servers), caching found summaries for later local search.
- `apps/desktop/src/main/message-actions.ts` — read/unread, star/unstar, delete, same-account move, and cross-account message-transfer operations.
- `apps/desktop/src/main/bulk-message-jobs.ts` — bulk-action request validation, execution, cancellation, and progress publication.
- `apps/desktop/src/main/mail-cache.ts` — local SQLite-backed mail metadata/body cache, bounded plain-text list previews from cached bodies, search (filterable by folder special use), server-search result storage, a per-folder guard that keeps syncs already in flight from re-adding locally deleted or moved UIDs, and AI insight/smart-inbox score storage joined onto listed messages.
- `apps/desktop/src/main/message-html.ts` — sanitization and quoted-content detection for message HTML.
- `apps/desktop/src/main/outgoing-html.ts` — safe outgoing rich-text HTML (keeping only the `id="Signature"` marker) and pasted-image size validation before MIME compilation.
- `apps/desktop/src/main/demo-profile.ts` — the `--demo` / `EMZERO_DEMO=1` switch to the separate demo profile, the real profile path that still owns AI settings, and restarting into or out of demo mode.
- `apps/desktop/src/main/demo-mail.ts` — the demo mail server: in demo mode, mail services apply their IMAP/SMTP effects (store, move, delete, folder changes, drafts, sending with local delivery, attachment contents) straight to the mail cache. Each service checks `demoModeEnabled()` at its network boundary and delegates here.
- `apps/desktop/src/main/demo-dataset.ts` — the privacy-safe sample accounts, folders, threads, smart inboxes, insights, and signatures seeded fresh on every demo start.
- `apps/desktop/src/main/window-visibility.ts` — the macOS-only `EMZERO_HIDDEN_WINDOWS=1` test mode: every window stays hidden (unthrottled), and the macOS Dock icon is hidden.
- `apps/desktop/src/main/context-menu.ts` — native right-click menu for every window: copy image (including images inside sandboxed HTML email), copy image/link address, and text copy/cut/paste/select all.
- `apps/desktop/src/main/pdf-export.ts` — save-dialog PDF export: renders a renderer-built printable document in a hidden, script-disabled window and writes `printToPDF` output.
- `apps/desktop/src/main/mail-windows.ts` — validated creation of standalone message, composer, and single-instance settings windows.
- `apps/desktop/src/main/provider-discovery.ts` — provider catalog lookup and domain/MX discovery.
- `apps/desktop/src/main/folder-subscriptions.ts` — IMAP folder subscription and deletion helpers.
- `apps/desktop/src/preload/index.ts` — typed `window.emzero` bridge exposed to the sandboxed renderer.
- `apps/desktop/src/providers/catalog.json` — known mail-provider connection settings.

## Shared contracts and domain logic

- `apps/desktop/src/shared/accounts.ts` — IPC contracts, account/folder/message types, account color palette and default assignment, folder-tree operations, bulk-job types, and account validation.
- `apps/desktop/src/shared/ai.ts` — AI provider/draft IPC contracts, defaults, and renderer-to-main input validation.
- `apps/desktop/src/shared/mail-insights.ts` — every Jev question and threshold, tag derivation, smart-inbox templates, membership rules, settings validation, and IPC contract.
- `apps/desktop/src/shared/appearance.ts` — theme and interface-font identifiers shared by the renderer theme provider and backup validation.
- `apps/desktop/src/shared/aliases.ts` — account send-as aliases: validation, the account's own-address set, resolving a draft's From identity, and picking the alias a reply or draft should keep sending as.
- `apps/desktop/src/shared/signatures.ts` — signature IPC contract, size limits, and the validation shared by main-process storage, backups, and the renderer.
- `apps/desktop/src/shared/conversations.ts` — conversation grouping and quoted-text splitting.
- `apps/desktop/src/shared/replies.ts` — reply and reply-all construction, address parsing, and outgoing-draft validation.
- `apps/desktop/src/shared/message-keywords.ts` — Emzero-private IMAP importance and due-date keyword encoding, parsing, and capability rules.

Shared modules must remain usable by both Electron and renderer code; do not import renderer components or browser-only state into them.

## Renderer shell

- `apps/desktop/src/renderer/main.tsx` — React renderer entry point and providers.
- `apps/desktop/src/renderer/mail-window.tsx` — standalone composer and conversation window loading and actions.
- `apps/desktop/src/renderer/App.tsx` — application-level orchestration only: account loading and cross-window refresh, current mailbox selection and dedicated new-message navigation, persisted sidebar/mail-layout preferences, dialog visibility, sync revision, and active bulk-operation state.
- `apps/desktop/src/renderer/styles.css` — global Tailwind styles and visual tokens.
- `apps/desktop/src/renderer/theme.tsx` — synchronized appearance and mail-behavior preference persistence/context, plus message color schemes.
- `apps/desktop/src/renderer/lib/utils.ts` — small renderer-wide helpers such as class merging and range selection.
- `apps/desktop/src/renderer/components/ui/` — reusable low-level UI primitives.

## Renderer features

- `features/sidebar.tsx` — desktop/mobile navigation: scrollable mailbox/account navigation, drag-to-reorder accounts, folder CRUD state, and drag-and-drop folder moves.
- `features/sidebar-chrome.tsx` — sidebar brand header (demo badge, five-click demo toggle, pin toggle) and action footer with sync status.
- `features/folder-dialogs.tsx` — create/rename folder dialog and delete-folder confirmation used by the sidebar.
- `features/account-setup.tsx` — provider detection, password/app-password setup, personal Microsoft device-code connection flow, and the shared IMAP/SMTP server fields.
- `features/account-connection-editor.tsx` — per-account username, password, and server editor shown in the Accounts settings tab.
- `features/account-settings.tsx` — standalone tabbed settings window for general mail behavior and demo mode, account names/colors/connection details/aliases, signatures, and encrypted backup/restore.
- `features/account-aliases.tsx` — per-account alias editor shown in the Accounts settings tab.
- `features/appearance-switcher.tsx` — global keyboard shortcut and accessible quick theme/font picker, shared by all renderer windows; owns the settings shortcut label.
- `features/signatures.ts` — main-process-backed signature cache and cross-window refresh, the one-time migration off origin-scoped browser storage, account-to-signature assignments, and the plain-text signature form with the RFC 3676 "-- " delimiter.
- `features/signature-html.ts` — the Outlook-style `<div id="Signature">` block in the editor and HTML part (no visible divider), and the delimited plain-text part derived from it.
- `features/signature-html.test.ts` — renderer tests for signature markup and the delimited plain-text part.
- `features/signature-picker.tsx` — compact compose-time signature selection for the composer action bar.
- `features/compose-dialog.tsx` — dedicated new-message page, expanding inline reply/draft editor, and standalone composer: header rows (including the account-and-alias From picker), action bar, scroll-into-view and focus on open, drag-and-drop attachments, draft autosave, validation, and queueing messages for background sending (closing immediately).
- `features/outgoing-mail-status.tsx` — main-window status cards for background sends (sending, sent, failed with Retry/Dismiss), refreshing mail when a send finishes.
- `features/compose-confirmations.tsx` — send, delete-draft, and keep-draft confirmation dialogs used by the composer.
- `features/recipient-input.tsx` — chip-based To/Cc/Bcc rows with recipient suggestions over a plain comma-separated value.
- `features/rich-text-editor.tsx` — borderless message editor with a portaled formatting toolbar (active states, links, quotes, lists, clear formatting), Markdown-style line shortcuts, plain-text paste, and clipboard image insertion, with a plain-text copy for AI drafting and multipart email.
- `features/clipboard-html.ts` — plain-text-to-editor HTML escaping, pasted-HTML rebuilding that interprets inline styles (so Google Docs pastes are not all bold) and link-target normalization.
- `features/clipboard-html.test.ts` — renderer tests for pasted-style interpretation and link normalization.
- `features/ai-draft-assistant.tsx` — the AI-configured hook and reusable, dismissible prompt panel for AI drafting in reply, new-message, and saved-draft composers.
- `features/smart-inboxes.tsx` — smart-inbox sidebar section and create/edit dialog, AI tag chips, the remove-sender row action, the settings toggle, and the shared settings hook.
- `features/mail-search.tsx` — search form with account/folder scope, cached results, the on-demand server search that merges in uncached matches, and the selected-result reader.
- `features/message-list.tsx` — one account-folder conversation list (loading messages and folders in parallel, keeping the list visible during refresh), selection, row right-click actions, and folder-scoped actions.
- `features/conversation-row.tsx` — the conversation row shared by folder and unified lists (row facts, starred highlight, unread bar, metadata) and the rounded section cards with collapsible Starred/Unread/Everything else headers and date sub-headings.
- `features/conversation-row.test.ts` — renderer tests for date buckets and inbox-group ordering.
- `features/list-selection.ts` — multi-select state and keyboard handling shared by folder and unified lists (checkbox and modifier clicks, Escape, select all, Delete, arrow navigation) plus the Ctrl+Q read toggle.
- `features/conversation-patches.ts` — optimistic read/star/importance/color patches for one conversation and the patches that revert them.
- `features/conversation-patches.test.ts` — renderer tests for optimistic patches and their reverts.
- `features/unified-inbox.tsx` — multi-account Inbox, Starred, Trash, and smart-inbox view: shows each account as it finishes loading, account filtering, selection, row right-click actions, and actions.
- `features/unified-inbox-data.ts` — per-account unified mailbox loading (including hiding skip-Inbox matches), combining results into list state, and saved/deleted draft state updates.
- `features/unified-account-bar.tsx` — unified-inbox account filter chips and per-account failure/notice banners.
- `features/account-colors.tsx` — account color palette classes, the hover-labelled account dot shown on unified-inbox avatars, and the settings color picker.
- `features/conversation-actions.tsx` — per-conversation inline read/delete buttons and the conversation-actions modal (opened from the "More" button or by right-clicking a list row) with star, important/due date, color, archive, move, and delete, plus their follow-up dialogs.
- `features/mail-common.tsx` — shared mail-list building blocks used by folder, unified, and search views: selection toolbar, replied-last detection and badge, and mail-view types/helpers.
- `features/inbox-view-options.tsx` — persisted icon filters, Starred/Unread inbox grouping and ordering, and persisted collapsed sections shared by account and unified inboxes.
- `features/mail-view-menu.tsx` — accessible dismissible popover for secondary mailbox layout and filter controls, shared by account, unified, and search headers.
- `features/mail-split-layout.tsx` — persisted, pointer- and keyboard-resizable list/reader layout shared by three-column mail views, and the empty reader placeholder.
- `features/reader-selection.ts` — decides which conversation the reader keeps after a delete or move, so unopened rows are never opened (and auto-marked read) behind the user.
- `features/reader-selection.test.ts` — renderer tests for post-delete reader selection.
- `features/mail-common.test.ts` — renderer tests for isolated HTML-email document generation, remote-image privacy controls, and replied-conversation detection.
- `features/message-move.tsx` — account-and-folder destination picker for single and bulk message moves.
- `features/conversation-reader.tsx` — conversation reader, message body/thread cards, Copy conversation / Save as PDF actions, received-attachment saving, quoted-content display, and reply entry points.
- `features/linkified-text.tsx` — http(s)/`www.` URL detection in plain-text message bodies, rendered as links that go through the reader's open-link confirmation.
- `features/linkified-text.test.ts` — renderer tests for plain-text URL detection and trailing-punctuation trimming.
- `features/message-html-frame.tsx` — isolated HTML-email frame that reports content height for a single reader scrollbar, validates frame messages, and owns the CSP-authorized resize/link relay.
- `features/conversation-pdf.ts` — printable, script-free HTML document of a conversation (headers, bodies, attachment names) handed to the main process for PDF export.
- `features/conversation-pdf.test.ts` — renderer tests for PDF document escaping, quoted-history handling, and image policy.
- `features/conversation-copy.ts` — plain-text formatting for copying every message in a conversation to the clipboard.
- `features/reply-composer.tsx` — Reply / Reply all entry and inline editor beneath a message, preserving reply headers, draft autosave, and conversation context for AI drafting.
- `features/message-prefetch.ts` — bounded idle, hover, and keyboard-focus message-body prefetching shared by folder, unified, and search lists.
- `features/attachment-picker.tsx` — outgoing-attachment chips, the attach button, limit-aware merging, and dropped/pasted file authorization for compose and reply.
- `features/draft-autosave.ts` — debounced, sequential IMAP autosave shared by compose and reply, including pending-edit flushing on editor unmount and handing the saved draft to the send queue.
- `features/bulk-operation.tsx` — persistent progress/status bar for background bulk message jobs.
- `features/undoable-delete.tsx` — shared delayed-action controller and Undo bar for optimistic conversation deletion, archiving, and moves, including the hidden-row keys lists filter out of reloads until the action settles.
- `features/app-shared.ts` — small cross-feature status and send-shortcut preferences/hooks.
- `features/form-field.tsx` — shared labeled form-field wrapper.

All paths in this section are relative to `apps/desktop/src/renderer/`.

## Tests

- Tests live beside their implementation as `*.test.ts` or `*.test.tsx`.
- `apps/desktop/src/main/` tests cover cache, PDF export file naming/validation, HTML sanitization, provider discovery, folder subscriptions, folder input rules, message parsing helpers, message-action rules, server-search folder scoping, draft-folder discovery, signature storage, and bulk-job validation/progress.
- `apps/desktop/src/shared/` tests cover domain helpers and contracts.
- `apps/desktop/src/renderer/` tests cover renderer utilities and theming.
- `apps/desktop/e2e/` — Playwright runs with hidden windows by default (set `EMZERO_E2E_SHOW_WINDOWS=1` to watch them). It contains smoke coverage for production Electron builds launched with `--demo`, plus isolated mock-mail regression coverage for reply preservation, dedicated composition, automatic HTML-email sizing with privacy/link controls, and copying embedded images and saving a conversation as PDF (`mail-export.spec.ts`).
- `apps/desktop/playwright.config.ts` — production Electron smoke-test configuration.
- Run the complete suite with `pnpm check` from the repository root.
