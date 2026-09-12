# No database

A full cold parse of every Transcript on this machine — 585 files, 359,033 lines,
1.68 GB — takes 3.5 seconds single-threaded. That is too fast to justify a schema,
migrations, or a query layer, so the app parses into an in-memory index on launch
and caches the result to a single JSON file keyed by each Transcript's mtime and
size, re-parsing only the files that changed.

## Consequences

This looks wrong at a glance and a future reader will be tempted to "fix" it by
adding SQLite. Re-run the benchmark before doing so: the trigger for adding a real
database is the cold parse approaching tens of seconds, not the size of the corpus.

Because the whole index is in memory, Search and cross-Session Detectors are plain
array operations rather than queries, which is most of why the app stays small.
