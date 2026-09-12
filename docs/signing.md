# Code signing

**Current state: intended but not yet configured.** No certificate secrets are
set, so every release is an unsigned build and each OS warns on first open.

The release workflow signs each platform when that platform's secrets exist, and
produces an unsigned build when they do not. Nothing needs changing in the
workflow to turn signing on - adding the secrets is enough.

**macOS auto-update does not work until this is done.** Squirrel.Mac checks the
signature on a downloaded build and refuses an unsigned one, so an unsigned mac
release can be installed by hand but never updates itself (ADR-0004). Windows
and Linux update regardless.

Certificates cannot be created here. Each one needs a paid account and an
identity check against a real person or company.

## macOS

Signing stops the "developer cannot be verified" warning. Notarising it — Apple
checking the signed build — stops Gatekeeper quarantining it on download, which
is what actually matters for anything shared beyond your own machine.

**What it costs:** Apple Developer Program, £79 / $99 a year.

**Getting the certificate**

1. Join the Apple Developer Program.
2. In the developer portal, create a **Developer ID Application** certificate —
   not "Mac App Distribution", which only works for the App Store.
3. Download it, open it, and in Keychain Access export it as `.p12` with a
   password.
4. Base64 the file, since a secret has to be text:
   ```
   base64 -i DeveloperID.p12 | pbcopy
   ```

**Secrets to add** (Settings → Secrets and variables → Actions)

| Secret                        | What it is                                                             |
| ----------------------------- | ---------------------------------------------------------------------- |
| `MAC_CERTIFICATE_P12`         | the base64 from above                                                  |
| `MAC_CERTIFICATE_PASSWORD`    | the password used at export                                            |
| `APPLE_ID`                    | the Apple ID that owns the membership                                  |
| `APPLE_APP_SPECIFIC_PASSWORD` | from appleid.apple.com → Sign-In and Security → App-Specific Passwords |
| `APPLE_TEAM_ID`               | the ten-character Team ID in the developer portal                      |

With only the first two, builds are signed but not notarised — the warning goes,
the quarantine does not. With all five, both go.

## Windows

Signing stops SmartScreen warning on every download. Reputation still has to
build up: a brand-new certificate warns for a while regardless, unless it is EV.

**What it costs:** roughly $200–600 a year from a certificate authority, or
about $10 a month for Azure Trusted Signing.

Note that since June 2023, OV certificates must live on a hardware token or
cloud HSM. A `.pfx` file in a secret is therefore only possible with an older
certificate or a cloud-signing service. **Azure Trusted Signing is the practical
route today**, and needs a different workflow step from the one here.

**Secrets to add**, if you do have an exportable `.pfx`

| Secret                         | What it is               |
| ------------------------------ | ------------------------ |
| `WINDOWS_CERTIFICATE_PFX`      | the base64 of the `.pfx` |
| `WINDOWS_CERTIFICATE_PASSWORD` | its password             |

## Linux

Nothing to do. AppImage and deb files downloaded directly are not signed by
convention; signing matters when publishing into an apt repository, which this
does not.

## Checking it worked

```
# macOS: the signature, then whether Gatekeeper accepts it
codesign --verify --deep --strict --verbose=2 "Loupe.app"
spctl --assess --type execute --verbose "Loupe.app"

# Windows
signtool verify /pa /v "Loupe Setup.exe"
```

An unsigned macOS build fails `spctl` with "rejected". That is expected, and is
the thing signing fixes.
