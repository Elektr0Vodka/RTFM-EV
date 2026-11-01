// Shapes of GET /api/perf/snapshot and GET /api/perf/history (app/perf/).

export type PerfRange = 'live' | '15m' | '1h' | '6h' | '24h' | '7d' | '30d';

export interface PerfSummary {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
  avg: number | null;
}

export interface PerfPoint {
  ts: number;
  cpu: number | null;
  rss_mb: number | null;
  lag_p50: number | null;
  lag_p95: number | null;
  lag_max: number | null;
  tasks: number | null;
  pkts: number | null;
  db_p95: number | null;
  radio_p95: number | null;
  http_p95: number | null;
  stalls: number | null;
  warnings: number | null;
}

export interface PerfHistory {
  range: PerfRange;
  step_s: number;
  points: PerfPoint[];
}

export type PerfHealthState = 'ok' | 'degraded' | 'critical';

export interface PerfReason {
  key: string;
  detail: string;
  severity: PerfHealthState;
}

export interface PerfProcess {
  pid: number;
  python: string;
  platform: string;
  started_at: number;
  uptime_s: number;
  cpu_percent: number | null;
  cpu_seconds: number;
  rss_mb: number | null;
  threads: number | null;
  fds: number | null;
  load1: number | null;
  host_cores: number | null;
  host_mem_mb: number | null;
  mem_limit_mb: number | null;
}

export interface PerfStall {
  at: number;
  duration_ms: number | null;
  task: string | null;
  stack: string[];
}

export type PerfLoopState = 'ok' | 'running' | 'overdue' | 'idle' | 'error';

export interface PerfHourCell {
  runs: number;
  errors: number;
  max_ms: number | null;
}

export interface PerfLoopRow {
  name: string;
  state: PerfLoopState;
  every_s: number | null;
  running_since: number | null;
  last_start: number | null;
  last_duration_ms: number | null;
  p95_ms: number | null;
  runs: number;
  errors: number;
  last_error: string | null;
  last_error_at: number | null;
  hourly: PerfHourCell[];
}

export interface PerfStageMap {
  parse: PerfSummary;
  store: PerfSummary;
  process: PerfSummary;
  broadcast: PerfSummary;
  total: PerfSummary;
}

export interface PerfPipeline {
  per_minute: {
    received: number;
    duplicate: number;
    decrypted: number;
    undecrypted: number;
    malformed: number;
  };
  total_received: number;
  stages: PerfStageMap;
  by_type: { type: string; count: number; avg_process_ms: number | null }[];
  oldest_undecrypted: number | null;
}

export interface PerfDbCaller {
  caller: string;
  kind: 'read' | 'write';
  calls_last_hour: number;
  p95_ms: number | null;
  max_ms: number | null;
  wait_p95_ms: number | null;
  errors: number;
}

export interface PerfDatabase {
  calls_per_minute: number;
  read: { hold: PerfSummary; wait: PerfSummary };
  write: { hold: PerfSummary; wait: PerfSummary };
  slowest: PerfDbCaller[];
  file_mb: number | null;
  wal_mb: number | null;
  readers: number;
  readers_busy: number;
}

export interface PerfRadioOp {
  name: string;
  calls_last_hour: number;
  calls: number;
  p95_ms: number | null;
  max_ms: number | null;
  wait_p95_ms: number | null;
  errors: number;
  last_error: string | null;
}

export interface PerfRadioQueue {
  /** The operation holding the radio now, and for how long. */
  holder: { name: string; held_ms: number } | null;
  /** Operations waiting for the radio, oldest first. */
  waiting: { name: string; waited_ms: number }[];
}

export interface PerfRadio {
  connected: boolean;
  desired: boolean;
  connection_info: string | null;
  /** Absent from servers older than the live queue view. */
  queue?: PerfRadioQueue;
  hold: PerfSummary;
  ops: PerfRadioOp[];
  errors: number;
  reconnects: { attempts: number; ok: number };
  last_reconnect_at: number | null;
}

export interface PerfOutputModule {
  id: string;
  name: string;
  type: string;
  status: string;
  last_error: string | null;
  sent_last_hour?: number;
  p95_ms?: number | null;
  ok?: number;
  timeouts?: number;
  errors?: number;
  last_at?: number | null;
}

export interface PerfOutputs {
  modules: PerfOutputModule[];
  websocket_clients: number;
  tak_stream: { enabled: boolean; host: string | null; port: number | null; clients: number };
  push_subscriptions: number | null;
}

export interface PerfRouteRow {
  route: string;
  calls: number;
  p50_ms: number | null;
  p95_ms: number | null;
  max_ms: number | null;
  errors_5xx: number;
}

export interface PerfLogRecord {
  ts: number;
  level: string;
  logger: string;
  message: string;
}

export interface PerfSnapshot {
  generated_at: number;
  health: { state: PerfHealthState; reasons: PerfReason[] };
  process: PerfProcess;
  latest: PerfPoint | null;
  loop: { lag: PerfSummary; stalls: PerfStall[]; stalls_last_hour: number };
  tasks: PerfLoopRow[];
  asyncio_tasks: { name: string; count: number }[];
  pipeline: PerfPipeline;
  database: PerfDatabase;
  radio: PerfRadio;
  outputs: PerfOutputs;
  routes: { all: PerfSummary; routes: PerfRouteRow[] };
  logs: PerfLogRecord[];
}
