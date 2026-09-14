import { Check, Database, Copy, Layers, RefreshCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Finding, FindingCategory, FindingKind, SessionSummary } from '../shared/model.js';
import { ICON } from './App.js';
import { tokens } from './format.js';
import { useAsync } from './useAsync.js';
import { Empty } from './ui/Empty.js';
import { Failed } from './ui/Failed.js';
import { Chips } from './ui/Chips.js';
import { TopBar } from './ui/TopBar.js';

const CATEGORY: Record<FindingCategory, { label: string; icon: typeof Database }> = {
  context: { label: 'Context', icon: Layers },
  duplication: { label: 'Duplication', icon: Copy },
  cache: { label: 'Cache', icon: Database },
  behaviour: { label: 'Behaviour', icon: RefreshCcw },
};

/**
 * Dismissals live in the browser store rather than on disk: they are a personal
 * "I have read this", not data about the Sessions, and losing them costs nothing.
 */
const DISMISSED_KEY = 'loupe.dismissed';

const readDismissed = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
};

export function Insights({
  sessions,
  onOpen,
}: {
  sessions: SessionSummary[];
  onOpen: (session: SessionSummary, tab: Finding['tab']) => void;
}) {
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(readDismissed);
  const [category, setCategory] = useState<FindingCategory | 'all'>('all');

  const loaded = useAsync(async () => {
    setFindings(await window.loupe.findings());
    return true;
  });

  const dismiss = (id: string): void => {
    const next = new Set(dismissed).add(id);
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
    } catch {
      /* fine */
    }
  };

  const restore = (): void => {
    setDismissed(new Set());
    try {
      localStorage.removeItem(DISMISSED_KEY);
    } catch {
      /* fine */
    }
  };

  const live = useMemo(
    () => (findings ?? []).filter((f) => !dismissed.has(f.id)),
    [findings, dismissed],
  );
  const shown = live.filter((f) => category === 'all' || f.category === category);
  const recoverable = shown.reduce((n, f) => n + f.recoverable, 0);

  if (loaded.status === 'failed') {
    return <Failed what="look for findings" error={loaded.error} />;
  }
  if (!findings) return <Empty>Reading transcripts…</Empty>;

  const counts = (c: FindingCategory | 'all'): number =>
    c === 'all' ? live.length : live.filter((f) => f.category === c).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <TopBar title="Insights" count={shown.length}>
        <Chips
          options={[
            ['all', 'Everything'],
            ['context', 'Context'],
            ['duplication', 'Duplication'],
            ['cache', 'Cache'],
            ['behaviour', 'Behaviour'],
          ]}
          value={category}
          counts={Object.fromEntries(
            (['all', 'context', 'duplication', 'cache', 'behaviour'] as const).map((c) => [
              c,
              counts(c),
            ]),
          )}
          onChange={setCategory}
        />

        {dismissed.size > 0 && (
          <button
            onClick={restore}
            style={{
              marginLeft: 'auto',
              border: 'none',
              background: 'none',
              color: 'var(--accent)',
              fontSize: 11.5,
            }}
          >
            Restore {dismissed.size} dismissed
          </button>
        )}
      </TopBar>

      <div style={{ overflow: 'auto', minHeight: 0, flex: 1, padding: 16 }}>
        <p style={{ color: 'var(--dim)', margin: '0 0 14px', maxWidth: 640, lineHeight: 1.5 }}>
          {shown.length === 0
            ? 'Nothing to report.'
            : `${tokens(recoverable)} tokens recoverable across ${shown.length} findings. Every
               figure is measured from your transcripts; the wording is fixed, so nothing here
               was generated.`}
        </p>

        {groupByKind(shown).map(([kind, group]) => (
          <Group
            key={kind}
            findings={group}
            onDismiss={dismiss}
            onOpen={(f) => {
              const s = sessions.find((x) => x.id === f.sessionId);
              if (s) onOpen(s, f.tab);
            }}
          />
        ))}

        {shown.length === 0 && findings.length > 0 && (
          <div style={{ color: 'var(--faint)' }}>
            {dismissed.size > 0 ? 'All findings dismissed.' : 'No findings in this category.'}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Findings of one kind share their explanation word for word, so they are shown
 * as one card: the explanation once, then a row per Session with its own
 * Measured numbers and its own link to the evidence.
 */
function groupByKind(findings: Finding[]): Array<[FindingKind, Finding[]]> {
  const groups = new Map<FindingKind, Finding[]>();
  for (const f of findings) {
    const g = groups.get(f.kind);
    if (g) g.push(f);
    else groups.set(f.kind, [f]);
  }
  return [...groups.entries()].sort((a, b) => sum(b[1]) - sum(a[1]));
}

const sum = (findings: Finding[]): number => findings.reduce((n, f) => n + f.recoverable, 0);

function Group({
  findings,
  onOpen,
  onDismiss,
}: {
  findings: Finding[];
  onOpen: (f: Finding) => void;
  onDismiss: (id: string) => void;
}) {
  const first = findings[0]!;
  const { label, icon: Icon } = CATEGORY[first.category];
  const total = sum(findings);

  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 8,
        marginBottom: 12,
        background: 'var(--panel)',
        maxWidth: 820,
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '12px 14px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
          <Icon {...ICON} style={{ color: 'var(--accent)', flex: 'none' }} aria-hidden />
          <span className="eyebrow" style={{ color: 'var(--accent)' }}>
            {label}
          </span>
          <span style={{ color: 'var(--faint)', fontSize: 11.5 }}>
            {findings.length} {findings.length === 1 ? 'session' : 'sessions'}
          </span>
          <span
            className="mono"
            style={{ marginLeft: 'auto', flex: 'none', fontSize: 14, color: 'var(--fg)' }}
            title="Tokens this would give back if acted on"
          >
            {tokens(total)}
          </span>
        </div>
        <p style={{ margin: 0, lineHeight: 1.55, maxWidth: 640, color: 'var(--dim)' }}>
          {first.explanation}
        </p>
      </div>

      {findings.map((f) => (
        <div
          key={f.id}
          className="trow"
          style={{
            gridTemplateColumns: 'minmax(0,1fr) 84px 150px 92px',
            height: 36,
            borderBottom: 'none',
            borderTop: '1px solid var(--lineSoft)',
          }}
        >
          <div className="ellipsis" style={{ fontSize: 12 }}>
            <span className="mono" style={{ color: 'var(--faint)', fontSize: 11 }}>
              {f.project}
            </span>
            {' · '}
            <span title={`${f.sessionName} — ${f.text}`}>{f.text}</span>
          </div>
          <div className="num" style={{ color: 'var(--fg)' }}>
            {tokens(f.recoverable)}
          </div>
          <div style={{ textAlign: 'right' }}>
            <button
              onClick={() => {
                onOpen(f);
              }}
              style={{
                border: '1px solid var(--line)',
                borderRadius: 5,
                padding: '2px 8px',
                fontSize: 11,
                background: 'transparent',
                color: 'var(--fg)',
              }}
            >
              Open the evidence
            </button>
          </div>
          <div style={{ textAlign: 'right' }}>
            <button
              onClick={() => {
                onDismiss(f.id);
              }}
              title="Hide this finding"
              style={{
                border: 'none',
                background: 'none',
                color: 'var(--faint)',
                fontSize: 11,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Check size={12} strokeWidth={1.7} aria-hidden /> Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
