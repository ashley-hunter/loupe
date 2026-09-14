#!/usr/bin/env node
/**
 * Write a fake `~/.claude/projects` tree, and an Allowance series to match.
 *
 * Screenshots of this app would otherwise show real prompts, real project names
 * and a real home directory, which is not something to put in a README. This
 * produces Sessions with the same shape and none of the content.
 *
 *   node scripts/demo-data.mjs /tmp/loupe-demo
 *   LOUPE_ROOT=/tmp/loupe-demo npm start
 *
 * `LOUPE_ROOT` also moves the index cache and the Allowance series, and stops
 * the app calling the usage endpoint, so a demo run touches nothing real.
 */
import { mkdir, rm, writeFile, utimes } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.argv[2] ?? '/tmp/loupe-demo';

// A fixed seed, so regenerating for a new screenshot does not reshuffle
// everything and turn a small UI change into a completely different picture.
let seed = 20260912;
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

const OPUS = 'claude-opus-5';
const SONNET = 'claude-sonnet-5';
const HAIKU = 'claude-haiku-4-5-20251001';
const FABLE = 'claude-fable-5-1';

// Wide enough that random picks rarely collide, so duplication only shows up
// where a Session is deliberately given the `dupes` trait.
// prettier-ignore
const FILES = [
  'src/checkout/total.ts', 'src/checkout/discount.ts', 'src/checkout/cart.tsx',
  'src/auth/middleware.ts', 'src/auth/session.ts', 'src/auth/tokens.ts',
  'src/components/DataTable.tsx', 'src/components/Modal.tsx', 'src/components/Button.tsx',
  'src/components/Toolbar.tsx', 'src/billing/invoice.ts', 'src/billing/tax.ts',
  'src/billing/refund.ts', 'src/api/routes.ts', 'src/api/handlers.ts',
  'src/api/schema.ts', 'src/lib/rate-limit.ts', 'src/lib/retry.ts',
  'src/lib/logger.ts', 'src/hooks/useCart.ts', 'src/hooks/useTheme.ts',
  'src/state/store.ts', 'tests/webhook.spec.ts', 'tests/checkout.spec.ts',
  'tests/auth.spec.ts', 'docs/api.md', 'package.json', 'vite.config.ts',
];

const COMMANDS = [
  'npm test',
  'npm run build',
  'git status',
  'npm run lint',
  'npx tsc --noEmit',
  'git diff --stat',
  'npm run test:watch',
];

const REPLIES = [
  'Found it. The discount is applied before tax rather than after, so the total is short by the tax on the discount.',
  'That file already imports the helper, so I can reuse it rather than adding another.',
  'Tests pass. Two were asserting the old behaviour and now assert the new one.',
  'The slow part is the font, not the JavaScript. It blocks the first paint for 1.2s.',
  'Done. I kept the old export as an alias so nothing downstream breaks.',
  'This looks like a caching problem rather than a logic one. Checking the key.',
];

const FOLLOW_UPS = [
  'Can you add a test for that case too?',
  'Looks good, now do the same for the other two.',
  'Why did you choose that approach over the simpler one?',
  'Run the build and check nothing else broke.',
];

/**
 * Sessions, each with the traits it should exhibit.
 *
 * The traits exist so every Detector has something to find. A screenshot where
 * Insights reports one category and zero of everything else says the app only
 * looks for one thing, which is not true.
 */
// prettier-ignore
const SESSIONS = [
  ['acme-web',      'Add a dark mode toggle to settings and persist the choice',           OPUS,   46, ['reanchor']],
  ['payments-api',  'The checkout total is wrong when a discount code is applied - find out why', OPUS, 58, ['dupes', 'churn']],
  ['design-system', 'Extract the button variants into their own file and reuse them',      FABLE,  22, []],
  ['payments-api',  'Migrate the auth middleware off the deprecated session library',      SONNET, 34, ['switch']],
  ['docs-site',     'Document the public API for the rate limiter',                        HAIKU,   6, []],
  ['acme-web',      'Why is the homepage LCP over four seconds on mobile?',                OPUS,   41, ['binary', 'web']],
  ['infra',         'Set up a GitHub Actions matrix build for Node 20 and 22',             FABLE,  14, ['churn']],
  ['mobile-app',    'Write integration tests for the webhook retry logic',                 SONNET, 29, []],
  ['payments-api',  'Refactor the invoice generator so the tax rules live in one place',   OPUS,   52, ['thinking', 'reanchor']],
  ['design-system', 'The data table header misaligns when a column is sorted',             FABLE,  18, ['binary']],
  ['acme-web',      'Replace the hand-rolled modal with the one from the design system',   OPUS,   25, []],
  ['infra',         'We are close to the disk quota - what can be removed safely?',        HAIKU,   4, []],
  ['docs-site',     'Rewrite the getting-started page so it works on a clean machine',     SONNET, 11, ['web']],
  ['mobile-app',    'Offline mode drops the last edit when the app is backgrounded',       OPUS,   63, ['dupes', 'thinking']],
  ['design-system', 'Add a reduced-motion variant to every transition',                    FABLE,  16, []],
  ['acme-web',      'Audit the bundle and tell me what is actually costing us',            OPUS,   37, ['switch']],
  ['payments-api',  'Add idempotency keys to the refund endpoint',                         SONNET, 21, []],
  ['infra',         'Terraform plan shows a replacement for the database - why?',          OPUS,    9, []],
];

