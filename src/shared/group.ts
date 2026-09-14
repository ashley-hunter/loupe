/** A run of items sharing a key, in the order the key was first seen. */
export interface Group<T> {
  key: string;
  items: T[];
}

/**
 * Group an already-sorted list, keeping the sort.
 *
 * Groups come back in the order their key first appears, so the ordering of the
 * list decides the ordering of the groups: sorted newest-first, the project you
 * worked in most recently is at the top; sorted by tokens, the project holding
 * the biggest session is. That is one rule rather than a second sort to keep in
 * step with the first.
 */
export function groupBy<T>(items: readonly T[], key: (item: T) => string): Array<Group<T>> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const existing = groups.get(k);
    if (existing) existing.push(item);
    else groups.set(k, [item]);
  }
  return [...groups.entries()].map(([k, list]) => ({ key: k, items: list }));
}
