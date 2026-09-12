# Build plan

Terms used here are defined in [CONTEXT.md](./CONTEXT.md). Decisions are recorded in
[docs/adr](./docs/adr).

## What the data supports

Measured against the Transcripts on this machine, not assumed. The 585 `.jsonl`
files are **24 Sessions and 561 Subagent Transcripts**, not 585 Sessions:

| Question                  | Answer                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| Cold parse of 1.68 GB     | 3.5s single-threaded → no database ([ADR-0003](./docs/adr/0003-no-database.md))                         |
| Usage records per Request | repeated per content block → dedupe by `requestId`, last wins                                           |
| Tool calls per Request    | exactly 1 in 92.7%, 2+ in 4.3% → per-event costs mostly attributable                                    |
| Allowance in Transcripts  | Absent → polled, never estimated ([ADR-0001](./docs/adr/0001-allowance-is-measured-never-estimated.md)) |
| Per-Event cost computable | 98.5% of Request transitions; the rest report blank                                                     |
| Invalidations detectable  | Yes, reliably                                                                                           |
| Invalidation _causes_     | 56% re-anchored, 34% Expiry, 9% Compaction, 1% model change, 0.3% undetermined                          |
| Subagent Transcripts      | 557 with a `.meta.json` giving type, task and parent `toolUseId`                                        |
| Usage endpoint limits     | rate-limits on frequent polling → 5-minute interval with backoff                                        |
| Thinking text on disk     | present on 1.9% of 43,485 blocks → THINK rows show tokens, not prose                                    |
| Summing `cacheRead`       | counts the same prefix once per Request → excluded from every total                                     |
| First-to-last timestamp   | spans days on resumed Sessions → Active and Span are separate                                           |

## Changes the findings force on the design

The mock is a proposal; these are the places reality disagrees with it.

- **Allowance column is blank for every existing Session.** Not a bug, and not to be
  backfilled with an estimate. Trends start empty and fill over the first two weeks.
- **Overlapping Sessions report the same Shared figure.** The column needs a marker
  for it, and any total across Sessions must fall back to Block-level numbers.
- **The Cache screen splits in three.** An Avoidable table with causes and costs, plus
  two aggregates: idle Expiry, and prefixes re-anchored as the context grew. The latter
  is the largest single cost on this machine — 57.5M tokens rewritten — and is not
  something done wrong, so listing it as a Finding would be misleading.
- **"Likely cause" is often no cause.** Roughly a quarter of Avoidable Invalidations
  are Undetermined. They stay visible with their cost and an empty cause.
- **Insights has no "explain" button.** Findings are fixed sentences with Measured
  numbers slotted in ([ADR-0002](./docs/adr/0002-the-app-never-calls-a-model.md)).
- **A Request with several tool calls costs them as a group.** 4.3% of Requests carry
  more than one tool call, and their shared prefix growth cannot be split between
  them. Those Events show a grouped cost rather than an invented per-Event split.
- **THINK rows have no prose.** Claude Code keeps the signature and strips the text on
  98% of thinking blocks, so the row reports its thinking tokens instead of a summary.
- **There is no "Tokens" total.** Every Request re-reads the whole prefix, so adding
  `cacheRead` across a Session counts the same tokens once per Request — 21M for a
  single 172-Request Session. The column is New tokens; cache reads are shown apart.
- **"Duration" splits into Active and Span.** Resumed Sessions span days of wall clock.
  Active sums the gaps between Events, excluding any longer than five minutes.

## Shape

Electron, TypeScript, React, Vite. The main process owns the filesystem and the
poller; the renderer is the design and receives only small JSON over IPC. The design
is already a `state` / `setState` / `render()` class, so it ports to React verbatim.
Types exist to keep the domain model honest — `SessionId` and `RequestId` are not
interchangeable, and `Usage` is only ever built from a Request's last record.

```
src/main/     index.ts     window, IPC
              catalogue.ts    scan, parse, index cache
              usage.ts     poller                      (v2)
              detectors.ts one function per pattern    (v3)
src/shared/   model.ts     the domain types
src/renderer/ app.tsx      the ported design
```

Renderer primitives come from Base UI — headless, so the design's styling survives
intact. Icons are Lucide via `lucide-react`, which is what the design itself draws:
its `folder` path matches lucide-react's exactly. Render them at the design's own
`size: 15, strokeWidth: 1.7` (exported as `ICON`), never as Unicode glyphs, which
render differently on every machine and cannot take a stroke weight. Note that it marks state with `aria-selected` / `aria-disabled`, not
`data-selected` or `:disabled`.

