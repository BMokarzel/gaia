import { describe, it, expect, beforeAll } from 'vitest'
import { join } from 'path'
import { analyzeRepository } from '../../../src/core/orchestrator'
import type { SystemTopology } from '../../../src/types/topology'
import { collectByType, assertNoDiagnosticErrors } from './helpers'

const FIXTURE = join(__dirname, '../../fixtures/shop-system/notification-service')

describe('shop-system: notification-service (Python/FastAPI)', () => {
  let topology: SystemTopology

  beforeAll(async () => {
    topology = await analyzeRepository(FIXTURE, { skipTests: false, onProgress: () => {} })
  })

  it('analyzes without diagnostic errors', () => {
    assertNoDiagnosticErrors(topology, 'notification-service')
    expect(topology.services.length).toBe(1)
    expect(topology.services[0].metadata.language).toBe('python')
  })

  it('detects HTTP endpoints', () => {
    const endpoints = topology.services[0].endpoints
    expect(endpoints.length).toBeGreaterThanOrEqual(2)
  })

  it('extracts function nodes', () => {
    expect(collectByType(topology, 'function').length).toBeGreaterThan(0)
  })

  it('extracts flowControl nodes (if / for / try)', () => {
    const flow = collectByType(topology, 'flowControl')
    expect(flow.length).toBeGreaterThan(0)
  })

  it('extracts return nodes', () => {
    expect(collectByType(topology, 'return').length).toBeGreaterThan(0)
  })

  it('extracts throw nodes (raise)', () => {
    const throws = collectByType(topology, 'throw')
    expect(throws.length).toBeGreaterThan(0)
  })

  it('extracts log nodes (logging)', () => {
    const logs = collectByType(topology, 'log')
    expect(logs.length).toBeGreaterThan(0)
    const levels = logs.map(l => (l as any).metadata?.level)
    expect(levels.some(l => ['info', 'log'].includes(l))).toBe(true)
  })

  it('extracts dbProcess nodes (SQLAlchemy)', () => {
    const db = collectByType(topology, 'dbProcess')
    expect(db.length).toBeGreaterThan(0)
  })

  it('extracts event nodes (Kafka consumer)', () => {
    const events = collectByType(topology, 'event')
    expect(events.length).toBeGreaterThan(0)
  })

  it('detects PostgreSQL database', () => {
    expect(topology.databases.length).toBeGreaterThanOrEqual(1)
  })

  it('detects Kafka broker', () => {
    expect(topology.brokers.length).toBeGreaterThanOrEqual(1)
  })
})
