import { describe, it, expect, beforeAll } from 'vitest'
import { join } from 'path'
import { analyzeRepository } from '../../../src/core/orchestrator'
import type { SystemTopology } from '../../../src/types/topology'
import { collectByType, assertNoDiagnosticErrors, assertAllNestedNodes } from './helpers'

const FIXTURE = join(__dirname, '../../fixtures/shop-system/user-service')

describe('shop-system: user-service (Go/Gin)', () => {
  let topology: SystemTopology

  beforeAll(async () => {
    topology = await analyzeRepository(FIXTURE, { skipTests: false, onProgress: () => {} })
  })

  it('analyzes without diagnostic errors', () => {
    assertNoDiagnosticErrors(topology, 'user-service')
    expect(topology.services.length).toBe(1)
    expect(topology.services[0].metadata.language).toBe('go')
  })

  it('detects all 5 HTTP endpoints', () => {
    const endpoints = topology.services[0].endpoints
    expect(endpoints.length).toBeGreaterThanOrEqual(5)
    const methods = endpoints.map(e => e.metadata.method)
    expect(methods).toContain('GET')
    expect(methods).toContain('POST')
    expect(methods).toContain('DELETE')
  })

  it('extracts function nodes for all handlers', () => {
    const fns = collectByType(topology, 'function')
    expect(fns.length).toBeGreaterThanOrEqual(5)
    const names = fns.map(f => f.name)
    expect(names.some(n => /list|users/i.test(n))).toBe(true)
    expect(names.some(n => /create|user/i.test(n))).toBe(true)
  })

  it('extracts flowControl nodes (if / switch / for)', () => {
    const flow = collectByType(topology, 'flowControl')
    expect(flow.length).toBeGreaterThan(0)
    const kinds = flow.map(f => (f as any).metadata?.kind ?? '')
    expect(kinds.some(k => k === 'if')).toBe(true)
    expect(kinds.some(k => k === 'switch')).toBe(true)
  })

  it('extracts return nodes', () => {
    expect(collectByType(topology, 'return').length).toBeGreaterThan(0)
  })

  it('extracts throw nodes (panic)', () => {
    const throws = collectByType(topology, 'throw')
    expect(throws.length).toBeGreaterThan(0)
    expect(throws.some(t => (t as any).metadata?.kind === 'panic')).toBe(true)
  })

  it('extracts log nodes (logrus)', () => {
    const logs = collectByType(topology, 'log')
    expect(logs.length).toBeGreaterThan(0)
    const levels = logs.map(l => (l as any).metadata?.level)
    expect(levels).toContain('info')
    expect(levels).toContain('error')
    expect(levels).toContain('warn')
  })

  it('extracts dbProcess nodes (GORM)', () => {
    const db = collectByType(topology, 'dbProcess')
    expect(db.length).toBeGreaterThan(0)
    const ops = db.map(d => (d as any).metadata?.operation)
    expect(ops.some(o => ['findMany', 'findFirst', 'create', 'delete', 'update', 'upsert'].includes(o))).toBe(true)
  })

  it('extracts event nodes (Kafka publish)', () => {
    const events = collectByType(topology, 'event')
    expect(events.length).toBeGreaterThan(0)
    const names = events.map(e => e.name)
    expect(names.some(n => n.includes('user.created'))).toBe(true)
    expect(names.some(n => n.includes('user.deleted'))).toBe(true)
  })

  it('detects PostgreSQL database', () => {
    expect(topology.databases.length).toBeGreaterThanOrEqual(1)
    expect(topology.databases.some(d => d.metadata.category === 'sql')).toBe(true)
  })

  it('detects Kafka broker with user topics', () => {
    expect(topology.brokers.length).toBeGreaterThanOrEqual(1)
    const kafka = topology.brokers.find(b => b.metadata.engine === 'kafka')
    expect(kafka).toBeDefined()
    const topicNames = kafka!.metadata.topics.map(t => t.name)
    expect(topicNames).toContain('user.created')
    expect(topicNames).toContain('user.deleted')
  })

  it('all log/call/dbProcess/event nodes are nested inside functions', () => {
    assertAllNestedNodes(topology, 'user-service')
  })
})
