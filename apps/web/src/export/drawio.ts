import type { ExportGraph, ExportNode, ExportEdge } from '@/store/topologyStore'

// ── draw.io styles per node type ──────────────────────────────────────────
const STYLES: Record<string, string> = {
  endpoint:  'rounded=1;arcSize=50;whiteSpace=wrap;fillColor=#d5e8d4;strokeColor=#82b366;fontFamily=Courier New;fontSize=11;fontStyle=1;',
  function:  'rounded=1;whiteSpace=wrap;fillColor=#dae8fc;strokeColor=#6c8ebf;fontFamily=Courier New;fontSize=11;',
  control:   'rhombus;whiteSpace=wrap;fillColor=#fff2cc;strokeColor=#d6b656;fontFamily=Courier New;fontSize=11;',
  'return-ok':  'rounded=1;arcSize=50;whiteSpace=wrap;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=11;',
  'return-err': 'rounded=1;arcSize=50;whiteSpace=wrap;fillColor=#f8cecc;strokeColor=#b85450;fontColor=#b85450;fontSize=11;',
  database:  'shape=mxgraph.flowchart.database;whiteSpace=wrap;fillColor=#dae8fc;strokeColor=#6c8ebf;',
  broker:    'shape=mxgraph.cisco.computers_and_peripherals.pc;whiteSpace=wrap;fillColor=#e1d5e7;strokeColor=#9673a6;',
  service:   'ellipse;whiteSpace=wrap;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=12;fontStyle=1;',
  frontend:  'rounded=1;whiteSpace=wrap;fillColor=#fff3cd;strokeColor=#d6b656;',
  data:      'rounded=1;whiteSpace=wrap;fillColor=#fff3cd;strokeColor=#d6b656;fontSize=10;',
  process:   'rounded=1;whiteSpace=wrap;fillColor=#e1d5e7;strokeColor=#9673a6;fontSize=10;',
  event:     'shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;fillColor=#e1d5e7;strokeColor=#9673a6;',
}

const EDGE_STYLE = 'edgeStyle=orthogonalEdgeStyle;html=1;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;'

function nodeStyle(n: ExportNode): string {
  if (n.type === 'return') return STYLES[`return-${n.status ?? 'ok'}`] ?? STYLES['return-ok']
  return STYLES[n.type] ?? 'rounded=1;whiteSpace=wrap;'
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function safeId(id: string): string {
  // draw.io ids must not contain characters that break XML parsing
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function cellNode(n: ExportNode, idx: number): string {
  // draw.io geometry: top-left corner
  const x = Math.round(n.x - n.w / 2)
  const y = Math.round(n.y - n.h / 2)
  // Use &#xa; (XML newline entity) for line breaks — safe inside attribute values
  const label = n.subLabel ? `${esc(n.label)}&#xa;${esc(n.subLabel)}` : esc(n.label)
  return [
    `    <mxCell id="${safeId(n.id)}" value="${label}" style="${nodeStyle(n)}"`,
    `      vertex="1" parent="1">`,
    `      <mxGeometry x="${x}" y="${y}" width="${Math.round(n.w)}" height="${Math.round(n.h)}" as="geometry" />`,
    `    </mxCell>`,
  ].join('\n')
}

function cellEdge(e: ExportEdge, idx: number): string {
  const label = e.label ? ` value="${esc(e.label)}"` : ' value=""'
  return [
    `    <mxCell id="edge-${idx}"${label} style="${EDGE_STYLE}"`,
    `      edge="1" source="${safeId(e.fromId)}" target="${safeId(e.toId)}" parent="1">`,
    `      <mxGeometry relative="1" as="geometry" />`,
    `    </mxCell>`,
  ].join('\n')
}

export function toDrawioXml(graph: ExportGraph): string {
  const nodeCells = graph.nodes.map((n, i) => cellNode(n, i)).join('\n')
  const edgeCells = graph.edges.map((e, i) => cellEdge(e, i)).join('\n')

  const diagramId = safeId(graph.title) + '_' + Date.now()
  return [
    `<mxfile host="gaia" modified="${new Date().toISOString()}" type="device">`,
    `  <diagram id="${diagramId}" name="${esc(graph.title)}">`,
    `    <mxGraphModel dx="1422" dy="762" grid="0" gridSize="10" guides="1"`,
    `      tooltips="1" connect="1" arrows="1" fold="1" page="0"`,
    `      pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0">`,
    `      <root>`,
    `        <mxCell id="0" />`,
    `        <mxCell id="1" parent="0" />`,
    nodeCells,
    edgeCells,
    `      </root>`,
    `    </mxGraphModel>`,
    `  </diagram>`,
    `</mxfile>`,
  ].join('\n')
}

export function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
