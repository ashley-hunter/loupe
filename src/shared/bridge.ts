import type { IndexResult } from '../main/catalogue.js';
import type { CacheSummary } from '../main/invalidations.js';
import type {
  Alert,
  Finding,
  Invalidation,
  Recommendation,
  SessionDetail,
  UsageSample,
} from './model.js';
import type { SearchResult } from '../main/search.js';
import type { UpdateState, UpdateStatus } from '../main/updates.js';
import type { EventKind } from './model.js';
import type { ProjectRollup } from './rollup.js';
import type {
  ActionKind,
  CacheClock,
  RunRecord,
  StartupCost,
  Threshold,
  ToolsConfig,
} from './tools.js';

/** What the renderer can ask the main process for. Nothing else crosses the boundary. */
export interface LoupeBridge {
  index(): Promise<IndexResult>;
  session(path: string): Promise<SessionDetail | null>;
  reveal(path: string): Promise<void>;
  cache(): Promise<CacheSummary & { all: Invalidation[] }>;
  findings(): Promise<Finding[]>;
  advice(): Promise<Recommendation[]>;
  projects(): Promise<ProjectRollup[]>;
  search(query: string, kind: EventKind | 'session' | 'all'): Promise<SearchResult>;
  /** Begin following whichever Session is running. */
  startLive(): Promise<void>;
  stopLive(): Promise<void>;
  /** Subscribe to the running Session; null means nothing is running. */
  onLive(fn: (detail: SessionDetail | null) => void): () => void;
  /** Expensive things that just happened in the running Session. */
  onAlerts(fn: (alerts: Alert[]) => void): () => void;
  /** Every Alert still on record, newest first. Survives a restart. */
  alertHistory(): Promise<Alert[]>;
  /** A native notification was clicked; open this Alert's evidence. */
  onOpenAlert(fn: (alert: Alert) => void): () => void;
  usage(): Promise<UsageSample | null>;
  /** Change how often the Allowance is polled. Clamped to the rate-limit floor. */
  setPollInterval(minutes: number): Promise<void>;
  /** Subscribe to poller readings. Returns an unsubscribe function. */
  onUsageSample(fn: (s: UsageSample) => void): () => void;
  /** A cache deadline per running Session. Empty when none has a prefix worth watching. */
  cacheClocks(): Promise<CacheClock[]>;
  /** Pushed on every change to any running Session, so the countdowns stay true. */
  onCacheClocks(fn: (clocks: CacheClock[]) => void): () => void;
  /** What Loupe is allowed to do unattended. */
  toolsConfig(): Promise<ToolsConfig>;
  setToolsConfig(config: ToolsConfig): Promise<void>;
  /** Run an action against one running Session now, from a button. */
  runAction(kind: ActionKind, sessionId: string): Promise<RunRecord>;
  /** Everything Loupe has run or declined to run, newest first. */
  runs(): Promise<RunRecord[]>;
  onRun(fn: (record: RunRecord) => void): () => void;
  /** What starting a Session costs in each project. */
  startup(): Promise<StartupCost[]>;
  /** The context size compaction has been seen at, measured from your own history. */
  threshold(): Promise<Threshold>;
  /** An expiry notification was clicked; show the Tools screen. */
  onOpenTools(fn: () => void): () => void;

  /** The running version and whatever the updater is currently doing. */
  updateState(): Promise<UpdateState>;
  /** Ask GitHub now rather than waiting for the next scheduled check. */
  checkForUpdates(): Promise<void>;
  /** Quit and swap in the downloaded version. Does nothing unless one is ready. */
  installUpdate(): Promise<void>;
  onUpdate(fn: (status: UpdateStatus) => void): () => void;
  platform: NodeJS.Platform;
}

declare global {
  interface Window {
    loupe: LoupeBridge;
  }
}
