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
