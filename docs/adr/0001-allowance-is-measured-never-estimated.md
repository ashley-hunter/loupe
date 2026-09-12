# Allowance is measured, never estimated

Transcripts record tokens and cache in detail but contain no rate-limit information,
so the Allowance shown throughout the app has to come from somewhere else. We poll
Anthropic's usage endpoint using the OAuth credentials Claude Code already stores in
the login keychain, and a Session's Allowance is the measured rise in that figure
between its first and last Event. Sessions that ended before this app was installed
show blank rather than a reconstruction.

## Considered options

- **Token-weighted estimate.** Reconstructs history for all 585 existing Sessions and
  fills the trend charts on day one, but the weights are unvalidated and there is no
  ground truth to ever check them against.
- **Local proxy on `ANTHROPIC_BASE_URL`.** Captures the real rate-limit response
  headers, but puts our code in the path of every Claude Code call, has to handle SSE
  streaming correctly, and takes the user's actual work down when it breaks.
- **Apportion a Block's rise between concurrent Sessions by token share.** Makes the
  columns sum correctly, at the cost of making every per-session figure derived.

## Consequences

The Allowance column is blank for historical Sessions, and the Analytics trends start
empty and fill in over the first two weeks. This is deliberate and should not be
"fixed" by backfilling an estimate.

When Sessions overlap, each reports the same shared rise and is marked as Shared.
Those figures are correct individually and must never be summed — any total across
Sessions has to fall back to Block-level figures.

The endpoint is `GET https://api.anthropic.com/api/oauth/usage`, authorised with the
`claudeAiOauth.accessToken` from the `Claude Code-credentials` keychain entry. It needs
no organisation id. The `claude.ai/api/organizations/{org}/usage` endpoint that other
usage tools use is behind a Cloudflare challenge and returns 403 to a plain client.

The token is re-read from the keychain on every poll rather than cached, so Claude
Code's own refresh is picked up for free and this app never holds a refresh token.

It returns three limits, not one: the five-hour Block, a seven-day account limit, and
a seven-day per-model limit. The design only anticipated the first.

The endpoint rate-limits. Polling every 60s while relaunching the app repeatedly earned
a 429, so polling runs every five minutes, backs off on 429 up to thirty, and skips its
opening poll when a recent reading is already on disk. Five minutes is well inside the
ten-minute window a Session's span is matched against, so the spacing costs no
resolution.

When the endpoint cannot be reached the most recent recorded reading is shown with its
age. That is still Measured — a real reading with a real timestamp — unlike an
interpolation, which is still forbidden.

The endpoint is internal and undocumented. It will break without notice, and Allowance
must degrade to the last reading, or to blank, rather than to a guess.

Block boundaries also come from that endpoint's reset timestamp. The `apiBlockIndex`
field in Transcripts is the index of a content block within a message and has nothing
to do with the five-hour window, despite the name.
