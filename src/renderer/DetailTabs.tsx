import { byFile, byTool, type Rollup } from '../shared/aggregate.js';
import {
  newTokens,
  type Invalidation,
  type SessionDetail,
  type Subagent,
} from '../shared/model.js';
import { BLANK, clock, duration, model as modelName, shortPath, tokens } from './format.js';
import { Empty } from './ui/Empty.js';

const CAUSE: Record<Invalidation['cause'], string> = {
  'model-change': 'Model changed',
  expiry: 'Expired while idle',
  reanchor: 'Prefix re-anchored',
  compaction: 'Context compacted',
  undetermined: 'Cause not determined',
};

const Pad = ({ children }: { children: React.ReactNode }) => (
  <div style={{ padding: 16, overflow: 'auto', height: '100%' }}>{children}</div>
);

/** Shown under a table whose figures exclude Events that could not be Measured. */
const Unmeasured = ({ n }: { n: number }) =>
  n === 0 ? null : (
    <div style={{ color: 'var(--faint)', fontSize: 11, marginTop: 8 }}>
      {n} {n === 1 ? 'call' : 'calls'} had no measurable cost and {n === 1 ? 'is' : 'are'} not
      included in these totals.
    </div>
  );

/* ---- Cache -------------------------------------------------------------- */

const CACHE_GRID = { gridTemplateColumns: '96px minmax(160px,1fr) 110px 96px' };

