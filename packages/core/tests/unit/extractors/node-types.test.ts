import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { analyzeRepository } from '../../../src/core/orchestrator'
import type { CodeNode, CodeNodeType, SystemTopology } from '../../../src/types/topology'

const FIXTURES_DIR = join(__dirname, '../../fixtures')

function collectAll(nodes: CodeNode[], type: CodeNodeType): CodeNode[] {
  const result: CodeNode[] = []
  for (const n of nodes) {
    if (n.type === type) result.push(n)
    if (n.children?.length) result.push(...collectAll(n.children, type))
  }
  return result
}

function allCodeNodes(topology: SystemTopology): CodeNode[] {
  const nodes: CodeNode[] = []
  for (const service of topology.services) {
    nodes.push(...service.endpoints)
    nodes.push(...service.functions)
    nodes.push(...(service.globals ?? []))
  }
  return nodes
}

function collectByType(topology: SystemTopology, type: CodeNodeType): CodeNode[] {
  return collectAll(allCodeNodes(topology), type)
}

describe('node-types — Go full-app', () => {
  let topology: SystemTopology

  it('analyzes without error', async () => {
    topology = await analyzeRepository(join(FIXTURES_DIR, 'go/full-app'), {
      skipTests: false,
      onProgress: () => {},
    })
    expect(topology).toBeDefined()
    expect(topology.services.length).toBeGreaterThanOrEqual(1)
  })

  it('extracts endpoint nodes', () => {
    const endpoints = collectByType(topology, 'endpoint')
    expect(endpoints.length, 'Go: no endpoints found').toBeGreaterThan(0)
  })

  it('extracts function nodes', () => {
    const fns = collectByType(topology, 'function')
    expect(fns.length, 'Go: no functions found').toBeGreaterThan(0)
  })

  it('extracts flowControl nodes (if/for/switch)', () => {
    const flow = collectByType(topology, 'flowControl')
    expect(flow.length, 'Go: no flowControl nodes found').toBeGreaterThan(0)
  })

  it('extracts return nodes', () => {
    const returns = collectByType(topology, 'return')
    expect(returns.length, 'Go: no return nodes found').toBeGreaterThan(0)
  })

  it('extracts throw nodes (panic)', () => {
    const throws = collectByType(topology, 'throw')
    expect(throws.length, 'Go: no throw/panic nodes found').toBeGreaterThan(0)
  })

  it('extracts log nodes', () => {
    const logs = collectByType(topology, 'log')
    expect(logs.length, 'Go: no log nodes found').toBeGreaterThan(0)
  })

  it('extracts call nodes', () => {
    const calls = collectByType(topology, 'call')
    expect(calls.length, 'Go: no call nodes found').toBeGreaterThan(0)
  })

  it('extracts dbProcess nodes (GORM)', () => {
    const dbNodes = collectByType(topology, 'dbProcess')
    expect(dbNodes.length, 'Go: no dbProcess nodes found').toBeGreaterThan(0)
  })

  it('extracts event nodes (Kafka)', () => {
    const events = collectByType(topology, 'event')
    expect(events.length, 'Go: no event nodes found').toBeGreaterThan(0)
  })

  it('detects database resource', () => {
    expect(topology.databases.length, 'Go: no databases detected').toBeGreaterThan(0)
  })

  it('detects broker resource', () => {
    expect(topology.brokers.length, 'Go: no brokers detected').toBeGreaterThan(0)
  })
})

describe('node-types — Java full-app', () => {
  let topology: SystemTopology

  it('analyzes without error', async () => {
    topology = await analyzeRepository(join(FIXTURES_DIR, 'java/full-app'), {
      skipTests: false,
      onProgress: () => {},
    })
    expect(topology).toBeDefined()
    expect(topology.services.length).toBeGreaterThanOrEqual(1)
  })

  it('extracts endpoint nodes (Spring)', () => {
    const endpoints = collectByType(topology, 'endpoint')
    expect(endpoints.length, 'Java: no endpoints found').toBeGreaterThan(0)
  })

  it('extracts function nodes', () => {
    const fns = collectByType(topology, 'function')
    expect(fns.length, 'Java: no functions found').toBeGreaterThan(0)
  })

  it('extracts flowControl nodes (if/switch/for)', () => {
    const flow = collectByType(topology, 'flowControl')
    expect(flow.length, 'Java: no flowControl nodes found').toBeGreaterThan(0)
  })

  it('extracts return nodes', () => {
    const returns = collectByType(topology, 'return')
    expect(returns.length, 'Java: no return nodes found').toBeGreaterThan(0)
  })

  it('extracts throw nodes', () => {
    const throws = collectByType(topology, 'throw')
    expect(throws.length, 'Java: no throw nodes found').toBeGreaterThan(0)
  })

  it('extracts log nodes (SLF4J)', () => {
    const logs = collectByType(topology, 'log')
    expect(logs.length, 'Java: no log nodes found').toBeGreaterThan(0)
  })

  it('extracts call nodes', () => {
    const calls = collectByType(topology, 'call')
    expect(calls.length, 'Java: no call nodes found').toBeGreaterThan(0)
  })

  it('extracts dbProcess nodes (JPA)', () => {
    const dbNodes = collectByType(topology, 'dbProcess')
    expect(dbNodes.length, 'Java: no dbProcess nodes found').toBeGreaterThan(0)
  })

  it('extracts event nodes (Kafka)', () => {
    const events = collectByType(topology, 'event')
    expect(events.length, 'Java: no event nodes found').toBeGreaterThan(0)
  })

  it('detects database resource (JPA)', () => {
    expect(topology.databases.length, 'Java: no databases detected').toBeGreaterThan(0)
  })

  it('detects broker resource (Kafka)', () => {
    expect(topology.brokers.length, 'Java: no brokers detected').toBeGreaterThan(0)
  })
})

