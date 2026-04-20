import { describe, it, expect, beforeAll } from 'vitest'
import { join } from 'path'
import { analyzeRepository } from '../../../src/core/orchestrator'
import type { SystemTopology } from '../../../src/types/topology'
import { collectByType, assertNoDiagnosticErrors } from './helpers'

const FIXTURE = join(__dirname, '../../fixtures/shop-system/api-gateway')

describe('shop-system: api-gateway (TypeScript/NestJS)', () => {
  let topology: SystemTopology

  beforeAll(async () => {
    topology = await analyzeRepository(FIXTURE, { skipTests: false, onProgress: () => {} })
  })

  it('analyzes without diagnostic errors', () => {
    assertNoDiagnosticErrors(topology, 'api-gateway')
    expect(topology.services.length).toBe(1)
    expect(topology.services[0].metadata.language).toBe('typescript')
  })

  it('detects NestJS endpoints', () => {
    expect(topology.services[0].endpoints.length).toBeGreaterThanOrEqual(5)
  })

  it('extracts function nodes', () => {
    expect(collectByType(topology, 'function').length).toBeGreaterThan(0)
  })

  it('extracts flowControl nodes', () => {
    expect(collectByType(topology, 'flowControl').length).toBeGreaterThan(0)
  })

  it('extracts return nodes', () => {
    expect(collectByType(topology, 'return').length).toBeGreaterThan(0)
  })

  it('extracts throw nodes', () => {
    expect(collectByType(topology, 'throw').length).toBeGreaterThan(0)
  })

  it('extracts log nodes (winston)', () => {
    const logs = collectByType(topology, 'log')
    expect(logs.length).toBeGreaterThan(0)
  })

  it('extracts call nodes (fetch to upstream services)', () => {
    const calls = collectByType(topology, 'call')
    expect(calls.length).toBeGreaterThan(0)
  })

  it('extracts dbProcess nodes (Prisma)', () => {
    expect(collectByType(topology, 'dbProcess').length).toBeGreaterThan(0)
  })

  it('extracts event nodes (EventEmitter2)', () => {
    expect(collectByType(topology, 'event').length).toBeGreaterThan(0)
  })

  it('extracts telemetry nodes (OpenTelemetry spans + metrics)', () => {
    const tel = collectByType(topology, 'telemetry')
    expect(tel.length).toBeGreaterThan(0)
    const kinds = tel.map(t => (t as any).metadata?.kind)
    expect(kinds.some(k => k === 'span')).toBe(true)
  })

  it('extracts data nodes (interfaces and enums from types.ts)', () => {
    expect(collectByType(topology, 'data').length).toBeGreaterThan(0)
  })

  it('detects Prisma database', () => {
    expect(topology.databases.length).toBeGreaterThanOrEqual(1)
  })
})