The design's tokens live in `app.css` and are copied from the design file verbatim,
including `--panel`, `--codeBg`, `--track` and `--lineSoft`. Public Sans and JetBrains
Mono are bundled via `@fontsource` rather than fetched, so the app works offline and
needs no network CSP. Lists are CSS grids at the design's own column widths and 44px
row height, not HTML tables.

Tests are Vitest against fixture Transcripts. For UI checks, `SHOT_OUT=x.png npm start`
renders the window to a PNG and exits — `screencapture` returns black once the display
sleeps, which makes it useless from a long session.

## Phases

**v1 — Sessions + Detail timeline. Built.** The parser, the index and its mtime cache,
the Sessions list, the Timeline with Measured per-Event costs, and the inspector pane.
Cold index 1.5s, warm 3ms; a 2,437-Event Session opens in under 300ms. 13 Vitest cases
cover the traps above.

**v2 — Cache and Allowance. Built.** The poller reads `api.anthropic.com/api/oauth/usage`
with the OAuth token from the login keychain — no org uuid needed, and the `claude.ai`
endpoint the reference tool used is Cloudflare-blocked. It returns three limits, not
one: the five-hour Block, a seven-day account limit, and a seven-day per-model limit.
Samples append to `~/.claude/.ledger-usage.jsonl`, which is the app's only Allowance
history. The Invalidation detector and the split Cache screen ship with it.

**v3 — The rest of the Detail screen. Built.** Cache, Files, Tools and Subagents.
Subagents reads the 557 `agent-*.jsonl` Transcripts and their `.meta.json` siblings,
which carry the agent type, its task, and the `toolUseId` of the Task call that spawned
it — so a Subagent links back to its place in the parent's Timeline. Its tokens are
reported separately from the parent's, because they were spent in another context
window and are not part of the parent's total.

**v4 — Insights. Built.** Three Detectors, chosen by measuring which patterns actually
occur rather than by inventing rules: re-anchored prefixes (4 sessions, 56.8M), duplicate
full reads (6 sessions, 180k) and mid-session model changes (2 sessions, 395k). 12
Findings, 57.4M recoverable. Repeated bash commands were measured too and dropped — 23
occurrences worth 0.05M is not worth a rule.

Findings of one kind share their explanation word for word, so the screen shows it once
per group with a row per Session. Four cards repeating the same paragraph was both ugly
and a misrepresentation: that is one pattern across four Sessions, not four findings.

**v5 — Settings and packaging. Built.** Settings carries only what genuinely varies:
theme, the collapse-output threshold, the transcript directory, and the Allowance poll
interval. The design's estimation method, retention period and confidence bands are
gone, because none of them exist any more. Both adjustable settings are wired through
to real behaviour — a control that cannot do anything is worse than an absent one.

`npm run dmg` produces `Loupe.app` and a 129 MB arm64 dmg via electron-builder,
with an icon built from the design's mark. It is deliberately unsigned: this is a
personal tool, and signing needs an Apple Developer certificate. macOS warns once on
first open; right-click → Open clears it for good.

**v6 — Projects and Analytics. Built.** Both are rollups over the same parse; the
Cache report, Findings and Projects now share one memoised pass rather than doing three.

Charts follow the visualization guidance: every series is a single magnitude, so one
hue and no legend; identity comes from direct labels. Days with no Sessions are drawn
as gaps, never zero-height bars — a quiet day and a day away are different facts. Cache
hit is a line with a stated range rather than bars, because bars must start at zero and
a rate that only moves between 91% and 100% makes every bar look full. Model shades are
keyed to the model family in a fixed order, never to rank, so re-sorting cannot repaint
them.

**v7 — Live. Built.** `fs.watch` on the Transcript root, settled for 600ms so one turn
does not trigger a dozen reads, then a full re-parse of whichever Transcript was written
to most recently. Costing an Event needs the Request _after_ it, so an incremental tail
would have to carry partial state across reads for a number only knowable once more has
arrived; a re-parse reuses the tested path instead. The ceiling is noted in `live.ts`.

**v8 — Search. Built.** A case-insensitive substring scan over every Event in every
Transcript, filterable by kind, with the matched span marked in each row. Cold 3.7s
(the parse), warm 30ms. ⌘F opens it from anywhere.

