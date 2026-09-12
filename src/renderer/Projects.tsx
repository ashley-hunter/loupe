import { useAsync } from './useAsync.js';
import { Failed } from './ui/Failed.js';
import { cacheHitRate, newTokens, type SessionSummary } from '../shared/model.js';
import type { ProjectRollup } from '../shared/rollup.js';
import { Panel } from './charts/Panel.js';
import { RankedBars } from './charts/RankedBars.js';
import { Empty } from './ui/Empty.js';
import { Hint } from './ui/Hint.js';
import { Stat } from './ui/Stat.js';
import { TopBar } from './ui/TopBar.js';
import { duration, percent, shortPath, tokens, when } from './format.js';

export function Projects({
  sessions,
  onOpen,
}: {
  sessions: SessionSummary[];
  onOpen: (s: SessionSummary) => void;
}) {
  const state = useAsync<ProjectRollup[]>(() => window.loupe.projects());

  if (state.status === 'loading') return <Empty>Reading transcripts…</Empty>;
  if (state.status === 'failed') return <Failed what="read the projects" error={state.error} />;
  const projects = state.data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <TopBar title="Projects" count={projects.length} />

      <div className="scroll-pane">
        <div className="pane-content">
          {projects.map((p) => (
            <Project key={p.name} project={p} sessions={sessions} onOpen={onOpen} />
          ))}
          {projects.length === 0 && <Empty>No projects found.</Empty>}
        </div>
      </div>
    </div>
  );
}

function Project({
  project: p,
  sessions,
  onOpen,
}: {
  project: ProjectRollup;
  sessions: SessionSummary[];
  onOpen: (s: SessionSummary) => void;
}) {
  const mine = sessions.filter((s) => s.project === p.name);
  const ranked = [...mine].sort((a, b) => newTokens(b.usage) - newTokens(a.usage));
  const biggest = Math.max(1, newTokens(ranked[0]?.usage ?? p.usage));
  const worstFile = p.files[0]?.cost ?? 1;
  const worstTool = p.tools[0]?.cost ?? 1;

  return (
    <Panel
      title={p.name}
      note={`${p.sessions} session${p.sessions === 1 ? '' : 's'} · last ${when(p.lastAt)}`}
    >
      <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', marginBottom: 14 }}>
        <Stat label="New tokens" value={tokens(newTokens(p.usage))} />
        <Stat label="Cache hit" value={percent(cacheHitRate(p.usage))} />
        <Stat label="Active" value={duration(p.activeMs)} />
        <Stat label="Prompts" value={String(p.prompts)} />
        <Stat label="Tool calls" value={String(p.toolCalls)} />
        <Stat label="Subagents" value={String(p.subagents)} />
        <Stat label="Rebuilds" value={String(p.invalidations)} />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 22,
        }}
      >
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Costliest files
          </div>
          {p.files.length === 0 ? (
            <Hint>No files read in this project.</Hint>
          ) : (
            <RankedBars
              rows={p.files.map((f) => ({
                key: f.key,
                label: shortPath(f.key, p.cwd),
                meta: `${f.events} read${f.events === 1 ? '' : 's'}`,
                value: tokens(f.cost),
                fraction: f.cost / worstFile,
              }))}
            />
          )}
        </div>

        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Costliest tools
          </div>
          {p.tools.length === 0 ? (
            <Hint>No tool calls in this project.</Hint>
          ) : (
            <RankedBars
              rows={p.tools.map((t) => ({
                key: t.key,
                label: t.key,
                meta: `${t.events} call${t.events === 1 ? '' : 's'}`,
                value: tokens(t.cost),
                fraction: t.cost / worstTool,
              }))}
            />
          )}
        </div>
      </div>

      {ranked.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Sessions
          </div>
          <RankedBars
            rows={ranked.slice(0, 5).map((s) => ({
              key: s.id,
              label: s.name,
              meta: when(s.startedAt),
              value: tokens(newTokens(s.usage)),
              // Against the largest, not the most recent — `mine` is in time order.
              fraction: newTokens(s.usage) / biggest,
            }))}
            onSelect={(id) => {
              const s = mine.find((x) => x.id === id);
              if (s) onOpen(s);
            }}
          />
        </div>
      )}
    </Panel>
  );
}
