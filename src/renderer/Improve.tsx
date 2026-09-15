import { Check, Database, Copy, Info, Layers, RefreshCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  Finding,
  FindingCategory,
  FindingKind,
  Recommendation,
  SessionSummary,
} from '../shared/model.js';
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
 * Everything worth changing, ranked by what it gives back.
 *
 * The only things that cannot live inside a conversation: patterns that span
 * several of them, and configuration you fix once rather than per turn.
 */

/**
 * Advice sits alongside the Findings rather than on a screen of its own.
 *
 * The only thing separating the two is whether a token figure exists - an MCP
 * server's schema never appears in a Transcript, so its cost cannot be
 * Measured. That is a fact about the evidence, not a different question being
 * asked: both answer "what should I change?". Splitting them put the ones
 * without a number on a screen nobody opened, which is a worse answer to
 * "these rank badly" than ranking them properly.
 */
type Filter = FindingCategory | 'all' | 'advice';

const FILTERS = ['all', 'context', 'duplication', 'cache', 'behaviour', 'advice'] as const;

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

export function Improve({
  sessions,
  onOpen,
}: {
  sessions: SessionSummary[];
  onOpen: (session: SessionSummary) => void;
}) {
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [advice, setAdvice] = useState<Recommendation[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(readDismissed);
  const [category, setCategory] = useState<Filter>('all');

  const loaded = useAsync(async () => {
    // Both in one pass: they read the same parsed Sessions, and waiting for the
    // slower of the two beats drawing the screen twice.
    const [f, a] = await Promise.all([window.loupe.findings(), window.loupe.advice()]);
    setFindings(f);
    setAdvice(a);
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
  const shown =
    category === 'advice' ? [] : live.filter((f) => category === 'all' || f.category === category);
  const showAdvice = category === 'all' || category === 'advice';
  const recoverable = shown.reduce((n, f) => n + f.recoverable, 0);
  // Injected context carries no usage of its own, so its share of the total is
  // counted from content length. Saying "measured" over the whole figure while
  // part of it is an estimate would be the overclaim this app exists to catch.
  const estimates = shown.filter((f) => f.estimated === true).length;

  if (loaded.status === 'failed') {
    return <Failed what="look for findings" error={loaded.error} />;
  }
  if (!findings) return <Empty>Reading transcripts…</Empty>;

  const counts = (c: Filter): number =>
    c === 'all'
      ? live.length + advice.length
      : c === 'advice'
        ? advice.length
        : live.filter((f) => f.category === c).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <TopBar title="Improve" count={shown.length + (showAdvice ? advice.length : 0)}>
        <Chips
          options={[
            ['all', 'Everything'],
            ['context', 'Context'],
            ['duplication', 'Duplication'],
            ['cache', 'Cache'],
            ['behaviour', 'Behaviour'],
            ['advice', 'Advice'],
          ]}
          value={category}
          counts={Object.fromEntries(FILTERS.map((c) => [c, counts(c)]))}
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
          {shown.length === 0 && advice.length === 0
            ? 'Nothing to report.'
            : shown.length === 0
              ? 'No measurable findings. What is below carries no token figure.'
              : `${tokens(recoverable)} tokens recoverable across ${shown.length} findings. The
                 wording is fixed, so nothing here was generated. Every figure is measured from
                 your transcripts${
                   estimates === 0
                     ? ''
                     : `, except ${estimates} marked "about": injected context carries no usage of its own, so those are counted from how long it is`
                 }.`}
        </p>

        {groupByKind(shown).map(([kind, group]) => (
          <Group
            key={kind}
            findings={group}
            onDismiss={dismiss}
            onOpen={(f) => {
              const s = sessions.find((x) => x.id === f.sessionId);
              if (s) onOpen(s);
            }}
          />
        ))}

        {showAdvice && advice.length > 0 && (
          <section style={{ marginTop: shown.length > 0 ? 22 : 0 }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Not costable
            </div>
            <p style={{ color: 'var(--faint)', fontSize: 11.5, margin: '0 0 10px', maxWidth: 640 }}>
              Worth changing, but the saving cannot be measured from a transcript. These carry no
              token figure and are deliberately kept out of the total above.
            </p>
            {advice.map((r) => (
              <Advice key={r.id} recommendation={r} />
            ))}
          </section>
        )}

        {shown.length === 0 && !showAdvice && findings.length > 0 && (
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

/** A Recommendation. Deliberately has no number where a Finding has one. */
function Advice({ recommendation: r }: { recommendation: Recommendation }) {
  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 8,
        padding: '12px 14px',
        marginBottom: 10,
        background: 'var(--panel)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Info {...ICON} style={{ color: 'var(--dim)', flex: 'none' }} aria-hidden />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{r.title}</span>
        <span className="mono" style={{ marginLeft: 'auto', color: 'var(--faint)', fontSize: 11 }}>
          not costable
        </span>
      </div>
      <p style={{ margin: '0 0 7px', lineHeight: 1.55, maxWidth: 640, color: 'var(--dim)' }}>
        {r.text}
      </p>
      <div className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>
        {r.detail}
      </div>
    </div>
  );
}