Event bodies are deliberately absent from the shared index: holding every Session's
tool output at once measured 1.78 GB resident, against 736 MB without. Search therefore
matches titles and paths — file paths, commands, prompt and reply openings — but not
tool output. The Inspector still shows bodies, one Session at a time. The remaining
736 MB is a known ceiling with its upgrade path recorded in `catalogue.ts`.

**v9 — The command palette.**

## Open, deliberately

- ~~Whether re-anchoring is worth a Finding.~~ Resolved: yes. It is concentrated in a
  handful of Sessions rather than spread thinly, so naming the Session that did it 60
  times for 40.4M is specific advice, not a platitude.
- ~~What the Undetermined Invalidations are.~~ Resolved: most were Compaction being
  misreported as waste — the context had shrunk from ~1M to ~54k, which is the cache
  working. The rest were re-anchoring narrowly missing the old thresholds. Undetermined
  fell from 18% to a single case, and Avoidable from 36 to 2.
- ~~Whether five minutes is the right idle threshold.~~ Resolved: yes. The long Sessions
  work out at 4-10 active hours per day across Sessions resumed over days, which is
  realistic.

- Whether Expiry is worth its own Finding ("use the 1h cache") or stays an aggregate.
  Needs real Allowance data to say what it costs, so it waits for v2.
- What the 27% Undetermined Invalidations actually are. Worth a look once v1 makes
  individual Sessions inspectable.

**v9 — More detectors, Recommendations, and live Alerts. Built.**

Four Detectors added after measuring which patterns exist rather than porting a list:
failed-tool retry churn (`is_error` on tool results — 1,971 across the corpus, and the
reason `Event.failed` finally gets populated), image and PDF reads (one session spent
2.39M on 348 of them), thinking-heavy turns, and repeated web fetches. Findings went
from 12 to 29, and 62.11M recoverable.

**Recommendations** are a separate class: identified but not costable. Unused MCP servers
are read from `~/.claude.json` and matched against `mcp__<server>__` calls — three are
configured here and never invoked. Their token cost is genuinely unknowable, since tool
schemas never appear in a Transcript, so they carry no figure and stay out of the total.
This is what keeps "Measured, never estimated" intact while still surfacing the advice.

**Alerts** watch the running Session for two things only: a single result far above that
Session's own median, and the prefix being rebuilt three times inside ten minutes. A
native notification when the app is not focused, an in-app banner when it is. Transcripts
are written after a Request completes, so an Alert always reports what was spent and
never what to avoid — the wording says so.

Deliberately not taken from token-optimizer: everything that intervenes. Delta reads,
bash-output rewriting, nudges and checkpointing all need hooks in the request path.
This app only ever reads (ADR-0002).

**v10 — Command palette. Built.** ⌘K over two tiers: Screens and Sessions filter locally
from the renderer's own index with no round trip, while files and events arrive from the
same search Search uses, debounced, appended underneath when they land — the list never
blocks on them. Arrow keys, Enter, Escape, and the cursor stays in range as results come
and go.

Displayed commands lose their leading `cd <path>`, which was pushing the actual command
off the end of every row. The Timeline still shows them verbatim, because there the point
is exactly what ran.

## Tooling

`npm run check` is the gate: typecheck, lint, format, test. The same four run in CI on
every push and PR, as separate steps so a failure names itself. Husky runs lint-staged on
commit and the typecheck plus tests on push, so a green push means a green CI.

ESLint carries complexity limits — 15 for logic, 24 for components, max-depth 4, max-params
4 — set at roughly where this code already sits, so they hold the line rather than demand
a refactor. The one genuine outlier, `parseTranscript`, is exempted by name at its
definition with the reason: it is a streaming state machine over a dozen accumulators,
and splitting it further would thread them all through helper parameters.

CI runs lint and formatting once — they cannot differ by platform — and runs the
typecheck, the tests and the build on macOS, Windows and Linux. That is not ceremony:
it caught three places that split paths on `/`, which would have left every Windows
path untruncated in the UI and printed in full inside Findings.

Tagging `v*` builds on a three-way matrix — macOS (arm64 and
Intel), Windows (NSIS, x64 and arm64), Linux (AppImage x64/arm64 and a deb) — and
publishes every artefact to one GitHub release. `fail-fast` is off, so one platform
failing does not discard the others.

