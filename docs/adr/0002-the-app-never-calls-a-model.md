# The app never calls a model

Loupe exists to show where a Session's allowance went, so it would be
self-defeating for the tool itself to consume any. The app makes no Messages API
calls of any kind: every Finding on the Insights screen comes from a deterministic
Detector with a hand-written sentence and Measured numbers slotted in, and the only
network call the app ever makes is the read-only usage endpoint, which reports
consumption without running inference and therefore costs nothing.

## Consequences

Findings only cover patterns someone wrote a Detector for. New waste patterns need
new code, not a better prompt. In exchange they are instant, identical on every run,
and unit-testable against fixture Transcripts.

An "explain this with a model" affordance was considered and rejected. If it is ever
added it must be explicitly opt-in per click and labelled as spending Allowance,
because it would be the only thing in the app that does.
