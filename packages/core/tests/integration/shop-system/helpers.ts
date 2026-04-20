import type { SystemTopology, CodeNode, CodeNodeType } from '../../../src/types/topology'

export function collectAll(nodes: CodeNode[], type: CodeNodeType): CodeNode[] {
  const result: CodeNode[] = []
  for (const n of nodes) {
    if (n.type === type) result.push(n)
    if (n.children?.length) result.push(...collectAll(n.children, type))
  }
  return result
}

export function allServiceNodes(topology: SystemTopology): CodeNode[] {
  const nodes: CodeNode[] = []
  for (const s of topology.services) {
    nodes.push(...s.endpoints, ...s.functions, ...(s.globals ?? []))
  }
  return nodes
}

export function collectByType(topology: SystemTopology, type: CodeNodeType): CodeNode[] {
  return collectAll(allServiceNodes(topology), type)
}

export function assertNoDiagnosticErrors(topology: SystemTopology, label: string) {
  const errors = topology.diagnostics.filter(d => d.level === 'error')
  if (errors.length > 0) {
    throw new Error(`${label}: ${errors.length} diagnostic error(s):\n${errors.map(e => `  ${e.message}`).join('\n')}`)
  }
}

export function assertAllNestedNodes(topology: SystemTopology, label: string) {
  // These types must not appear at service root (globals) — they must be inside functions/endpoints
  const MUST_BE_NESTED: CodeNodeType[] = ['log', 'call', 'dbProcess', 'event', 'telemetry']
  for (const service of topology.services) {
    for (const global of (service.globals ?? [])) {
      if (MUST_BE_NESTED.includes(global.type as CodeNodeType)) {
        throw new Error(`${label}: node of type '${global.type}' found in service.globals (should be nested): ${global.name}`)
      }
    }
  }
}