Signing is wired but dormant: each platform signs when its certificate secrets exist and
builds unsigned when they do not, so the workflow works today and starts signing the
moment secrets are added. macOS additionally notarises when the Apple ID secrets are
present. What to buy and which secrets to add is in [docs/signing.md](./docs/signing.md);
the certificates themselves need a paid account and an identity check.

Allowance reads the token Claude Code already stores: the login Keychain on macOS,
`~/.claude/.credentials.json` elsewhere. The file is tried first, since it is simply
absent on macOS. **Only the Keychain path has been exercised** — the file path is
written from how Claude Code stores credentials off macOS, not from observation.
Everything else in the app reads transcripts and is platform-independent.

## Shared components

`src/renderer/ui/` and `src/renderer/charts/`, one component per file. They exist because
the same pieces had been written out once per screen and had begun to drift: four
near-identical labelled-figure components, five empty states, and a count chip copied into
five top bars.

Four things that were hand-rolled now use Base UI primitives, chosen for behaviour
rather than novelty:

- **Tooltip** replaces `title=` on the explanatory text — why a figure is blank, why two
  numbers must not be summed. `title` waits about a second, cannot be styled, and never
  appears on keyboard focus, which hid exactly the notes that stop a number being
  misread. Per-row truncation reveals keep `title`: a tooltip instance per cell in a
  300-row result is real cost for something that only re-shows a clipped string.
- **Meter** for the allowance bars, which are a measurement in a known range. They were
  a div inside a div, announced as nothing; the reset times also moved out of a tooltip
  and onto the screen.
- **ToggleGroup** behind both the filter chips and the Settings segmented controls — one
  tab stop per row with arrow keys between, instead of loose buttons.
- **Collapsible** for the Cache expiry list, which had no `aria-expanded` at all.

Rejected after looking: **ScrollArea** (Chromium-only app, native scrollbars already
styled), **Separator** (a 1px border is lighter than a component), **Toast** for alerts
(they persist until cleared, which is the opposite of a toast) and **Autocomplete** for
the palette (its two-tier async behaviour is bespoke; a rewrite risks regressions for
little gain).

`Detail` and `Live` still build their own top bar. They share the `.topbar` styling but
their contents genuinely differ — a back affordance, a live indicator, an action — and
routing them through `TopBar` would add props that one caller each would use.

## States and motion

Every screen now has all three states. It previously had two: eight of the nine IPC calls
had no failure path at all, so a rejected call left the screen on "Reading transcripts…"
indefinitely — which looks exactly like a slow one. `useAsync` returns loading, ready or
failed, and `Failed` says what broke.

Motion is deliberately sparse. This is a monitor that stays open, and changing screens or
scanning a table happens dozens of times an hour, so **neither is animated** — putting a
delay in front of something done constantly makes an app feel slower, not better. Only
things that enter the screen and are seen occasionally move: the palette (180ms in, 140ms
out, scaling from 0.98), tooltips (130ms, a 3px rise), an alert arriving, a section
opening, and a 100ms press on buttons. Everything is `ease-out`, transform and opacity
only, and the existing `prefers-reduced-motion` rule switches all of it off.

## The name

Loupe — a jeweller's magnifier, for close inspection of small valuable things.

"Claude" is deliberately not in the name: it is Anthropic's trademark, and an unsigned
third-party app carrying it reads as official. The accent `#C15F3C` stays, which says
what ecosystem this belongs to without borrowing the word. The relationship goes in the
description instead: _a token inspector for Claude Code_.

Renaming carried the Allowance samples across — `~/.claude/.ledger-usage.jsonl` is moved
to `.loupe-usage.jsonl` on first read. That history cannot be reconstructed, so orphaning
it would have lost the only Allowance data that exists. The index cache is not migrated,
because it rebuilds in a few seconds, and the stored preferences are not either, because
a theme and a threshold cost nothing to set again.

## Known, unfixed

- **Failure paths are untested**: no `~/.claude`, a Transcript truncated mid-write, a
  locked keychain, a machine with zero Sessions. Most code catches and degrades, but
  none of it has been exercised.
- ~~736 MB resident.~~ Measured properly: **63 MB is actually retained**; the rest is heap
  V8 freed after a ~305 MB parsing peak and never returned to the OS. Bounding parse
  concurrency made it slightly worse and was reverted. Only reducing parse-time garbage
  would move the number in Activity Monitor.
