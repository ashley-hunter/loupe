import { Toggle } from '@base-ui-components/react/toggle';
import { ToggleGroup } from '@base-ui-components/react/toggle-group';

/**
 * A row of filter chips with counts.
 *
 * A ToggleGroup rather than loose buttons, so the row is one tab stop and the
 * arrow keys move between chips — which is how a row of controls that looks
 * like this is expected to behave.
 *
 * A chip whose count is zero is disabled rather than hidden, so the set of
 * things you can filter by does not change shape as you type.
 */
export function Chips<T extends string>({
  options,
  value,
  counts,
  onChange,
}: {
  options: Array<[T, string]>;
  value: T;
  /** Count per option. Omit for chips that are not counted. */
  counts?: Partial<Record<string, number>> | undefined;
  onChange: (next: T) => void;
}) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(next) => {
        // Single-select: ignore the deselect that a second click would produce,
        // because "no filter at all" is not one of the states here.
        const picked = next[0] as T | undefined;
        if (picked !== undefined) onChange(picked);
      }}
      style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}
    >
      {options.map(([id, label]) => {
        const n = counts?.[id];
        const empty = counts !== undefined && id !== 'all' && !n;
        const active = value === id;
        return (
          <Toggle
            key={id}
            value={id}
            disabled={empty}
            style={{
              fontSize: 11.5,
              padding: '3px 8px',
              borderRadius: 4,
              border: `1px solid ${active ? 'var(--accentBd)' : 'var(--line)'}`,
              background: active ? 'var(--accentSoft)' : 'transparent',
              color: empty ? 'var(--faint)' : active ? 'var(--accent)' : 'var(--dim)',
            }}
          >
            {label}
            {n !== undefined && <span style={{ color: 'var(--faint)' }}> {n}</span>}
          </Toggle>
        );
      })}
    </ToggleGroup>
  );
}
