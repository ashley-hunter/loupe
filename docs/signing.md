# Code signing and notarisation

Releases are signed with an Apple Developer ID Application certificate and
notarised by Apple, so a downloaded `.dmg` opens with a double click rather
than the right-click-and-Open dance Gatekeeper demands of unsigned builds.

## What the release workflow needs

`.github/workflows/release.yml` decides how to sign from the secrets that are
present. All five of these must be set on the repository for a signed and
notarised build:

| Secret                        | What it is                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `MAC_CERTIFICATE_P12`         | The Developer ID Application identity - certificate, private key and Apple's intermediate and root - as a base64 `.p12`. |
| `MAC_CERTIFICATE_PASSWORD`    | The password that `.p12` was exported with.                                                                              |
| `APPLE_ID`                    | The Apple Account email the certificate was issued to.                                                                   |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password from account.apple.com, not the account password.                                               |
| `APPLE_TEAM_ID`               | `3A4A3D69L8`.                                                                                                            |

With only `MAC_CERTIFICATE_P12` set the build is signed but not notarised. With
neither, it falls back to ad-hoc signing, which runs but warns on first open.

## The certificate

Issued 14 September 2026, valid to 15 September 2031, against the Developer ID
G2 intermediate. Its identity is:

```
Developer ID Application: Ashley Hunter (3A4A3D69L8)
```

Certificates are managed at
[developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates).
An account may hold at most two Developer ID Application certificates at a
time, so revoke the old one before creating a replacement.

The private key is the part Apple cannot reissue. If it is lost the certificate
has to be revoked and a new one created; anything already notarised stays
valid, but nothing new can be signed with that identity.

## Rebuilding the .p12 from scratch

The `.p12` is just the certificate, its private key and Apple's chain in one
password-protected file. Given `developer_id.key` and the `.cer` downloaded
from Apple:

```sh
openssl x509 -inform DER -in developerID_application.cer -out leaf.pem
curl -o devidg2.der https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer
curl -o appleroot.der https://www.apple.com/appleca/AppleIncRootCertificate.cer
openssl x509 -inform DER -in devidg2.der -out devidg2.pem
openssl x509 -inform DER -in appleroot.der -out appleroot.pem
cat devidg2.pem appleroot.pem > chain.pem

openssl pkcs12 -export -legacy \
  -inkey developer_id.key -in leaf.pem -certfile chain.pem \
  -name "Developer ID Application: Ashley Hunter (3A4A3D69L8)" \
  -out developer_id.p12

base64 -w0 developer_id.p12   # the value for MAC_CERTIFICATE_P12
```

`-legacy` matters. OpenSSL 3 defaults to AES-256 for the key bag, which
macOS `security import` on the CI runner will not always read; the legacy
3DES encoding is what Keychain Access itself produces.

## Signing locally

Import the identity once:

```sh
security import developer_id.p12 -k ~/Library/Keychains/login.keychain-db \
  -T /usr/bin/codesign -T /usr/bin/security
security find-identity -v -p codesigning   # should list the Developer ID
```

Then, with `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` in the
environment:

```sh
npm run dmg:signed
```

Notarisation is a round trip to Apple and usually takes a few minutes. Verify
the result:

```sh
codesign -dv --verbose=4 release/mac-arm64/Loupe.app
spctl -a -vvv -t install release/mac-arm64/Loupe.app   # expect: accepted, Notarized Developer ID
xcrun stapler validate release/Loupe-<version>-arm64.dmg
```

## Entitlements

`build/entitlements.mac.plist` requests only what Electron's JIT needs. If a
future dependency ships a native module that fails to load under the hardened
runtime, `com.apple.security.cs.disable-library-validation` is the usual
addition - but add it only when something actually breaks, since it weakens
the runtime's guarantees.
