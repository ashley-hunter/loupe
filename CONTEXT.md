# Loupe

A desktop app that reads the Claude Code transcripts already on this machine and
explains where a session's tokens, cache, and rolling allowance actually went.

## Language

### Recorded work

**Session**:
One Claude Code conversation, from launch to exit. Identified by the session UUID
that names its transcript file.
_Avoid_: Conversation, chat, run

**Transcript**:
The append-only JSONL file a Session writes to disk. The only record of a Session
that exists after it ends.
_Avoid_: Log, history, dump

**Event**:
One entry in a Transcript — a prompt, a reply, a thought, a tool call, a
configuration change. The unit the Timeline renders.
_Avoid_: Message, line, row

**Request**:
One round trip to the model, identified by `requestId`. Carries the usage numbers
that Events are costed from. A Request writes one Transcript record per content
block and repeats its usage on each, so usage is read from the last record only.
_Avoid_: Call, API hit

**Subagent**:
A delegated agent with its own context window, writing its own Transcript under
`<session>/subagents/`. Its tokens are real and separate from its parent's.
_Avoid_: Child, worker, task

### Consumption

**Block**:
The rolling five-hour window that the Allowance is measured against. Its boundaries
come from the usage endpoint's reset timestamp; nothing in a Transcript identifies
which Block an Event fell in.
_Avoid_: Period, window, bucket

**Allowance**:
The share of a Block's rolling limit that has been consumed, as reported by
Anthropic. Measured, never inferred — a Session that predates this app's
installation has no Allowance and displays as blank.
_Avoid_: Quota, limit, usage, budget

**Shared**:
The state of an Allowance figure covering a span in which more than one Session
was running. The figure is correct for each Session and must not be summed
across them.
_Avoid_: Overlapping, concurrent, double-counted

**Active**:
Time actually worked in a Session: the gaps between consecutive Events, excluding
any gap longer than five minutes. Distinct from Span, which is simply first Event
to last and covers days on a resumed Session.
_Avoid_: Duration, elapsed, runtime

**New tokens**:
Input, cache writes and output — everything not served from cache, and the only
honest total for a Session. Cache reads are never added in: each Request re-reads
the whole prefix, so summing them counts the same tokens once per Request.
_Avoid_: Total tokens, tokens used

**Measured**:
A number read directly from a Transcript or from Anthropic's usage endpoint.
Everything the app displays is Measured; if a value cannot be Measured it is
left blank rather than estimated.
_Avoid_: Actual, real, true

### Cache

**Invalidation**:
A point where a Request rebuilt the cached prefix instead of reading it — cache
reads collapse and cache writes spike in the same Request.
_Avoid_: Cache miss, cache break, eviction

**Avoidable**:
The class of Invalidation caused by something that happened during the Session —
a configuration, model, mode, or effort change. Worth a Finding, because doing
the same thing before the Session starts avoids the cost.
_Avoid_: Self-inflicted, user-caused

**Expiry**:
The class of Invalidation caused by the gap since the previous Request exceeding
the cache TTL. The majority of real Invalidations. Reported as an aggregate, never
as a Finding, because idle time is not a mistake.
_Avoid_: Timeout, stale, idle miss

**Re-anchored**:
The class of Invalidation where the prefix was rebuilt above a small stable base
seconds after the previous Request — too soon for Expiry, with no model change.
Happens as a Session grows very large. Reported as an aggregate, because nothing
was done wrong; the only lever is starting a fresh Session sooner.
_Avoid_: Churn, thrash, cache miss

**Compaction**:
The class of Invalidation where the context shrank rather than moved — replaced
by a summary, so the rebuild is small and the saving large. Counted so totals
reconcile, never reported as waste.
_Avoid_: Summarisation, truncation, reset

**Undetermined**:
An Avoidable Invalidation whose cause no Detector could identify. Shown as a row
with its Measured cost and no cause, never hidden and never guessed at.
_Avoid_: Unknown, unexplained, other

### Analysis

**Detector**:
A rule that recognises one named wasteful pattern across Sessions and reports
every occurrence with its Measured cost. Deterministic — the same Transcripts
always produce the same output.
_Avoid_: Check, analyser, heuristic

**Finding**:
One occurrence a Detector reported: a fixed explanatory sentence with Measured
numbers slotted into it, the evidence it came from, and a recoverable cost.
_Avoid_: Insight, suggestion, tip, warning

**Recommendation**:
Something worth acting on whose saving cannot be Measured — an unused MCP server,
a heavier model than a task needed. Stated without a figure and kept apart from
Findings, which always carry one.
_Avoid_: Tip, suggestion, advice

**Alert**:
Something expensive that just happened in the running Session. Raised after the
fact, because a Transcript is written once a Request completes, so an Alert
reports what was spent and never what to avoid.
_Avoid_: Warning, notification

**Recoverable**:
What a Finding would give back if acted on, in the unit the waste occurred in —
tokens for context waste, Allowance for cache invalidation.
_Avoid_: Saving, waste, potential