const iso = (ms) => new Date(ms).toISOString();
let uuidN = 0;
const uuid = () => `demo-${String(++uuidN).padStart(7, '0')}`;

/**
 * One Session's records.
 *
 * The usage numbers matter as much as the text. The cached prefix has to grow
 * monotonically for a turn's cost to be computable at all, and the shape of a
 * drop is what separates an Invalidation from a Compaction.
 */
function transcript({ project, title, model: baseModel, requests, traits, startedAt }) {
  const has = (t) => traits.includes(t);
  const cwd = `/Users/dev/code/${project}`;
  const lines = [];
  const push = (o) => lines.push(JSON.stringify({ ...o, cwd, uuid: uuid() }));

  let at = startedAt;
  let prefix = between(9_000, 22_000);
  let model = baseModel;

  push({ type: 'user', timestamp: iso(at), message: { role: 'user', content: title } });

  for (let i = 0; i < requests; i++) {
    at += between(20, 90) * 1000;

    let write = between(1_200, 9_000);
    let read = prefix;
    let output = between(150, 2_400);
    let thinking = 0;

    // Lopsided reasoning: five times the thinking for the answer it produced.
    if (has('thinking') && i % 4 === 1) {
      thinking = between(9_000, 16_000);
      output = thinking + between(100, 900);
    } else if (model === OPUS && rand() < 0.3) {
      thinking = between(300, 1_500);
      output += thinking;
    }

    // Halfway through, switch model. The model is part of the cache key, so the
    // prefix is rebuilt on the next Request.
    if (has('switch') && i === Math.floor(requests / 2)) {
      model = model === OPUS ? SONNET : OPUS;
      read = Math.round(prefix * 0.2);
      write = Math.round(prefix * 0.55);
    }

    // The prefix survives but moves from read to written: the largest single
    // cost in real Transcripts, and not a mistake.
    if (has('reanchor') && i > 2 && i % 3 === 0) {
      read = Math.round(prefix * 0.3);
      write = Math.round(prefix * 0.55);
    }

    const content = [];
    if (thinking) content.push({ type: 'thinking', thinking: '', signature: 'demo' });
    content.push({ type: 'text', text: pick(REPLIES) });

    const calls = [];
    const add = (name, input) =>
      calls.push({ type: 'tool_use', id: `toolu_demo_${i}_${calls.length}`, name, input });

    if (has('churn') && i >= 2 && i <= 6) {
      // The same command failing over and over, which costs the same context
      // every time and says nothing new after the first.
      add('Bash', { command: 'npm run build -- --strict' });
      write = between(11_000, 18_000);
    } else if (has('binary') && i % 9 === 3) {
      add('Read', {
        file_path: `${cwd}/${pick(['docs/mock.png', 'docs/spec.pdf', 'docs/flow.png'])}`,
      });
      write = between(14_000, 26_000);
    } else if (has('web') && i % 6 === 2) {
      add('WebFetch', { url: 'https://web.dev/articles/lcp' });
      write = between(12_000, 20_000);
    } else {
      for (let t = 0; t < between(1, 4); t++) {
        const file = has('dupes') && t === 0 ? FILES[between(0, 2)] : pick(FILES);
        const tool = pick(['Read', 'Edit', 'Bash', 'Grep', 'Read']);
        add(
          tool,
          tool === 'Bash'
            ? { command: pick(COMMANDS) }
            : tool === 'Grep'
              ? { pattern: pick(['useCart', 'TODO', 'export function', 'process.env']) }
              : { file_path: `${cwd}/${file}` },
        );
      }
      if (has('dupes')) write = between(6_000, 14_000);
    }
    content.push(...calls);

    push({
      type: 'assistant',
      timestamp: iso(at),
      requestId: `req_demo_${String(i).padStart(4, '0')}`,
      message: {
        id: `msg_demo_${i}`,
        model,
        role: 'assistant',
        content,
        usage: {
          input_tokens: between(2, 12),
          cache_read_input_tokens: read,
          cache_creation_input_tokens: write,
          output_tokens: output,
          ...(thinking ? { output_tokens_details: { thinking_tokens: thinking } } : {}),
        },
      },
    });

    prefix = read + write + output;
    at += between(5, 40) * 1000;

    const failing = has('churn') && i >= 2 && i <= 6;
    push({
      type: 'user',
      timestamp: iso(at),
      message: {
        role: 'user',
        content: calls.map((c) => ({
          type: 'tool_result',
          tool_use_id: c.id,
          content: 'x'.repeat(between(200, 3_000)),
          ...(failing || rand() < 0.03 ? { is_error: true } : {}),
        })),
      },
    });

    // A follow-up prompt every so often, so Prompts is not always 1.
    if (rand() < 0.18) {
      at += between(30, 200) * 1000;
      push({
        type: 'user',
        timestamp: iso(at),
        message: { role: 'user', content: pick(FOLLOW_UPS) },
      });
    }
  }

  return { lines, endedAt: at };
}

