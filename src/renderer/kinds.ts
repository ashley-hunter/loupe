import type { EventKind } from '../shared/model.js';

/** Badge label and colour per Event kind, matching the Timeline in the design. */
export const KIND: Record<EventKind, [label: string, colour: string]> = {
  user: ['USER', 'var(--accent)'],
  asst: ['CLAUDE', 'var(--fg)'],
  think: ['THINK', 'var(--dim)'],
  read: ['READ', 'var(--blue)'],
  edit: ['EDIT', 'var(--green)'],
  bash: ['BASH', '#6b5b95'],
  grep: ['SEARCH', 'var(--dim)'],
  web: ['WEB', 'var(--blue)'],
  mcp: ['MCP', 'var(--blue)'],
  agent: ['AGENT', 'var(--accent)'],
  tool: ['TOOL', 'var(--dim)'],
  compact: ['COMPACT', 'var(--warn)'],
  model: ['MODEL', 'var(--warn)'],
  config: ['CONFIG', 'var(--dim)'],
};
