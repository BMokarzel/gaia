import { describe, it, expect, beforeAll } from 'vitest'
import { join } from 'path'
import { analyzeRepository } from '../../../src/core/orchestrator'
import type { SystemTopology } from '../../../src/types/topology'
import { collectByType, assertNoDiagnosticErrors } from './helpers'

const FIXTURE = join(__dirname, '../../fixtures/shop-system/order-service')

describe('shop-system: order-service (Java/Spring)', () => {
  let topology: SystemTopology

  beforeAll(async () => {
    topology = await analyzeRepository(FIXTURE, { skipTests: false, onProgress: () => {} })
  })

  it('analyzes without diagnostic errors', () => {
    assertNoDiagnosticErrors(topology, 'order-service')
    expect(topology.services.length).toBe(1)
    expect(topology.services[0].metadata.language).toBe('java')
  })

  it('detects Spring REST endpoints', () => {
    const endpoints = topology.services[0].endpoints
    expect(endpoints.length).toBeGreaterThanOrEqual(5)
    const methods = endpoints.map(e => e.metadata.method)
    expect(methods).toContain('GET')
    expect(methods).toContain('POST')
    expect(methods).toContain('DELETE')
  })

  it('extracts function nodes', () => {
    expect(collectByType(topology, 'function').length).toBeGreaterThan(0)
  })

  it('extracts flowControl nodes (if / switch / try-catch)', () => {
    const flow = collectByType(topology, 'flowControl')
    expect(flow.length).toBeGreaterThan(0)
  })

  it('extracts return nodes', () => {
    expect(collectByType(topology, 'return').length).toBeGreaterThan(0)
  })

  it('extracts throw nodes', () => {
    expect(collectByType(topology, 'throw').length).toBeGreaterThan(0)
  })

  it('extracts log nodes (SLF4J)', () => {
    const logs = collectByType(topology, 'log')
    expect(logs.length).toBeGreaterThan(0)
    const levels = logs.map(l => (l as any).metadata?.level)
    expect(levels).toContain('info')
  })

  it('extracts dbProcess nodes (JPA)', () => {
    expect(collectByType(topology, 'dbProcess').length).toBeGreaterThan(0)
  })

  it('extracts event nodes (Kafka producer + listener)', () => {
    const events = collectByType(topology, 'event')
    expect(events.length).toBeGreaterThan(0)
    const kinds = events.map(e => (e as any).metadata?.kind)
    expect(kinds.some(k => k === 'publish')).toBe(true)
    expect(kinds.some(k => k === 'subscribe')).toBe(true)
  })

  it('detects PostgreSQL database', () => {
    expect(topology.databases.length).toBeGreaterThanOrEqual(1)
  })

  it('detects Kafka broker with order topics', () => {
    expect(topology.brokers.length).toBeGreaterThanOrEqual(1)
    const kafka = topology.brokers.find(b => b.metadata.engine === 'kafka')
    expect(kafka).toBeDefined()
    const names = kafka!.metadata.topics.map(t => t.name)
    expect(names).toContain('order.placed')
    expect(names).toContain('order.shipped')
  })
})
