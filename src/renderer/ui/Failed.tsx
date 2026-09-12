import { Empty } from './Empty.js';

/**
 * A call that did not come back.
 *
 * Says what broke rather than staying on a spinner, because the two are
 * indistinguishable to whoever is waiting.
 */
export const Failed = ({ what, error }: { what: string; error: string }) => (
  <Empty align="left">
    Could not {what}.
    <div className="mono" style={{ marginTop: 8, fontSize: 11, color: 'var(--err)' }}>
      {error}
    </div>
  </Empty>
);
