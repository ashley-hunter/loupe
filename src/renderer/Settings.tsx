import { useEffect, useState } from 'react';
import { TRANSCRIPT_ROOT_LABEL, type Prefs } from '../shared/prefs.js';
import type { UpdateState } from '../main/updates.js';
import { savePrefs } from './prefs.js';
import { Chips } from './ui/Chips.js';
import { TopBar } from './ui/TopBar.js';

/**
 * Settings.
 *
 * Only what genuinely varies. The design also offered an estimation method, a
 * retention period and confidence bands; none of those exist any more —
 * Allowance is Measured rather than estimated (ADR-0001), Transcripts are never
 * deleted, and there is no confidence to band. Controls that cannot do anything
 * are worse than absent ones, so they are absent.
 */
export function Settings({
  theme,
  onTheme,
  prefs,
  onPrefs,
}: {
  theme: 'light' | 'dark' | 'system';
  onTheme: (t: 'light' | 'dark' | 'system') => void;
  prefs: Prefs;
  onPrefs: (p: Prefs) => void;
}) {
  const setPrefs = (p: Prefs): void => {
    savePrefs(p);
    onPrefs(p);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <TopBar title="Settings" />

      <div className="scroll-pane">
        <div className="pane-content" style={{ maxWidth: 640 }}>
          <Group label="Appearance">
            <Row label="Theme" note="Follows the system unless you choose otherwise">
              <Choice
                value={theme}
                options={[
                  ['system', 'System'],
                  ['light', 'Light'],
                  ['dark', 'Dark'],
                ]}
                onChange={(v) => {
                  onTheme(v as 'light' | 'dark' | 'system');
                }}
              />
            </Row>
            <Row
              label="Collapse tool output above"
              note="Larger results stay collapsed in the inspector"
            >
              <Choice
                value={String(prefs.collapseAbove)}
                options={[
                  ['1000', '1k tokens'],
                  ['2000', '2k'],
                  ['5000', '5k'],
                  ['0', 'Never'],
                ]}
                onChange={(v) => {
                  setPrefs({ ...prefs, collapseAbove: Number(v) });
                }}
              />
            </Row>
          </Group>

          <Group label="Data">
            <Row label="Transcript directory" note="Where Claude Code writes its session logs">
              <span className="mono selectable" style={{ fontSize: 11.5, color: 'var(--dim)' }}>
                {TRANSCRIPT_ROOT_LABEL}
              </span>
            </Row>
            <Row
              label="Allowance poll interval"
              note="The usage endpoint rate-limits; below five minutes risks a 429"
            >
              <Choice
                value={String(prefs.pollMinutes)}
                options={[
                  ['5', '5 min'],
                  ['10', '10 min'],
                  ['30', '30 min'],
                ]}
                onChange={(v) => {
                  setPrefs({ ...prefs, pollMinutes: Number(v) });
                }}
              />
            </Row>
          </Group>

          <Group label="Updates">
            <Updates />
          </Group>

          <p style={{ color: 'var(--faint)', fontSize: 11.5, lineHeight: 1.55, marginTop: 18 }}>
            Allowance is read from Anthropic's usage endpoint and never estimated, so there is
            nothing to configure about how it is calculated. Transcripts are only ever read, never
            written or deleted.
          </p>
        </div>
      </div>
    </div>
  );
}

const Group = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <section style={{ marginBottom: 22 }}>
    <div className="eyebrow" style={{ marginBottom: 6 }}>
      {label}
    </div>
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--panel)' }}>
      {children}
    </div>
  </section>
);

const Row = ({
  label,
  note,
  children,
}: {
  label: string;
  note: string;
  children: React.ReactNode;
}) => (
  <div
    className="group-row"
    style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 14px' }}
  >
    <div style={{ minWidth: 0, flex: 1 }}>
      <div style={{ fontSize: 12.5 }}>{label}</div>
      <div style={{ color: 'var(--faint)', fontSize: 11, marginTop: 1 }}>{note}</div>
    </div>
    <div style={{ flex: 'none' }}>{children}</div>
  </div>
);

/**
 * A small segmented control — closer to a native preference than a dropdown.
 *
 * The same ToggleGroup the filter chips use, so the arrow keys work here too.
 */
function Choice({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<[string, string]>;
  onChange: (v: string) => void;
}) {
  // No wrapper: each chip already carries its own border, and an outer one
  // reads as a double line around the group.
  return <Chips options={options} value={value} onChange={onChange} />;
}

/**
 * What the updater is doing, and the one button that ever matters.
 *
 * An installed build updates itself; this exists so that is visible rather than
 * silent, and so a failure (no network, or macOS declining an unsigned build)
 * has somewhere to be seen instead of being swallowed (ADR-0004).
 */
function Updates() {
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    void window.loupe.updateState().then(setState);
    return window.loupe.onUpdate((status) => {
      setState((prev) => (prev ? { ...prev, status } : prev));
    });
  }, []);

  if (!state) {
    return (
      <Row label="Version" note="Checking">
        {null}
      </Row>
    );
  }

  const { status } = state;
  const note = !state.supported
    ? 'A development build updates when you rebuild it'
    : describe(status);

  return (
    <>
      <Row label="Version" note={note}>
        <span className="mono selectable" style={{ fontSize: 11.5, color: 'var(--dim)' }}>
          {state.version}
        </span>
      </Row>
      {state.supported && (
        <Row
          label={status.state === 'ready' ? 'Ready to install' : 'Automatic updates'}
          note={
            status.state === 'ready'
              ? 'Installed the next time the app starts, or now'
              : 'Checked on launch and every six hours'
          }
        >
          {status.state === 'ready' ? (
            <button
              className="ghost-button"
              onClick={() => {
                void window.loupe.installUpdate();
              }}
            >
              Restart and install
            </button>
          ) : (
            <button
              className="ghost-button"
              disabled={status.state !== 'idle' && status.state !== 'failed'}
              onClick={() => {
                void window.loupe.checkForUpdates();
              }}
            >
              Check now
            </button>
          )}
        </Row>
      )}
    </>
  );
}

function describe(status: UpdateState['status']): string {
  switch (status.state) {
    case 'checking':
      return 'Looking for a newer version';
    case 'downloading':
      return `Downloading ${status.version} - ${String(status.percent)}%`;
    case 'ready':
      return `${status.version} is downloaded`;
    // The message is the updater's own, which is usually a plain sentence. It is
    // shown verbatim rather than reworded, because guessing at what went wrong
    // is how you end up telling someone the wrong thing.
    case 'failed':
      return `Could not check: ${status.message}`;
    case 'idle':
      return 'Up to date';
  }
}
