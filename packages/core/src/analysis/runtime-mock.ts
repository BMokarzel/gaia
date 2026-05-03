// ─────────────────────────────────────────────────────────────
// Mock runtime metrics provider (Fase 4).
//
// Generates plausible RPS / error / latency numbers from a topology's
// shape — useful as a fixture and for demos where Prometheus/OTel
// aren't wired up. Deterministic given the same seed: re-running with
// identical inputs returns identical output.
//
// Heuristics:
//   - Service kind biases RPS (gateways > services > workers).
//   - Number of incoming resolves_to edges multiplies RPS.
//   - Critical/standard/internal tier shifts baseline error rate.
//   - Edges inherit caller RPS with mild variance and occasional spikes.
//   - Alerts emitted past well-known thresholds.
// ─────────────────────────────────────────────────────────────

import type { SystemTopology } from '../types/topology';
import type {
  RuntimeMetrics, ServiceMetrics, EndpointMetrics, EdgeMetrics,
  RuntimeAlert, RuntimeWindow,
} from '../types/runtime';

export interface MockRuntimeOptions {
  /** Seed for the RNG; same seed → same numbers. Default: derived from topology id + window. */
  seed?: number;
  /** Window duration in ms. Default 5 minutes. */
  windowMs?: number;
  /** Optional now-override (ISO) — defaults to new Date(). Lets callers freeze time in tests. */
  now?: string;
  /**
   * Multiplier for the chaos toggle. 0 = pristine traffic, 1 = baseline,
   * 2+ = degraded. Default 1. Useful for "what if everything was on fire" demos.
   */
  chaos?: number;
}

const DEFAULT_WINDOW_MS = 5 * 60 * 1000;

// Thresholds for alert emission (loose; calibrated for demos rather than SRE).
const ERROR_RATE_WARN = 0.02;
const ERROR_RATE_CRIT = 0.10;
const P95_WARN_MS = 500;
const P95_CRIT_MS = 1500;
const SATURATED_CPU_PCT = 85;
const NO_TRAFFIC_RPS = 0.001;

/** Public entry point. */
export function generateMockRuntimeMetrics(
  topology: SystemTopology,
  topologyId: string,
  options: MockRuntimeOptions = {},
): RuntimeMetrics {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const nowInput = options.now ?? new Date().toISOString();
  const toMs = Date.parse(nowInput);
  // Normalize through Date so `toIso`/`fromIso` always have millisecond precision.
  const toIso = new Date(toMs).toISOString();
  const fromIso = new Date(toMs - windowMs).toISOString();
  const window: RuntimeWindow = { fromIso, toIso, durationMs: windowMs };
  const nowIso = toIso;

  const seed = options.seed ?? deriveSeed(topologyId + ':' + nowIso);
  const rng = mulberry32(seed);
  const chaos = Math.max(0, options.chaos ?? 1);

  // Pre-compute incoming edge counts to bias RPS by upstream fan-in.
  const incoming = new Map<string, number>();
  for (const e of topology.edges ?? []) {
    if (e.kind === 'resolves_to' || e.kind === 'depends_on') {
      const t = e.target;
      incoming.set(t, (incoming.get(t) ?? 0) + 1);
    }
  }

  const services: ServiceMetrics[] = [];
  const endpoints: EndpointMetrics[] = [];
  const alerts: RuntimeAlert[] = [];

  for (const svc of topology.services) {
    const baseRps = baseRpsForKind(svc.metadata.kind) * (1 + (incoming.get(svc.id) ?? 0) * 0.4);
    const tierMul = tierMultiplier(svc.metadata.tier);
    const rps = round(baseRps * jitter(rng, 0.7, 1.3) * chaos, 2);
    const errorRate = round(clamp(0.005 * tierMul * jitter(rng, 0.5, 4.0) * chaos, 0, 1), 4);
    const p50 = round(20 + rng() * 60, 1);
    const p95 = round(p50 * (2 + rng() * 4) * (chaos > 1 ? chaos : 1), 1);
    const p99 = round(p95 * (1.2 + rng() * 0.8), 1);
    const cpuPct = round(20 + rng() * 60 * (chaos), 1);
    const memMb = round(80 + rng() * 400, 0);
    const saturated = cpuPct > SATURATED_CPU_PCT;

    services.push({
      serviceId: svc.id,
      rps, errorRate, p50LatencyMs: p50, p95LatencyMs: p95, p99LatencyMs: p99,
      cpuPct, memMb, saturated,
    });

    pushServiceAlerts(svc.id, { rps, errorRate, p95, saturated }, alerts);

    // Endpoints — split parent's RPS roughly equally with jitter.
    const eps = svc.endpoints ?? [];
    const share = eps.length ? rps / eps.length : 0;
    for (const ep of eps) {
      const epRps = round(Math.max(0, share * jitter(rng, 0.4, 1.6)), 2);
      const epErr = round(clamp(errorRate * jitter(rng, 0.3, 2.5), 0, 1), 4);
      const epP50 = round(p50 * jitter(rng, 0.7, 1.4), 1);
      const epP95 = round(p95 * jitter(rng, 0.7, 1.6), 1);
      endpoints.push({
        endpointId: ep.id,
        serviceId: svc.id,
        rps: epRps,
        errorRate: epErr,
        p50LatencyMs: epP50,
        p95LatencyMs: epP95,
        topStatuses: pickStatuses(rng, ep.metadata.method, epErr),
      });
      pushEndpointAlerts(ep.id, svc.id, { rps: epRps, errorRate: epErr, p95: epP95 }, alerts);
    }
  }

  // Edges — derive from the topology's resolves_to / depends_on relationships.
  const svcRps = new Map(services.map(s => [s.serviceId, s.rps]));
  const svcErr = new Map(services.map(s => [s.serviceId, s.errorRate]));
  const edges: EdgeMetrics[] = [];
  for (const e of topology.edges ?? []) {
    if (e.kind !== 'resolves_to' && e.kind !== 'depends_on') continue;
    const callerRps = svcRps.get(e.source) ?? 0;
    const callerErr = svcErr.get(e.source) ?? 0;
    const rps = round(Math.max(0, callerRps * jitter(rng, 0.2, 0.9)), 2);
    const errorRate = round(clamp(callerErr * jitter(rng, 0.5, 2.0), 0, 1), 4);
    const p95LatencyMs = round(40 + rng() * 200 * chaos, 1);
    edges.push({ source: e.source, target: e.target, kind: e.kind, rps, errorRate, p95LatencyMs });
  }

  return {
    topologyId,
    window,
    source: 'mock',
    generatedAt: nowIso,
    services, endpoints, edges, alerts,
  };
}

