// ─────────────────────────────────────────────────────────────
// Runtime metrics shape (Fase 4).
//
// Live operational view of a topology — RPS, error rate, latency
// percentiles per service / endpoint / edge. Source-agnostic: a
// provider (Prometheus, OTel, Datadog, mock) populates these
// fields and the topology UI overlays them on the same graph it
// already renders for the logical view.
// ─────────────────────────────────────────────────────────────

export interface RuntimeWindow {
  /** ISO timestamp the window starts at. */
  fromIso: string;
  /** ISO timestamp the window ends at. */
  toIso: string;
  /** Duration in milliseconds — convenience derived from from/to. */
  durationMs: number;
}

export interface ServiceMetrics {
  serviceId: string;
  /** Requests per second across the window (avg). */
  rps: number;
  /** Fraction of requests that errored, 0..1. */
  errorRate: number;
  /** Latency percentiles, in milliseconds. */
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs?: number;
  /** Optional resource readings — providers may not have these. */
  cpuPct?: number;
  memMb?: number;
  /** Heuristic flag the provider sets when a service looks pegged. */
  saturated?: boolean;
}

export interface EndpointMetrics {
  endpointId: string;
  serviceId: string;
  rps: number;
  errorRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  /** Top status codes as a fraction of traffic — useful for distinguishing 4xx/5xx mixes. */
  topStatuses?: Array<{ code: number; rate: number }>;
}

export interface EdgeMetrics {
  /** Mirrors the topology's Edge.source — typically a service id. */
  source: string;
  /** Mirrors Edge.target — service id, db id, or external id. */
  target: string;
  /** Mirrors Edge.kind — e.g. "resolves_to", "depends_on". */
  kind: string;
  rps: number;
  errorRate: number;
  p95LatencyMs: number;
}

export type RuntimeAlertKind =
  | 'error_rate'
  | 'latency'
  | 'saturation'
  | 'no_traffic';

export type RuntimeAlertSeverity = 'info' | 'warn' | 'crit';

export interface RuntimeAlert {
  kind: RuntimeAlertKind;
  severity: RuntimeAlertSeverity;
  targetKind: 'service' | 'endpoint' | 'edge';
  targetId: string;
  /** Human-readable summary. */
  message: string;
  /** Observed value that tripped the alert (e.g. errorRate=0.12). */
  value: number;
  /** Threshold that was breached. */
  threshold: number;
}

export type RuntimeSource = 'mock' | 'prometheus' | 'datadog' | 'otel';

export interface RuntimeMetrics {
  topologyId: string;
  window: RuntimeWindow;
  source: RuntimeSource;
  /** When the provider produced this snapshot. */
  generatedAt: string;
  services: ServiceMetrics[];
  endpoints: EndpointMetrics[];
  edges: EdgeMetrics[];
  alerts: RuntimeAlert[];
}
