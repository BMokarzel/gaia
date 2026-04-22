import type { EndpointNode, ServiceNode, SystemTopology, FunctionNode, CallNode, ThrowNode, DbProcessNode } from '@/types/topology'
import { fetchDescribe, type EndpointContext, type ServiceContext, type ExportDependency, type ExportResponse } from '@/api/export.api'

// ─────────────────────────────────────────────────────────────────────────────
// Topology helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collect all HTTP responses (returns + throws) recursively, including
 * following resolved function calls so that errors thrown in called services
 * (e.g. BadRequestException in UsersService.validate) are captured.
 */
function collectResponses(
  nodes: any[],
  functions: FunctionNode[],
  visited = new Set<string>(),
): ExportResponse[] {
  const seen = new Map<number, ExportResponse>()

  const walk = (ns: any[]) => {
    for (const n of ns) {
      if (n.type === 'return') {
        const status: number = n.metadata?.httpStatus ?? 200
        if (!seen.has(status)) {
          const desc = n.metadata?.responseType ?? n.metadata?.value?.slice(0, 60)
          seen.set(status, { status, description: desc, kind: 'return' })
        }
      }
      if (n.type === 'throw') {
        const t = n as ThrowNode
        const status: number = t.metadata.httpStatus ?? 500
        if (!seen.has(status)) {
          const desc = t.metadata.errorClass
            ? `${t.metadata.errorClass}${t.metadata.message ? ': ' + t.metadata.message : ''}`
            : undefined
          seen.set(status, { status, description: desc, kind: 'throw' })
        }
      }
      // Follow resolved calls into their function bodies
      if (n.type === 'call' && n.metadata?.resolvedTo && !visited.has(n.metadata.resolvedTo)) {
        const fn = functions.find(f => f.id === n.metadata.resolvedTo)
        if (fn) {
          visited.add(fn.id)
          walk(fn.children)
        }
      }
      if (n.children?.length) walk(n.children)
      if (n.metadata?.branches) n.metadata.branches.forEach((b: any) => walk(b.children ?? []))
    }
  }

  walk(nodes)
  return [...seen.values()].sort((a, b) => a.status - b.status)
}

function collectDependencies(nodes: any[], functions: FunctionNode[], visited = new Set<string>()): ExportDependency[] {
  const deps = new Map<string, ExportDependency>()

  const walk = (ns: any[]) => {
    for (const n of ns) {
      if (n.type === 'dbProcess') {
        const db = n as DbProcessNode
        const key = db.metadata.tableId ?? db.metadata.databaseId ?? 'db'
        if (!deps.has(key)) deps.set(key, { kind: 'database', name: key, operations: [] })
        if (db.metadata.operation && !deps.get(key)!.operations!.includes(db.metadata.operation))
          deps.get(key)!.operations!.push(db.metadata.operation)
      }
      if (n.type === 'call') {
        const c = n as CallNode
        const callee = c.metadata?.callee ?? c.name ?? ''
        if (c.metadata?.resolvedTo && !visited.has(c.metadata.resolvedTo)) {
          const fn = functions.find(f => f.id === c.metadata.resolvedTo)
          if (fn) { visited.add(fn.id); walk(fn.children) }
        } else if (!c.metadata?.resolvedTo && callee.includes('.') && !callee.startsWith('this.')) {
          if (!deps.has(callee)) deps.set(callee, { kind: 'service', name: callee })
        }
      }
      if (n.children?.length) walk(n.children)
      if (n.metadata?.branches) n.metadata.branches.forEach((b: any) => walk(b.children ?? []))
    }
  }

  walk(nodes)
  return [...deps.values()]
}

/**
 * Build a detailed, hierarchical flow summary including variable names,
 * data transformations, DB operations, loops, conditions and call chains.
 */
