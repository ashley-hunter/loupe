import { Dialog } from '@base-ui-components/react/dialog';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SearchHit } from '../main/search.js';
import type { SessionSummary } from '../shared/model.js';
import { newTokens } from '../shared/model.js';
import { command, shortPath, tokens, when } from './format.js';

/**
 * The command palette.
 *
 * Two tiers, because they arrive at different speeds. Screens and Sessions are
 * already in the renderer, so they filter as you type with no round trip.
 * Events and files come from the same search the Search screen uses, debounced,
 * and append underneath when they arrive — the list never blocks on them.
 */

export interface PaletteAction {
  id: string;
  group: string;
  label: string;
  meta: string;
  run: () => void;
}

const GROUP_ORDER = ['Screens', 'Sessions', 'Files', 'Events'];

/** Paths shortened from the left, commands stripped of their leading `cd`. */
const label = (h: SearchHit): string => {
  if (h.kind === 'read' || h.kind === 'edit') return shortPath(h.title, '', 3);
  if (h.kind === 'bash') return command(h.title);
  return h.title;
};

export function Palette({
  open,
  onClose,
  screens,
  sessions,
  onOpenSession,
}: {
  open: boolean;
  onClose: () => void;
  /** The navigable screens, as [id, label] pairs. */
  screens: Array<{ id: string; label: string; go: () => void }>;
  sessions: SessionSummary[];
  onOpenSession: (s: SessionSummary, tab: SearchHit['tab']) => void;
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const list = useRef<HTMLDivElement>(null);

  // A fresh palette every time, rather than whatever was left from last time.
  useEffect(() => {
    if (open) {
      setQuery('');
      setHits([]);
      setCursor(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      void window.loupe.search(query, 'all').then((r) => {
        setHits(r.hits.slice(0, 12));
      });
    }, 160);
    return () => {
      clearTimeout(timer);
    };
  }, [query, open]);

  const actions = useMemo<PaletteAction[]>(() => {
    const needle = query.trim().toLowerCase();
    const hit = (text: string): boolean => needle === '' || text.toLowerCase().includes(needle);

    const fromScreens: PaletteAction[] = screens
      .filter((s) => hit(s.label))
      .map((s) => ({
        id: `screen:${s.id}`,
        group: 'Screens',
        label: s.label,
        meta: 'Go to',
        run: s.go,
      }));

    const fromSessions: PaletteAction[] = sessions
      .filter((s) => hit(s.name) || hit(s.project))
      .slice(0, 8)
      .map((s) => ({
        id: `session:${s.id}`,
        group: 'Sessions',
        label: s.name,
        meta: `${s.project} · ${tokens(newTokens(s.usage))} · ${when(s.startedAt)}`,
        run: () => {
          onOpenSession(s, 'timeline');
        },
      }));

    const fromHits: PaletteAction[] = hits
      // Sessions are already listed above from the local index.
      .filter((h) => h.kind !== 'session')
      .map((h) => ({
        id: `hit:${h.id}`,
        group: h.tab === 'files' ? 'Files' : 'Events',
        label: label(h),
        meta: `${h.kind} · ${h.project} · ${tokens(h.cost)}`,
        run: () => {
          const s = sessions.find((x) => x.id === h.sessionId);
          if (s) onOpenSession(s, h.tab);
        },
      }));

    const all = [...fromScreens, ...fromSessions, ...fromHits];
    return all.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  }, [query, screens, sessions, hits, onOpenSession]);

  // The cursor must stay inside the list as results arrive and disappear.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, actions.length - 1)));
  }, [actions.length]);

  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const choose = (action: PaletteAction | undefined): void => {
    if (!action) return;
    action.run();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault();
      setCursor((c) => Math.min(actions.length - 1, c + 1));
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(actions[cursor]);
    }
  };

  // Precomputed rather than tracked with a mutable during render, which React
  // rightly objects to: the same render must produce the same output.
  const rows = actions.map((action, i) => ({
    action,
    index: i,
    header: i === 0 || actions[i - 1]?.group !== action.group ? action.group : null,
  }));

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop
          data-backdrop
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.28)' }}
        />
        <Dialog.Popup
          data-palette
          onKeyDown={onKeyDown}
          style={{
            position: 'fixed',
            top: '14%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'min(620px, 90vw)',
            maxHeight: '64vh',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 10,
            boxShadow: '0 18px 48px rgba(0,0,0,.22)',
            overflow: 'hidden',
          }}
        >
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            placeholder="Go to a screen, a session, a file…"
            spellCheck={false}
            autoFocus
            style={{
              border: 'none',
              borderBottom: '1px solid var(--line)',
              outline: 'none',
              padding: '13px 15px',
              fontSize: 14,
              background: 'transparent',
              color: 'var(--fg)',
            }}
          />

          <div ref={list} style={{ overflow: 'auto', minHeight: 0, padding: '5px 0' }}>
            {rows.map(({ action: a, index: i, header }) => {
              return (
                <div key={a.id}>
                  {header && (
                    <div className="eyebrow" style={{ padding: '8px 15px 4px' }}>
                      {header}
                    </div>
                  )}
                  <div
                    data-active={i === cursor}
                    onMouseEnter={() => {
                      setCursor(i);
                    }}
                    onClick={() => {
                      choose(a);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '6px 15px',
                      background: i === cursor ? 'var(--accentSoft)' : 'transparent',
                      borderLeft: `2px solid ${i === cursor ? 'var(--accent)' : 'transparent'}`,
                    }}
                  >
                    <span className="ellipsis" style={{ flex: 1, fontSize: 12.5 }}>
                      {a.label}
                    </span>
                    <span
                      className="mono ellipsis"
                      style={{ color: 'var(--faint)', fontSize: 10.5, flex: 'none', maxWidth: 240 }}
                    >
                      {a.meta}
                    </span>
                  </div>
                </div>
              );
            })}

            {actions.length === 0 && (
              <div style={{ padding: '22px 15px', color: 'var(--faint)', fontSize: 12.5 }}>
                {query.trim().length < 2
                  ? 'Type to find a screen, a session, a file or a command.'
                  : `Nothing matches “${query.trim()}”.`}
              </div>
            )}
          </div>

          <div
            className="mono"
            style={{
              flex: 'none',
              borderTop: '1px solid var(--line)',
              padding: '6px 15px',
              color: 'var(--faint)',
              fontSize: 10,
              display: 'flex',
              gap: 14,
            }}
          >
            <span>↑↓ move</span>
            <span>↵ open</span>
            <span>esc close</span>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