const DAY = 86_400_000;
const now = Date.now();

await rm(root, { recursive: true, force: true });

let offset = 2 * 3600_000 + 17 * 60_000;
const spans = [];

for (const [project, title, model, requests, traits] of SESSIONS) {
  const dir = join(root, `-Users-dev-code-${project}`);
  await mkdir(dir, { recursive: true });

  const startedAt = now - offset;
  let { lines, endedAt } = transcript({ project, title, model, requests, traits, startedAt });

  // The newest Session is made to be still running: its last Event a few
  // minutes ago, so the Live screen has something to follow and the Alert
  // detectors, which only fire on recent moments, actually fire.
  if (spans.length === 0) {
    const delta = now - 4 * 60_000 - endedAt;
    lines = lines.map((l) => {
      const r = JSON.parse(l);
      if (r.timestamp) r.timestamp = iso(Date.parse(r.timestamp) + delta);
      return JSON.stringify(r);
    });
    endedAt += delta;
  }

  const path = join(dir, `demo-${project}-${offset}.jsonl`);
  await writeFile(path, lines.join('\n') + '\n');
  // The Sessions list sorts on mtime, so it has to match the Session's own clock.
  await utimes(path, new Date(endedAt), new Date(endedAt));
  spans.push([Math.min(startedAt, endedAt), endedAt]);

  // Sessions get older going down the list, with an irregular gap between them.
  offset += between(3, 26) * 3600_000 + between(0, 59) * 60_000 + (rand() < 0.3 ? DAY : 0);
}

/**
 * A matching Allowance series.
 *
 * Without one the Allowance column is blank for every Session. That is correct
 * for real Sessions that predate the app, but in a screenshot it reads as a
 * broken column. Attribution needs a reading within ten minutes of both ends of
 * a Session, so this samples at the same five-minute interval the poller uses.
 */
const TICK = 5 * 60_000;
const BLOCK = 5 * 3600_000;
const earliest = Math.min(...spans.map(([a]) => a));
const active = (ms) => spans.some(([a, b]) => ms >= a && ms <= b);

const samples = [];
let weekly = 8;
let session = 0;
let block = Math.floor((earliest - TICK) / BLOCK);

for (let ms = earliest - TICK; ms <= now; ms += TICK) {
  // The five-hour window is a real clock boundary, not time since first use, so
  // it resets underneath a Session rather than at its edges.
  if (Math.floor(ms / BLOCK) !== block) {
    block = Math.floor(ms / BLOCK);
    session = 0;
  }
  // Allowance only moves while something is actually running.
  if (active(ms)) {
    session = Math.min(96, session + 1 + rand() * 2.2);
    weekly = Math.min(87, weekly + rand() * 0.3);
  }

  samples.push({
    at: iso(ms),
    limits: [
      {
        kind: 'session',
        percent: Math.round(session),
        resetsAt: iso(ms - (ms % BLOCK) + BLOCK),
        severity: session > 80 ? 'warning' : 'normal',
        model: null,
      },
      {
        kind: 'weekly_all',
        percent: Math.round(weekly),
        resetsAt: iso(now + 4 * DAY),
        severity: 'normal',
        model: null,
      },
    ],
  });
}

await writeFile(
  join(root, '.loupe-usage.jsonl'),
  samples.map((s) => JSON.stringify(s)).join('\n') + '\n',
);
/**
 * A stand-in for Claude Code's own config, so the Recommendations screen has
 * something to report without reading the real one.
 */
await writeFile(
  join(root, '.claude.json'),
  JSON.stringify(
    {
      mcpServers: { 'design-tokens': {} },
      projects: {
        '/Users/dev/code/payments-api': { mcpServers: { 'stripe-sandbox': {} } },
        '/Users/dev/code/acme-web': { mcpServers: { 'browser-tools': {} } },
      },
    },
    null,
    2,
  ) + '\n',
);

console.log(
  `${SESSIONS.length} sessions and ${samples.length} allowance samples written to ${root}`,
);
