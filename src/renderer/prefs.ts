import { DEFAULT_PREFS, type Prefs } from '../shared/prefs.js';

const KEY = 'loupe.prefs';

export const loadPrefs = (): Prefs => {
  try {
    return {
      ...DEFAULT_PREFS,
      ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>),
    };
  } catch {
    return DEFAULT_PREFS;
  }
};

export const savePrefs = (p: Prefs): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* not worth failing over */
  }
};
