# Building Emzero from source

Building yourself is useful in two situations: you want to run only code you can
inspect, or your distribution has no Emzero package yet. Arch Linux is the common
case for the second, since Electron Forge has no pacman maker.

## Requirements

- Node.js 24 (the version in [`.nvmrc`](../.nvmrc))
- pnpm 11.22, most easily via `corepack enable`
- On Linux, a keyring service such as `gnome-keyring` or `kwallet`

The keyring is not a build requirement, but Emzero refuses to store account
credentials when the operating system offers no secure backend, so the
application is not usable without one.

## Build a runnable application

```sh
git clone https://github.com/nick-friedrich/emzero.git
cd emzero
corepack enable
pnpm install
pnpm --filter @emzero/desktop exec electron-forge package
```

This writes an unpacked application to `apps/desktop/out/`, in a directory named
for your platform and architecture, such as `Emzero-linux-x64`. Start it by
running the `emzero` binary inside that directory.

Nothing is installed system-wide. To get a menu entry, copy the binary somewhere
on your `PATH` and write a `.desktop` file pointing at it.

## Build installable packages

```sh
pnpm --filter @emzero/desktop make
```

This produces the same artifacts the release workflow publishes, and it needs the
matching system tools:

| Package | Requires |
| --- | --- |
| `.deb` | `dpkg` and `fakeroot` |
| `.rpm` | `rpmbuild` |
| macOS `.zip` | macOS |

There is no pacman maker, so this command cannot produce an Arch package. On
Arch, use the packaged output above.

Cross-building macOS architectures works from any Mac:

```sh
pnpm --filter @emzero/desktop exec electron-forge make --arch=x64
```

Builds produced this way are unsigned. Only the release workflow signs and
notarizes macOS builds, using credentials that are not in this repository.

## Verify a published build instead

If you would rather check an official build than compile one, every release asset
has a SHA-256 digest recorded by GitHub:

```sh
gh release view v0.1.1 --repo nick-friedrich/emzero --json assets \
  --jq '.assets[] | "\(.digest)  \(.name)"'
```

Compare that against the file you downloaded:

```sh
shasum -a 256 Emzero-darwin-arm64-0.1.1.zip
```

On macOS you can also confirm the signature and Apple's notarization:

```sh
spctl -a -vvv -t exec /Applications/Emzero.app
```

That should report `accepted` and `source=Notarized Developer ID`.

## Running the checks

```sh
pnpm check
```

This runs linting, type checks, unit tests, and packaged Electron smoke tests —
the same checks CI runs on every pull request.