export function CacheTab({ session }: { session: SessionDetail }) {
  const { invalidations } = session;
  if (invalidations.length === 0) {
    return <Empty>The cached prefix was never rebuilt in this session.</Empty>;
  }

  const isAvoidable = (c: Invalidation['cause']): boolean =>
    c === 'model-change' || c === 'undetermined';
  const avoidable = invalidations.filter((i) => isAvoidable(i.cause));
  const rest = invalidations.filter((i) => !isAvoidable(i.cause));
  const rewritten = invalidations.reduce((n, i) => n + i.rewritten, 0);

  return (
    <Pad>
      <p style={{ color: 'var(--dim)', margin: '0 0 12px', maxWidth: 620, lineHeight: 1.5 }}>
        {invalidations.length} {invalidations.length === 1 ? 'rebuild' : 'rebuilds'} of the cached
        prefix, {tokens(rewritten)} rewritten in total.{' '}
        {avoidable.length > 0
          ? `${avoidable.length} of them happened because of something done during the session.`
          : 'None were caused by something done during the session.'}
      </p>

      <div style={{ border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
        <div
          className="thead"
          style={{ ...CACHE_GRID, position: 'static', background: 'var(--panel)' }}
        >
          <div>Time</div>
          <div>Cause</div>
          <div>Since previous</div>
          <div style={{ textAlign: 'right' }}>Rewritten</div>
        </div>
        {[...avoidable, ...rest].map((i, n) => (
          <div className="trow" key={`${i.at}-${n}`} style={{ ...CACHE_GRID, height: 34 }}>
            <div className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>
              {clock(i.at)}
            </div>
            <div className="ellipsis" style={{ fontSize: 12 }}>
              <span style={{ color: i.cause === 'undetermined' ? 'var(--faint)' : 'var(--fg)' }}>
                {CAUSE[i.cause]}
              </span>
              {i.detail && (
                <span className="mono" style={{ color: 'var(--faint)', fontSize: 11 }}>
                  {' '}
                  · {i.detail}
                </span>
              )}
            </div>
            <div className="num">{duration(i.idleMs)}</div>
            <div className="num" style={{ color: 'var(--err)' }}>
              {tokens(i.rewritten)}
            </div>
          </div>
        ))}
      </div>
    </Pad>
  );
}

/* ---- Files -------------------------------------------------------------- */

const FILE_GRID = { gridTemplateColumns: 'minmax(220px,1fr) 62px 62px 84px' };

export function FilesTab({ session }: { session: SessionDetail }) {
  const files = byFile(session.events);
  if (files.length === 0) return <Empty>This session did not read or write any files.</Empty>;

  const unmeasured = files.reduce((n, f) => n + f.unmeasured, 0);
  const repeated = files.filter((f) => f.reads > 1);

  return (
    <Pad>
      <p style={{ color: 'var(--dim)', margin: '0 0 12px', maxWidth: 620, lineHeight: 1.5 }}>
        {files.length} {files.length === 1 ? 'file' : 'files'} touched.
        {repeated.length > 0 &&
          ` ${repeated.length} read more than once — each read pays for the
        whole file again unless it was already in context.`}
      </p>

      <div style={{ border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
        <div
          className="thead"
          style={{ ...FILE_GRID, position: 'static', background: 'var(--panel)' }}
        >
          <div>File</div>
          <div style={{ textAlign: 'right' }}>Reads</div>
          <div style={{ textAlign: 'right' }}>Edits</div>
          <div style={{ textAlign: 'right' }}>Cost</div>
        </div>
        {files.map((f) => (
          <div className="trow" key={f.key} style={{ ...FILE_GRID, height: 32 }}>
            <div className="mono ellipsis selectable" style={{ fontSize: 11.5 }} title={f.key}>
              {shortPath(f.key, session.cwd, 4)}
            </div>
            <div className="num" style={{ color: f.reads > 1 ? 'var(--warn)' : 'var(--dim)' }}>
              {f.reads || BLANK}
            </div>
            <div className="num">{f.edits || BLANK}</div>
            <div className="num" style={{ color: 'var(--fg)' }}>
              {tokens(f.cost)}
            </div>
          </div>
        ))}
      </div>
      <Unmeasured n={unmeasured} />
    </Pad>
  );
}

/* ---- Tools -------------------------------------------------------------- */

const TOOL_GRID = { gridTemplateColumns: 'minmax(200px,1fr) 70px 90px 90px' };

export function ToolsTab({ session }: { session: SessionDetail }) {
  const tools = byTool(session.events);
  if (tools.length === 0) return <Empty>This session made no tool calls.</Empty>;

  const unmeasured = tools.reduce((n, t) => n + t.unmeasured, 0);
  const worst = tools[0]?.cost ?? 0;

  return (
    <Pad>
      <p style={{ color: 'var(--dim)', margin: '0 0 12px', maxWidth: 620, lineHeight: 1.5 }}>
        {tools.length} {tools.length === 1 ? 'tool' : 'tools'} used across {session.toolCalls}{' '}
        calls, ranked by what their results added to the context.
      </p>

      <div style={{ border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
        <div
          className="thead"
          style={{ ...TOOL_GRID, position: 'static', background: 'var(--panel)' }}
        >
          <div>Tool</div>
          <div style={{ textAlign: 'right' }}>Calls</div>
          <div style={{ textAlign: 'right' }}>Cost</div>
          <div style={{ textAlign: 'right' }}>Per call</div>
        </div>
        {tools.map((t) => (
          <div className="trow" key={t.key} style={{ ...TOOL_GRID, height: 32 }}>
            <ToolName tool={t} worst={worst} />
            <div className="num">{t.events}</div>
            <div className="num" style={{ color: 'var(--fg)' }}>
              {tokens(t.cost)}
            </div>
            <div className="num">
              {tokens(Math.round(t.cost / Math.max(1, t.events - t.unmeasured)))}
            </div>
          </div>
        ))}
      </div>
      <Unmeasured n={unmeasured} />
    </Pad>
  );
}

/** Tool name with a bar showing its share of the costliest tool. */
function ToolName({ tool, worst }: { tool: Rollup; worst: number }) {
  const share = worst === 0 ? 0 : (tool.cost / worst) * 100;
  return (
    <div style={{ minWidth: 0, paddingRight: 12 }}>
      <div className="mono ellipsis" style={{ fontSize: 11.5 }}>
        {tool.key}
      </div>
      <div style={{ height: 2, background: 'var(--track)', borderRadius: 1, marginTop: 3 }}>
        <div
          style={{
            width: `${share}%`,
            height: '100%',
            borderRadius: 1,
            background: 'var(--accent)',
          }}
        />
      </div>
    </div>
  );
}

/* ---- Subagents ---------------------------------------------------------- */

const AGENT_GRID = { gridTemplateColumns: '110px minmax(200px,1fr) 62px 62px 84px 84px' };

export function SubagentsTab({
  session,
  onSelectEvent,
}: {
  session: SessionDetail;
  onSelectEvent: (id: string) => void;
}) {
  const agents = session.subagentDetail;
  if (agents.length === 0) return <Empty>This session spawned no subagents.</Empty>;

  const spent = agents.reduce((n, a) => n + newTokens(a.usage), 0);

  return (
    <Pad>
      <p style={{ color: 'var(--dim)', margin: '0 0 12px', maxWidth: 620, lineHeight: 1.5 }}>
        {agents.length} {agents.length === 1 ? 'subagent' : 'subagents'} spent {tokens(spent)} new
        tokens in their own context windows. That is separate from this session's own total, not
        part of it.
      </p>

      <ByType agents={agents} spent={spent} />

      <div style={{ border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
        <div
          className="thead"
          style={{ ...AGENT_GRID, position: 'static', background: 'var(--panel)' }}
        >
          <div>Agent</div>
          <div>Task</div>
          <div style={{ textAlign: 'right' }}>Reqs</div>
          <div style={{ textAlign: 'right' }}>Tools</div>
          <div style={{ textAlign: 'right' }}>New tokens</div>
          <div style={{ textAlign: 'right' }}>Active</div>
        </div>
        {agents.map((a) => (
          <Agent key={a.id} agent={a} session={session} onSelectEvent={onSelectEvent} />
        ))}
      </div>
    </Pad>
  );
}

/**
 * What each kind of agent cost, before the individual runs.
 *
 * Delegated work is the largest thing in the corpus and the list below is
 * ordered by when it happened, which answers "what ran" but never "what is
 * expensive". One heavy agent type repeated twenty times looks like twenty
 * ordinary rows until it is totalled.
 */
function ByType({ agents, spent }: { agents: Subagent[]; spent: number }) {
  const totals = new Map<string, { n: number; cost: number }>();
  for (const a of agents) {
    const at = totals.get(a.type) ?? { n: 0, cost: 0 };
    at.n++;
    at.cost += newTokens(a.usage);
    totals.set(a.type, at);
  }

  const rows = [...totals.entries()].sort((a, b) => b[1].cost - a[1].cost);
  // One type is not a breakdown of anything.
  if (rows.length < 2) return null;

  return (
    <div style={{ marginBottom: 14 }}>
      {rows.map(([type, t]) => (
        <div
          key={type}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0' }}
        >
          <span style={{ fontSize: 12.5, width: 150, flex: 'none' }} className="truncate">
            {type}
          </span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--faint)', width: 58 }}>
            {t.n}
            {t.n === 1 ? ' run' : ' runs'}
          </span>
          <div
            style={{ flex: 1, height: 3, background: 'var(--track)', borderRadius: 2 }}
            aria-hidden
          >
            <div
              style={{
                width: `${String(spent === 0 ? 0 : (t.cost / spent) * 100)}%`,
                height: '100%',
                background: 'var(--accent)',
                borderRadius: 2,
              }}
            />
          </div>
          <span className="mono" style={{ fontSize: 11.5, width: 76, textAlign: 'right' }}>
            {tokens(t.cost)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Agent({
  agent: a,
  session,
  onSelectEvent,
}: {
  agent: Subagent;
  session: SessionDetail;
  onSelectEvent: (id: string) => void;
}) {
  // The meta records the Task call that spawned it; jump to it when it is still there.
  const spawnedBy = a.toolUseId
    ? session.events.find((e) => e.toolUseId === a.toolUseId)
    : undefined;

  return (
    <div
      className="trow"
      style={{ ...AGENT_GRID, height: 38 }}
      onClick={
        spawnedBy
          ? () => {
              onSelectEvent(spawnedBy.id);
            }
          : undefined
      }
      title={spawnedBy ? 'Show the call that spawned this subagent' : ''}
    >
      <div className="ellipsis" style={{ fontSize: 12 }}>
        <span style={{ color: 'var(--accent)' }}>{a.type}</span>
        {a.spawnDepth > 1 && (
          <span className="mono" style={{ color: 'var(--faint)', fontSize: 10 }}>
            {' '}
            d{a.spawnDepth}
          </span>
        )}
      </div>
      <div className="ellipsis" style={{ fontSize: 12, paddingRight: 10 }} title={a.description}>
        {a.description}
        {a.model && (
          <span className="mono" style={{ color: 'var(--faint)', fontSize: 10.5 }}>
            {' '}
            · {modelName(a.model)}
          </span>
        )}
      </div>
      <div className="num">{a.requestCount}</div>
      <div className="num">{a.toolCalls}</div>
      <div className="num" style={{ color: 'var(--fg)' }}>
        {tokens(newTokens(a.usage))}
      </div>
      <div className="num">{duration(a.durationMs)}</div>
    </div>
  );
}
