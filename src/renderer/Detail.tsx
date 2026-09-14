import { useEffect, useMemo, useRef, useState } from 'react';
import { Tabs } from '@base-ui-components/react/tabs';
import { cacheHitRate, newTokens, type SessionDetail } from '../shared/model.js';
import { CacheTab, FilesTab, SubagentsTab, ToolsTab } from './DetailTabs.js';
import { BackButton } from './ui/BackButton.js';
import { EventRow } from './ui/EventRow.js';
import { Inspector } from './ui/Inspector.js';
import { Stat } from './ui/Stat.js';
import { StatStrip } from './ui/StatStrip.js';
import { BLANK, duration, model, percent, tokens } from './format.js';

export function Detail({
  session,
  onBack,
  initialTab = 'timeline',
  initialEventId,
  collapseAbove = 2000,
}: {
  session: SessionDetail;
  onBack: () => void;
  /** Which tab to land on — set when arriving from a Finding's evidence link. */
  initialTab?: string;
  /** Which Event to select on arrival — set when arriving from an Alert. */
  initialEventId?: string;
  /** Tool output larger than this stays collapsed. 0 never collapses. */
  collapseAbove?: number;
}) {
  const [selected, setSelected] = useState<string | null>(
    initialEventId ?? session.events[0]?.id ?? null,
  );
  const listRef = useRef<HTMLDivElement>(null);

  const event = useMemo(
    () => session.events.find((e) => e.id === selected) ?? null,
    [session.events, selected],
  );

  // j/k move through the Timeline, as in the design.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key !== 'j' && e.key !== 'k' && e.key !== 'Escape') return;
      if (e.key === 'Escape') {
        onBack();
        return;
      }
      e.preventDefault();
      const i = session.events.findIndex((x) => x.id === selected);
      const next = e.key === 'j' ? Math.min(session.events.length - 1, i + 1) : Math.max(0, i - 1);
      setSelected(session.events[next]?.id ?? null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [session.events, selected, onBack]);

  // Tab labels carry their own counts, so they are computed alongside the header.
  const fileCount = new Set(session.events.filter((e) => e.path).map((e) => e.path)).size;
  const toolCount = new Set(session.events.filter((e) => e.tool).map((e) => e.tool)).size;
  const hit = cacheHitRate(session.usage);
  const totalTokens = newTokens(session.usage);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="topbar drag-region">
        <BackButton label="Sessions" onClick={onBack} />
        <span className="ellipsis" style={{ fontWeight: 600, letterSpacing: '-.01em' }}>
          {session.name}
        </span>
        <span className="mono" style={{ color: 'var(--faint)', fontSize: 11.5, flex: 'none' }}>
          {session.project}
        </span>
      </div>

      <StatStrip>
        <Stat
          label="Active"
          value={duration(session.activeMs)}
          hint="Time actually worked — gaps longer than five minutes are excluded."
        />
        <Stat
          label="Span"
          value={duration(session.spanMs)}
          hint="First event to last, including idle time. A resumed session can span days."
          tone="var(--dim)"
        />
        <Stat label="Prompts" value={String(session.prompts)} />
        <Stat label="Requests" value={String(session.requestCount)} />
        <Stat label="Tool calls" value={String(session.toolCalls)} />
        <Stat
          label="New tokens"
          value={tokens(totalTokens)}
          hint="Input, cache writes and output. Cache reads are excluded — every request re-reads the whole prefix."
        />
        <Stat
          label="Cache read"
          value={tokens(session.usage.cacheRead)}
          hint="Summed across requests, so the same prefix is counted once per request. A volume, not a total."
          tone="var(--dim)"
        />
        <Stat label="Cache written" value={tokens(session.usage.cacheWrite)} />
        <Stat
          label="Cache hit"
          value={percent(hit)}
          tone={hit !== null && hit < 0.5 ? 'var(--err)' : undefined}
        />
        <Stat label="Output" value={tokens(session.usage.output)} />
        <Stat label="Subagents" value={String(session.subagents)} />
        <Stat
          label="Allowance"
          value={session.allowance === null ? BLANK : percent(session.allowance)}
          hint="Measured from the usage endpoint. Blank for sessions recorded before this app was installed."
          tone="var(--faint)"
        />
        <Stat label="Model" value={session.models[0] ? model(session.models[0]) : BLANK} />
      </StatStrip>

      <Tabs.Root
        defaultValue={initialTab}
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      >
        <Tabs.List
          style={{
            flex: 'none',
            display: 'flex',
            gap: 2,
            padding: '0 12px',
            borderBottom: '1px solid var(--line)',
            background: 'var(--panel)',
          }}
        >
          <Tab value="timeline" label={`Timeline · ${session.events.length}`} />
          <Tab value="cache" label={`Cache · ${session.invalidations.length}`} />
          <Tab value="files" label={`Files · ${fileCount}`} />
          <Tab value="tools" label={`Tools · ${toolCount}`} />
          <Tab value="agents" label={`Subagents · ${session.subagentDetail.length}`} />
        </Tabs.List>

        <Tabs.Panel value="timeline" style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div ref={listRef} style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
            {session.events.map((e) => (
              <EventRow
                key={e.id}
                event={e}
                active={e.id === selected}
                onSelect={() => {
                  setSelected(e.id);
                }}
              />
            ))}
            {session.events.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--faint)' }}>
                This transcript has no events.
              </div>
            )}
          </div>
          <Inspector event={event} collapseAbove={collapseAbove} />
        </Tabs.Panel>

        <Tabs.Panel value="cache" style={PANEL}>
          <CacheTab session={session} />
        </Tabs.Panel>
        <Tabs.Panel value="files" style={PANEL}>
          <FilesTab session={session} />
        </Tabs.Panel>
        <Tabs.Panel value="tools" style={PANEL}>
          <ToolsTab session={session} />
        </Tabs.Panel>
        <Tabs.Panel value="agents" style={PANEL}>
          <SubagentsTab session={session} onSelectEvent={setSelected} />
        </Tabs.Panel>
      </Tabs.Root>
    </div>
  );
}

const PANEL = { flex: 1, minHeight: 0, overflow: 'hidden' } as const;

function Tab({ value, label, disabled }: { value: string; label: string; disabled?: boolean }) {
  return (
    <Tabs.Tab
      value={value}
      className="tab"
      disabled={disabled ?? false}
      title={disabled ? 'Arrives in a later version' : ''}
    >
      {label}
    </Tabs.Tab>
  );
}