function collectFlowSummary(fn: FunctionNode, functions: FunctionNode[], depth = 0): string[] {
  if (depth > 2) return []
  const steps: string[] = []

  const walk = (nodes: any[], indent = '') => {
    for (const n of nodes) {
      switch (n.type) {
        case 'data': {
          const val = n.metadata?.initialValue ? ` = ${n.metadata.initialValue.slice(0, 60)}` : ''
          const typ = n.metadata?.dataType ? ` (${n.metadata.dataType})` : ''
          const mut = n.metadata?.mutable ? 'var' : 'const'
          steps.push(`${indent}${mut} \`${n.name}\`${typ}${val}`)
          break
        }
        case 'process': {
          const desc = n.metadata?.description ?? n.metadata?.operator ?? n.name ?? ''
          steps.push(`${indent}${desc.slice(0, 80)}`)
          break
        }
        case 'call': {
          const c = n as CallNode
          const callee = c.metadata?.callee ?? c.name ?? 'call'
          const args = (c.metadata?.arguments ?? []).slice(0, 3).join(', ')
          const awaited = c.metadata?.awaited ? 'await ' : ''
          if (c.metadata?.resolvedTo) {
            const resolved = functions.find(f => f.id === c.metadata.resolvedTo)
            const humanName = resolved?.metadata?.llm?.humanName
            const inline = humanName ? ` → "${humanName}"` : ''
            steps.push(`${indent}${awaited}${callee}(${args})${inline}`)
            // Recurse into resolved function one level
            if (resolved && depth < 2) {
              const sub = collectFlowSummary(resolved, functions, depth + 1)
              sub.forEach(s => steps.push(`${indent}  ${s}`))
            }
          } else if (callee.includes('.')) {
            steps.push(`${indent}${awaited}${callee}(${args})`)
          }
          break
        }
        case 'dbProcess': {
          const db = n as DbProcessNode
          const op = db.metadata.operation ?? 'query'
          const table = db.metadata.tableId ?? db.metadata.databaseId ?? 'database'
          const fields = db.metadata.fields?.length ? ` [${db.metadata.fields.slice(0, 5).join(', ')}]` : ''
          const cond = db.metadata.conditions ? ` WHERE ${db.metadata.conditions}` : ''
          const awaited = db.metadata.async ? 'await ' : ''
          steps.push(`${indent}${awaited}${op} \`${table}\`${fields}${cond}`)
          break
        }
        case 'flowControl': {
          const kind = n.metadata?.kind ?? 'if'
          const cond = n.metadata?.condition ?? ''
          const isLoop = ['for', 'for_in', 'for_of', 'while', 'do_while'].includes(kind)
          steps.push(`${indent}${isLoop ? `loop (${kind}${cond ? ' ' + cond.slice(0, 60) : ''})` : `if (${cond.slice(0, 80)})`}`)
          if (n.metadata?.branches?.length) {
            for (const b of n.metadata.branches) {
              if (b.children?.length) {
                steps.push(`${indent}  → ${b.label ?? 'branch'}:`)
                walk(b.children, indent + '    ')
              }
            }
          } else if (n.children?.length) {
            walk(n.children, indent + '  ')
          }
          return // children already handled
        }
        case 'return': {
          const status = n.metadata?.httpStatus ?? 200
          const val = n.metadata?.value?.slice(0, 80)
          steps.push(`${indent}return HTTP ${status}${val ? ` — \`${val}\`` : ''}`)
          break
        }
        case 'throw': {
          const t = n as ThrowNode
          const msg = t.metadata.message ? ` "${t.metadata.message}"` : ''
          steps.push(`${indent}throw ${t.metadata.errorClass ?? 'Error'} (${t.metadata.httpStatus ?? 500})${msg}`)
          break
        }
        default:
          break
      }
      if (n.children?.length && !['flowControl', 'call'].includes(n.type)) walk(n.children, indent)
    }
  }

  walk(fn.children)
  return steps.slice(0, 30)
}

function resolveHandlerFn(endpoint: EndpointNode, functions: FunctionNode[]): FunctionNode | undefined {
  const fnChild = endpoint.children.find(c => c.type === 'function') as FunctionNode | undefined
  if (fnChild) return fnChild
  const epHash = endpoint.id.split(':')[1]
  return functions.find(f => f.id.split(':')[1] === epHash)
}

// ─────────────────────────────────────────────────────────────────────────────
// Context builders
// ─────────────────────────────────────────────────────────────────────────────

function buildEndpointContext(
  endpoint: EndpointNode,
  service: ServiceNode,
  topology: SystemTopology,
): EndpointContext {
  const req = endpoint.metadata.request ?? {}
  const params = [
    ...(req.params ?? []).map((p: any) => ({ name: p.name, in: 'path', type: p.type ?? 'string', optional: false })),
    ...(req.query ?? []).map((p: any) => ({ name: p.name, in: 'query', type: p.type ?? 'string', optional: !p.required })),
    ...(req.body ?? []).map((p: any) => ({ name: p.name, in: 'body', type: p.type ?? 'any', optional: !p.required })),
    ...(req.headers ?? []).map((p: any) => ({ name: p.name, in: 'header', type: 'string', optional: true })),
  ]

  const functions = service.functions ?? []
  const handler = resolveHandlerFn(endpoint, functions)
  const rootNodes = handler ? handler.children : endpoint.children

  const responses = collectResponses(rootNodes, functions)
  // If extractor didn't capture any response, add implicit 200
  if (responses.length === 0) responses.push({ status: 200, kind: 'return' })

  return {
    serviceName: service.name,
    serviceDescription: service.metadata?.llm?.description,
    method: endpoint.metadata.method,
    path: endpoint.metadata.path,
    controller: endpoint.metadata.controller,
    humanName: endpoint.metadata.llm?.humanName,
    existingDescription: endpoint.metadata.llm?.description,
    params,
    responses,
    throwStatuses: responses.filter(r => r.kind === 'throw').map(r => r.status),
    dependencies: collectDependencies(rootNodes, functions),
    flowSummary: handler ? collectFlowSummary(handler, functions) : [],
  }
}

function buildServiceContext(service: ServiceNode, topology: SystemTopology): ServiceContext {
  return {
    name: service.name,
    language: service.metadata?.language ?? '',
    framework: service.metadata?.framework ?? '',
    humanName: service.metadata?.llm?.humanName,
    existingDescription: service.metadata?.llm?.description,
    endpoints: service.endpoints.map(ep => ({
      method: ep.metadata.method,
      path: ep.metadata.path,
      humanName: ep.metadata.llm?.humanName,
      description: ep.metadata.llm?.description,
    })),
    databases: topology.databases?.map(d => d.name) ?? [],
    brokers: topology.brokers?.map((b: any) => b.name) ?? [],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown builders
// ─────────────────────────────────────────────────────────────────────────────

function mdTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return ''
  const head = `| ${headers.join(' | ')} |`
  const sep  = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map(r => `| ${r.join(' | ')} |`).join('\n')
  return [head, sep, body].join('\n')
}

function buildInputsSection(ctx: EndpointContext): string {
  const pathParams   = ctx.params.filter(p => p.in === 'path')
  const queryParams  = ctx.params.filter(p => p.in === 'query')
  const bodyParams   = ctx.params.filter(p => p.in === 'body')
  const headerParams = ctx.params.filter(p => p.in === 'header')

  const parts: string[] = []
  if (pathParams.length) {
    parts.push('### Path Parameters')
    parts.push(mdTable(['Parameter', 'Type'], pathParams.map(p => [p.name, p.type])))
  }
  if (queryParams.length) {
    parts.push('### Query Parameters')
    parts.push(mdTable(['Parameter', 'Required', 'Type'], queryParams.map(p => [p.name, p.optional ? 'No' : 'Yes', p.type])))
  }
  if (bodyParams.length) {
    parts.push('### Request Body')
    parts.push(mdTable(['Field', 'Required', 'Type'], bodyParams.map(p => [p.name, p.optional ? 'No' : 'Yes', p.type])))
  }
  if (headerParams.length) {
    parts.push('### Headers')
    parts.push(mdTable(['Header', 'Type'], headerParams.map(p => [p.name, p.type])))
  }
  return parts.join('\n\n') || '_No parameters_'
}

function buildOutputsSection(ctx: EndpointContext): string {
  if (ctx.responses.length === 0) return '_Not documented_'
  return mdTable(
    ['Status', 'Type', 'Description'],
    ctx.responses.map(r => [
      `**${r.status}**`,
      r.kind === 'throw' ? '`error`' : '`success`',
      r.description ?? '',
    ]),
  )
}

function drawioNote(filename: string): string {
  return [
    '> **⚠️ Draw.io diagram**',
    `> Attach \`${filename}.drawio\` as an attachment to this Confluence page,`,
    '> then insert a **draw.io** macro pointing to that file.',
  ].join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export async function buildEndpointDoc(
  endpoint: EndpointNode,
  service: ServiceNode,
  topology: SystemTopology,
  diagramFilename: string,
): Promise<string> {
  const ctx = buildEndpointContext(endpoint, service, topology)
  const sections = await fetchDescribe('endpoint', ctx)

  const title = ctx.humanName ?? `${ctx.method} ${ctx.path}`
  const lines: string[] = [
    `# ${title}`,
    '',
    `> **Service:** ${ctx.serviceName}${ctx.controller ? ` · **Controller:** ${ctx.controller}` : ''} · \`${ctx.method} ${ctx.path}\``,
    '',
    '---',
    '',
    drawioNote(diagramFilename),
    '',
    '---',
    '',
    '## Overview',
    sections.overview ?? '_Not available_',
    '',
    '## Inputs',
    buildInputsSection(ctx),
    '',
    '## Outputs',
    sections.outputs ?? buildOutputsSection(ctx),
    '',
  ]

  if (sections.flowDescription) lines.push('## Flow Description', sections.flowDescription, '')
  if (sections.errorHandling)   lines.push('## Error Handling',   sections.errorHandling, '')
  if (sections.dependencies)    lines.push('## Dependencies',     sections.dependencies, '')

  return lines.join('\n')
}

export async function buildServiceDoc(
  service: ServiceNode,
  topology: SystemTopology,
  diagramFilename: string,
): Promise<string> {
  const ctx = buildServiceContext(service, topology)
  const sections = await fetchDescribe('service', ctx)

  const title = ctx.humanName ?? ctx.name
  const epTable = mdTable(
    ['Method', 'Path', 'Description'],
    ctx.endpoints.map(e => [
      `\`${e.method}\``,
      `\`${e.path}\``,
      e.humanName ?? e.description ?? '',
    ]),
  )

  const lines: string[] = [
    `# ${title}`,
    '',
    `> **Language:** ${ctx.language} · **Framework:** ${ctx.framework}`,
    '',
    '---',
    '',
    drawioNote(diagramFilename),
    '',
    '---',
    '',
    '## Service Description',
    sections.serviceDescription ?? '_Not available_',
    '',
    '## Endpoints',
    epTable,
    '',
  ]

  if (sections.architectureNotes) lines.push('## Architecture Notes', sections.architectureNotes, '')

  return lines.join('\n')
}