// ── helpers ─────────────────────────────────────────────────────────

function pushServiceAlerts(
  id: string,
  m: { rps: number; errorRate: number; p95: number; saturated: boolean },
  alerts: RuntimeAlert[],
): void {
  if (m.errorRate >= ERROR_RATE_CRIT) {
    alerts.push({ kind: 'error_rate', severity: 'crit', targetKind: 'service', targetId: id,
      message: `service ${id} error rate ${(m.errorRate * 100).toFixed(1)}%`,
      value: m.errorRate, threshold: ERROR_RATE_CRIT });
  } else if (m.errorRate >= ERROR_RATE_WARN) {
    alerts.push({ kind: 'error_rate', severity: 'warn', targetKind: 'service', targetId: id,
      message: `service ${id} error rate ${(m.errorRate * 100).toFixed(1)}%`,
      value: m.errorRate, threshold: ERROR_RATE_WARN });
  }
  if (m.p95 >= P95_CRIT_MS) {
    alerts.push({ kind: 'latency', severity: 'crit', targetKind: 'service', targetId: id,
      message: `service ${id} p95 ${m.p95.toFixed(0)}ms`,
      value: m.p95, threshold: P95_CRIT_MS });
  } else if (m.p95 >= P95_WARN_MS) {
    alerts.push({ kind: 'latency', severity: 'warn', targetKind: 'service', targetId: id,
      message: `service ${id} p95 ${m.p95.toFixed(0)}ms`,
      value: m.p95, threshold: P95_WARN_MS });
  }
  if (m.saturated) {
    alerts.push({ kind: 'saturation', severity: 'warn', targetKind: 'service', targetId: id,
      message: `service ${id} CPU pegged`,
      value: 1, threshold: SATURATED_CPU_PCT / 100 });
  }
  if (m.rps < NO_TRAFFIC_RPS) {
    alerts.push({ kind: 'no_traffic', severity: 'info', targetKind: 'service', targetId: id,
      message: `service ${id} has no traffic`,
      value: m.rps, threshold: NO_TRAFFIC_RPS });
  }
}

function pushEndpointAlerts(
  id: string, svcId: string,
  m: { rps: number; errorRate: number; p95: number },
  alerts: RuntimeAlert[],
): void {
  if (m.errorRate >= ERROR_RATE_CRIT) {
    alerts.push({ kind: 'error_rate', severity: 'crit', targetKind: 'endpoint', targetId: id,
      message: `${svcId}/${id} error rate ${(m.errorRate * 100).toFixed(1)}%`,
      value: m.errorRate, threshold: ERROR_RATE_CRIT });
  }
  if (m.p95 >= P95_CRIT_MS) {
    alerts.push({ kind: 'latency', severity: 'crit', targetKind: 'endpoint', targetId: id,
      message: `${svcId}/${id} p95 ${m.p95.toFixed(0)}ms`,
      value: m.p95, threshold: P95_CRIT_MS });
  }
}

function baseRpsForKind(kind?: string): number {
  switch (kind) {
    case 'gateway': return 120;
    case 'bff': return 60;
    case 'frontend':
    case 'microfrontend': return 25;
    case 'backend': return 35;
    case 'worker': return 8;
    case 'cron': return 0.05;
    case 'mobile': return 15;
    default: return 20;
  }
}

function tierMultiplier(tier?: string): number {
  switch (tier) {
    case 'critical': return 0.6;
    case 'standard': return 1;
    case 'internal': return 1.4;
    default: return 1;
  }
}

function pickStatuses(rng: () => number, method: string | undefined, errRate: number): EndpointMetrics['topStatuses'] {
  const successCode = method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200;
  const success = clamp(1 - errRate, 0, 1);
  const fourFive = errRate * (rng() < 0.6 ? 0.7 : 0.3);
  const five = clamp(errRate - fourFive, 0, 1);
  return [
    { code: successCode, rate: round(success, 4) },
    { code: 400 + Math.floor(rng() * 4), rate: round(fourFive, 4) },
    { code: 500 + Math.floor(rng() * 4), rate: round(five, 4) },
  ].filter(s => s.rate > 0.0001);
}

function jitter(rng: () => number, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function round(v: number, decimals: number): number {
  const m = Math.pow(10, decimals);
  return Math.round(v * m) / m;
}

/** Mulberry32 — small, fast PRNG; deterministic given the seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable string → 32-bit hash (FNV-1a variant). */
function deriveSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
