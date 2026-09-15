import { useEffect, useRef, useState } from 'react';
import type { SearchHit, SearchResult } from '../main/search.js';
import { rowProps, useRowNav } from './useRowNav.js';
import type { EventKind, SessionSummary } from '../shared/model.js';
import { KIND } from './kinds.js';
import { Chips } from './ui/Chips.js';
import { Empty } from './ui/Empty.js';
import { Failed } from './ui/Failed.js';
import { TopBar } from './ui/TopBar.js';
import { clock, command, shortPath, tokens, when } from './format.js';

/** Kinds worth offering as filters, in the order the design lists them. */
const FILTERS: Array<[EventKind | 'session' | 'all', string]> = [
  ['all', 'Everything'],
  ['session', 'Sessions'],
  ['read', 'Reads'],
  ['edit', 'Edits'],
  ['bash', 'Commands'],
  ['inject', 'Injected'],
  ['user', 'Prompts'],
  ['mcp', 'MCP'],
  ['agent', 'Subagents'],
];

const GRID = { gridTemplateColumns: '78px 62px minmax(0,1fr) 150px 76px' };

export function Search({
  sessions,
  onOpen,
}: {
  sessions: SessionSummary[];
  onOpen: (s: SessionSummary, tab: SearchHit['tab']) => void;
}) {
  const [query, setQuery] = useState('');
  const [listRef, onListKeys] = useRowNav();
  const [kind, setKind] = useState<EventKind | 'session' | 'all'>('all');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    box.current?.focus();
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResult(null);
      return;
    }
    // The first search pays for the parse; later ones hit the memoised index.
    // Debounced so a typed word does not queue a scan per keystroke.
    setBusy(true);
    const timer = setTimeout(() => {
      window.loupe.search(query, kind).then(
        (r) => {
          setResult(r);
          setError(null);
          setBusy(false);
        },
        (cause: unknown) => {
          setError(cause instanceof Error ? cause.message : String(cause));
          setBusy(false);
        },
      );
    }, 180);
    return () => {
      clearTimeout(timer);
    };
  }, [query, kind]);

  const counts = result?.counts ?? {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <TopBar title="Search">
        <input
          ref={box}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          placeholder="Find a file, a command, a prompt…"
          spellCheck={false}
          style={{
            flex: 1,
            maxWidth: 420,
            height: 26,
            padding: '0 9px',
            fontSize: 12,
            border: '1px solid var(--line)',
            borderRadius: 5,
            background: 'var(--bg)',
            color: 'var(--fg)',
          }}
        />
        {result && (
          <span className="mono" style={{ color: 'var(--faint)', fontSize: 11 }}>
            {result.total} {result.total === 1 ? 'match' : 'matches'}
            {result.total > result.hits.length && ` · showing ${result.hits.length}`}
          </span>
        )}
        {busy && <span style={{ color: 'var(--faint)', fontSize: 11 }}>searching…</span>}
      </TopBar>

      <div style={{ flex: 'none', padding: '8px 12px', borderBottom: '1px solid var(--line)' }}>
        <Chips options={FILTERS} value={kind} counts={counts} onChange={setKind} />
      </div>

      <div className="scroll-pane" ref={listRef} onKeyDown={onListKeys}>
        {query.trim().length < 2 && (
          <Empty align="left">
            Searches every event in every transcript — file paths, commands, and the opening of each
            prompt and reply. Not tool output, which is too large to keep in the index. Two
            characters to start.
          </Empty>
        )}

        {error !== null && <Failed what="run that search" error={error} />}

        {error === null && result?.hits.length === 0 && query.trim().length >= 2 && !busy && (
          <Empty align="left">Nothing matches “{query.trim()}”.</Empty>
        )}

        {result && result.hits.length > 0 && (
          <>
            <div className="thead" style={GRID}>
              <div>When</div>
              <div>Kind</div>
              <div>Match</div>
              <div>Session</div>
              <div style={{ textAlign: 'right' }}>Cost</div>
            </div>
            {result.hits.map((h) => (
              <Hit
                key={h.id}
                hit={h}
                query={query.trim()}
                onOpen={() => {
                  const s = sessions.find((x) => x.id === h.sessionId);
                  if (s) onOpen(s, h.tab);
                }}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function Hit({ hit, query, onOpen }: { hit: SearchHit; query: string; onOpen: () => void }) {
  const [label, colour] =
    hit.kind === 'session' ? (['SESSION', 'var(--accent)'] as const) : KIND[hit.kind];

  return (
    <div className="trow" style={{ ...GRID, height: 34 }} {...rowProps(onOpen)}>
      <div className="mono" style={{ fontSize: 11, color: 'var(--faint)' }} title={when(hit.at)}>
        {clock(hit.at)}
      </div>
      <div
        className="mono"
        style={{ color: colour, fontSize: 9.5, letterSpacing: '.08em', fontWeight: 600 }}
      >
        {label}
      </div>
      <div className="ellipsis" style={{ fontSize: 12, paddingRight: 10 }} title={hit.title}>
        <Highlight text={display(hit)} query={query} />
      </div>
      <div className="mono ellipsis" style={{ fontSize: 11, color: 'var(--dim)' }}>
        {hit.project}
      </div>
      <div className="num">{tokens(hit.cost)}</div>
    </div>
  );
}

/** Paths shortened from the left, commands stripped of their leading `cd`. */
const display = (hit: SearchHit): string => {
  if (hit.kind === 'read' || hit.kind === 'edit') return shortPath(hit.title, '', 3);
  if (hit.kind === 'bash') return command(hit.title);
  return hit.title;
};

/** Marks the matched span so it is obvious why a row is in the list. */
function Highlight({ text, query }: { text: string; query: string }) {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark style={{ background: 'var(--accentSoft)', color: 'var(--accent)', padding: '0 1px' }}>
        {text.slice(at, at + query.length)}
      </mark>
      {text.slice(at + query.length)}
    </>
  );
}