describe('node-types — Python full-app', () => {
  let topology: SystemTopology

  it('analyzes without error', async () => {
    topology = await analyzeRepository(join(FIXTURES_DIR, 'python/full-app'), {
      skipTests: false,
      onProgress: () => {},
    })
    expect(topology).toBeDefined()
    expect(topology.services.length).toBeGreaterThanOrEqual(1)
  })

  it('extracts endpoint nodes (FastAPI)', () => {
    const endpoints = collectByType(topology, 'endpoint')
    expect(endpoints.length, 'Python: no endpoints found').toBeGreaterThan(0)
  })

  it('extracts function nodes', () => {
    const fns = collectByType(topology, 'function')
    expect(fns.length, 'Python: no functions found').toBeGreaterThan(0)
  })

  it('extracts flowControl nodes (if/for)', () => {
    const flow = collectByType(topology, 'flowControl')
    expect(flow.length, 'Python: no flowControl nodes found').toBeGreaterThan(0)
  })

  it('extracts return nodes', () => {
    const returns = collectByType(topology, 'return')
    expect(returns.length, 'Python: no return nodes found').toBeGreaterThan(0)
  })

  it('extracts throw nodes (raise)', () => {
    const throws = collectByType(topology, 'throw')
    expect(throws.length, 'Python: no throw/raise nodes found').toBeGreaterThan(0)
  })

  it('extracts log nodes (logging)', () => {
    const logs = collectByType(topology, 'log')
    expect(logs.length, 'Python: no log nodes found').toBeGreaterThan(0)
  })

  it('extracts call nodes', () => {
    const calls = collectByType(topology, 'call')
    expect(calls.length, 'Python: no call nodes found').toBeGreaterThan(0)
  })

  it('extracts dbProcess nodes (SQLAlchemy)', () => {
    const dbNodes = collectByType(topology, 'dbProcess')
    expect(dbNodes.length, 'Python: no dbProcess nodes found').toBeGreaterThan(0)
  })

  it('extracts event nodes (Kafka)', () => {
    const events = collectByType(topology, 'event')
    expect(events.length, 'Python: no event nodes found').toBeGreaterThan(0)
  })

  it('detects database resource', () => {
    expect(topology.databases.length, 'Python: no databases detected').toBeGreaterThan(0)
  })

  it('detects broker resource (Kafka)', () => {
    expect(topology.brokers.length, 'Python: no brokers detected').toBeGreaterThan(0)
  })
})

describe('node-types — TypeScript full-app', () => {
  let topology: SystemTopology

  it('analyzes without error', async () => {
    topology = await analyzeRepository(join(FIXTURES_DIR, 'ts/full-app'), {
      skipTests: false,
      onProgress: () => {},
    })
    expect(topology).toBeDefined()
    expect(topology.services.length).toBeGreaterThanOrEqual(1)
  })

  it('extracts endpoint nodes (NestJS)', () => {
    const endpoints = collectByType(topology, 'endpoint')
    expect(endpoints.length, 'TS: no endpoints found').toBeGreaterThan(0)
  })

  it('extracts function nodes', () => {
    const fns = collectByType(topology, 'function')
    expect(fns.length, 'TS: no functions found').toBeGreaterThan(0)
  })

  it('extracts flowControl nodes (if/for)', () => {
    const flow = collectByType(topology, 'flowControl')
    expect(flow.length, 'TS: no flowControl nodes found').toBeGreaterThan(0)
  })

  it('extracts return nodes', () => {
    const returns = collectByType(topology, 'return')
    expect(returns.length, 'TS: no return nodes found').toBeGreaterThan(0)
  })

  it('extracts throw nodes', () => {
    const throws = collectByType(topology, 'throw')
    expect(throws.length, 'TS: no throw nodes found').toBeGreaterThan(0)
  })

  it('extracts log nodes (winston)', () => {
    const logs = collectByType(topology, 'log')
    expect(logs.length, 'TS: no log nodes found').toBeGreaterThan(0)
  })

  it('extracts call nodes', () => {
    const calls = collectByType(topology, 'call')
    expect(calls.length, 'TS: no call nodes found').toBeGreaterThan(0)
  })

  it('extracts dbProcess nodes (Prisma)', () => {
    const dbNodes = collectByType(topology, 'dbProcess')
    expect(dbNodes.length, 'TS: no dbProcess nodes found').toBeGreaterThan(0)
  })

  it('extracts event nodes (EventEmitter2)', () => {
    const events = collectByType(topology, 'event')
    expect(events.length, 'TS: no event nodes found').toBeGreaterThan(0)
  })

  it('extracts telemetry nodes (OpenTelemetry)', () => {
    const telemetry = collectByType(topology, 'telemetry')
    expect(telemetry.length, 'TS: no telemetry nodes found').toBeGreaterThan(0)
  })

  it('extracts data nodes (interfaces/types)', () => {
    const data = collectByType(topology, 'data')
    expect(data.length, 'TS: no data nodes found').toBeGreaterThan(0)
  })

  it('detects database resource (Prisma)', () => {
    expect(topology.databases.length, 'TS: no databases detected').toBeGreaterThan(0)
  })
})
