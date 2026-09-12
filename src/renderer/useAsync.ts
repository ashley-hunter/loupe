import { useEffect, useState } from 'react';

/**
 * The three states any IPC call can be in.
 *
 * Every screen used to model only two — pending and loaded — so a rejected call
 * left the screen on "Reading transcripts…" forever, which looks identical to a
 * slow one. A permanent silent spinner is the worst of the three outcomes to
 * show, so failure is now a state of its own.
 */
export type Async<T> =
  { status: 'loading' } | { status: 'ready'; data: T } | { status: 'failed'; error: string };

export function useAsync<T>(run: () => Promise<T>, deps: unknown[] = []): Async<T> {
  const [state, setState] = useState<Async<T>>({ status: 'loading' });

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });

    run().then(
      (data) => {
        if (live) setState({ status: 'ready', data });
      },
      (cause: unknown) => {
        if (live) {
          setState({
            status: 'failed',
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      },
    );

    // A screen left before its call settled must not write into a dead tree.
    return () => {
      live = false;
    };
    // The caller owns these deps; this hook cannot know what `run` closes over.
  }, deps);

  return state;
}
