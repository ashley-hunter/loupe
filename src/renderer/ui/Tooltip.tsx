import { Tooltip as Base } from '@base-ui-components/react/tooltip';

/**
 * An explanation attached to something on screen.
 *
 * These carry the app's honesty text — why a figure is blank, why two numbers
 * must not be added together — so `title` was the wrong home for them: it waits
 * about a second, cannot be styled, and never appears for anyone navigating by
 * keyboard. This opens on hover and on focus, and is announced.
 */
export function Tooltip({
  text,
  children,
}: {
  /** The explanation. Nothing renders when this is absent. */
  text?: string | undefined;
  children: React.ReactNode;
}) {
  if (text === undefined || text === '') return <>{children}</>;

  return (
    // Timing comes from the provider, so tooltips do not each re-delay as the
    // pointer moves between them.
    <Base.Root>
      {/* `render` keeps the trigger as the child's own element rather than
          wrapping it in a span, which would disturb every grid layout here. */}
      <Base.Trigger render={<span style={{ display: 'contents' }} />}>{children}</Base.Trigger>
      <Base.Portal>
        <Base.Positioner sideOffset={6}>
          <Base.Popup
            data-tooltip
            style={{
              maxWidth: 320,
              padding: '7px 10px',
              fontSize: 11.5,
              lineHeight: 1.5,
              color: 'var(--fg)',
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              borderRadius: 6,
              boxShadow: '0 8px 24px rgba(0,0,0,.16)',
            }}
          >
            {text}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}

/** Wraps the app once; tooltips share its timing so they do not all re-delay. */
export const TooltipProvider = ({ children }: { children: React.ReactNode }) => (
  <Base.Provider delay={250}>{children}</Base.Provider>
);
