import { describe, it, expect, beforeAll } from 'vitest'
import { join } from 'path'
import { analyzeRepository } from '../../../src/core/orchestrator'
import type { SystemTopology } from '../../../src/types/topology'
import { assertNoDiagnosticErrors } from './helpers'

const MONOREPO = join(__dirname, '../../fixtures/shop-system')

describe('shop-system: full topology merge', () => {
  let topology: SystemTopology

  beforeAll(async () => {
    topology = await analyzeRepository(MONOREPO, { skipTests: false, onProgress: () => {} })
  }, 120_000)

  // ── Basic structure ──────────────────────────────────────────────────────

  it('detects all 4 services', () => {
    expect(topology.services.length).toBe(4)
    const names = topology.services.map(s => s.name)
    expect(names).toContain('user-service')
    expect(names).toContain('order-service')
    expect(names).toContain('notification-service')
    expect(names).toContain('api-gateway')
  })

  it('has no diagnostic errors', () => {
    assertNoDiagnosticErrors(topology, 'full topology')
  })

  it('has no duplicate top-level IDs', () => {
    const ids = [
      ...topology.services.map(s => s.id),
      ...topology.databases.map(d => d.id),
      ...topology.brokers.map(b => b.id),
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('all edge references resolve to known nodes', () => {
    const nodeIds = new Set<string>([
      ...topology.services.map(s => s.id),
      ...topology.databases.map(d => d.id),
      ...topology.brokers.map(b => b.id),
    ])
    for (const s of topology.services) {
      for (const n of [...s.endpoints, ...s.functions, ...(s.globals ?? [])]) {
        nodeIds.add(n.id)
      }
    }
    for (const edge of topology.edges) {
      expect(nodeIds.has(edge.source), `edge source not found: ${edge.source}`).toBe(true)
      expect(nodeIds.has(edge.target), `edge target not found: ${edge.target}`).toBe(true)
    }
  })

  // ── Broker ───────────────────────────────────────────────────────────────

  it('merges Kafka into a single broker', () => {
    const kafkas = topology.brokers.filter(b => b.metadata.engine === 'kafka')
    expect(kafkas.length).toBe(1)
  })

  it('Kafka broker has all 4 topics', () => {
    const kafka = topology.brokers.find(b => b.metadata.engine === 'kafka')!
    const names = kafka.metadata.topics.map(t => t.name)
    expect(names).toContain('user.created')
    expect(names).toContain('user.deleted')
    expect(names).toContain('order.placed')
    expect(names).toContain('order.shipped')
  })

  it('user.created topic has user-service as producer', () => {
    const kafka = topology.brokers.find(b => b.metadata.engine === 'kafka')!
    const topic = kafka.metadata.topics.find(t => t.name === 'user.created')
    expect(topic).toBeDefined()
    const userSvc = topology.services.find(s => s.name === 'user-service')!
    expect(topic!.producers.some(p => p === userSvc.id || p.includes('user'))).toBe(true)
  })

  // ── Database ─────────────────────────────────────────────────────────────

  it('detects at least one database', () => {
    expect(topology.databases.length).toBeGreaterThanOrEqual(1)
  })

  // ── Observability ─────────────────────────────────────────────────────────

  it('observability.logs is non-empty', () => {
    expect(topology.observability.logs.length).toBeGreaterThan(0)
  })

  it('observability.telemetry contains api-gateway spans', () => {
    expect(topology.observability.telemetry.length).toBeGreaterThan(0)
    const spans = topology.observability.telemetry.filter(t => t.metadata.kind === 'span')
    expect(spans.length).toBeGreaterThan(0)
  })

  it('coverage.endpointsTotal reflects all detected endpoints', () => {
    const totalFromServices = topology.services.reduce((sum, s) => sum + s.endpoints.length, 0)
    expect(topology.observability.coverage.endpointsTotal).toBe(totalFromServices)
  })
})
