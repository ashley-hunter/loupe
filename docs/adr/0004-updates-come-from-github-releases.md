# 4. Updates come from GitHub releases

## Status

Accepted.

## Context

The app ships as a dmg, an exe and an AppImage from a GitHub release. Without
an updater, every user stays on whatever version they happened to download, and
the only way to tell them otherwise is to hope they look.

Three options were on the table:

1. **Nothing.** Users re-download. Honest, and free, but in practice it means
   nobody upgrades.
2. **An update server.** `electron-updater` supports a generic HTTP provider,
   Keygen, S3 and others. It gives full control over staged rollouts and
   channels, and costs a service to run and pay for.
3. **GitHub releases as the feed.** `electron-updater`'s `github` provider reads
   the release assets that the release workflow already produces.

The app has no backend of any kind. Everything it knows it reads from disk or
from Anthropic's own endpoint, and adding a server for updates alone would make
this the only piece of infrastructure in the project.

## Decision

Follow GitHub releases, using `electron-updater` with the `github` provider.

- A check on launch, delayed fifteen seconds so it does not compete with the
  Transcript parse, and every six hours after that.
- Downloads happen automatically; installing does not. A downloaded version is
  applied on the next launch, or immediately from Settings.
- The release workflow uploads `latest*.yml`, the `.blockmap` files and a mac
  `.zip` alongside the installers. The yml is the feed, the blockmap is what
  makes a delta download possible, and `electron-updater` installs a macOS
  update by swapping the `.app` out of a zip rather than mounting the dmg.
- Nothing runs in development: an unpackaged build has no version to compare and
  no signature to validate, and the updater throws rather than no-ops.

## Consequences

**macOS auto-update requires code signing.** Squirrel.Mac validates the
signature of the downloaded build and refuses an unsigned one. This is why
signing moved from optional to intended (`docs/signing.md`); until the
certificate secrets exist, macOS users see the check fail in Settings and have
to download manually. Windows and Linux update unsigned.

**A release cannot be deleted once people have it.** The feed is the release
list, so pulling a bad version means publishing a newer one, not removing the
old one.

**Update checks cost no tokens and no Allowance**, consistent with ADR-0002.
They are requests to GitHub, not to a model.

**Linux packages installed by a distribution are not updated here.** The deb is
not self-updating; only the AppImage is. That is a property of the format, not a
choice made here.
