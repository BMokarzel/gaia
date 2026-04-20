import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, nodeText } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type {
  FlowControlNode, ReturnNode, ThrowNode, CodeNode,
} from '../../types/topology';

/**
 * Extrai nós de controle de fluxo de arquivos Go.
 *
 * Go não tem throw/catch — usa multi-return com `error`.
 * panic() é mapeado para ThrowNode como aproximação semântica.
 * Goroutines (go func()) são anotadas mas não têm equivalente direto no schema.
 */
export function extractGoFlowControl(
  rootNode: SyntaxNode,
  filePath: string,
): CodeNode[] {
  const nodes: CodeNode[] = [];

  for (const node of findAll(rootNode, 'if_statement')) {
    nodes.push(buildGoIfNode(node, filePath));
  }

  for (const node of findAll(rootNode, 'for_statement')) {
    nodes.push(buildGoForNode(node, filePath));
  }

  // switch de expressão: switch x { case ... }
  for (const node of findAll(rootNode, 'expression_switch_statement')) {
    nodes.push(buildGoSwitchNode(node, filePath));
  }

  // type switch: switch v := x.(type) { case T: ... }
  for (const node of findAll(rootNode, 'type_switch_statement')) {
    nodes.push(buildGoSwitchNode(node, filePath));
  }

  // select: multiplexação de canais
  for (const node of findAll(rootNode, 'select_statement')) {
    nodes.push(buildGoSelectNode(node, filePath));
  }

  for (const node of findAll(rootNode, 'return_statement')) {
    nodes.push(buildGoReturnNode(node, filePath));
  }

  // panic() → ThrowNode
  for (const node of findAll(rootNode, 'call_expression')) {
    const fn = node.childForFieldName('function');
    const fnText = fn?.text ?? '';
    if (fnText === 'panic' || fnText === 'log.Fatal' || fnText === 'log.Fatalf' || fnText === 'log.Panic') {
      nodes.push(buildGoPanicNode(node, filePath, fnText));
    }
  }

  return nodes;
}

// ─────────────────────────────────────────────────────────────────
// Builders
// ─────────────────────────────────────────────────────────────────

function buildGoIfNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  const id = nodeId('flowControl', filePath, loc.line, 'if');

  // Go if pode ter um init statement: if err := f(); err != nil { ... }
  const condition = node.childForFieldName('condition');
  const condText = condition ? nodeText(condition).slice(0, 200) : undefined;

  const branches: { label: string; children: CodeNode[] }[] = [
    { label: 'then', children: [] },
  ];
  const alt = node.childForFieldName('alternative');
  if (alt) {
    branches.push({
      label: alt.type === 'if_statement' ? 'else_if' : 'else',
      children: [],
    });
  }

  return {
    id,
    type: 'flowControl',
    name: `if (${condText ?? ''})`,
    location: loc,
    children: [],
    metadata: { kind: 'if', condition: condText, branches },
  };
}

function buildGoForNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  const id = nodeId('flowControl', filePath, loc.line, 'for');

  // Go usa um único nó for_statement para todos os tipos de loop
  const text = node.text;
  const header = text.split('{')[0].trim();

  let kind: FlowControlNode['metadata']['kind'] = 'for';
  let condition: string | undefined;

  if (header.includes(' range ')) {
    kind = 'for_of';
    condition = header.replace(/^for\s*/, '').trim().slice(0, 150);
  } else if (header === 'for') {
    kind = 'while'; // loop infinito: for { }
  } else {
    // for cond { } ou for init; cond; post { }
    condition = header.replace(/^for\s*/, '').trim().slice(0, 150);
  }

  return {
    id,
    type: 'flowControl',
    name: header.slice(0, 80),
    location: loc,
    children: [],
    metadata: { kind, condition },
  };
}

function buildGoSwitchNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  const id = nodeId('flowControl', filePath, loc.line, 'switch');

  const header = node.text.split('{')[0].trim();
  const condition = header.replace(/^switch\s*/, '').trim().slice(0, 150) || undefined;

  // Casos
  const caseClauses = findAll(node, 'expression_case').concat(
    findAll(node, 'type_case'),
    findAll(node, 'default_case'),
  );

  const branches: { label: string; children: CodeNode[] }[] = caseClauses.map(c => ({
    label: c.type === 'default_case'
      ? 'default'
      : `case ${c.namedChildren[0]?.text ?? ''}`.slice(0, 60),
    children: [],
  }));

  return {
    id,
    type: 'flowControl',
    name: `switch (${condition ?? ''})`,
    location: loc,
    children: [],
    metadata: { kind: 'switch', condition, branches },
  };
}

function buildGoSelectNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  const id = nodeId('flowControl', filePath, loc.line, 'select');

  const cases = findAll(node, 'communication_case').concat(findAll(node, 'default_case'));
  const branches: { label: string; children: CodeNode[] }[] = cases.map(c => ({
    label: c.type === 'default_case'
      ? 'default'
      : `case ${c.namedChildren[0]?.text ?? ''}`.slice(0, 60),
    children: [],
  }));

  return {
    id,
    type: 'flowControl',
    name: 'select',
    location: loc,
    children: [],
    metadata: { kind: 'switch', branches },
  };
}

function buildGoReturnNode(node: SyntaxNode, filePath: string): ReturnNode {
  const loc = toLocation(node, filePath);
  const id = nodeId('return', filePath, loc.line, 'return');

  // Go pode retornar múltiplos valores: return val, err
  const values = node.namedChildren;
  const valueText = values.length > 0
    ? values.map(v => nodeText(v)).join(', ').slice(0, 200)
    : undefined;

  return {
    id,
    type: 'return',
    name: 'return',
    location: loc,
    children: [],
    metadata: {
      kind: valueText ? 'explicit' : 'implicit',
      value: valueText,
      httpStatus: detectGoHttpStatus(valueText),
    },
  };
}

function buildGoPanicNode(
  node: SyntaxNode,
  filePath: string,
  fnName: string,
): ThrowNode {
  const loc = toLocation(node, filePath);
  const id = nodeId('throw', filePath, loc.line, 'panic');

  const args = node.childForFieldName('arguments');
  const message = args?.namedChildren[0]?.text.replace(/^["'`]|["'`]$/g, '').slice(0, 200);

  return {
    id,
    type: 'throw',
    name: fnName,
    location: loc,
    children: [],
    metadata: {
      kind: 'throw',
      errorClass: fnName,
      message,
      propagates: true,
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function detectGoHttpStatus(value: string | undefined): number | undefined {
  if (!value) return undefined;

  // http.StatusOK, http.StatusNotFound, etc.
  const namedStatus = value.match(/http\.Status([A-Z][a-zA-Z]+)/);
  if (namedStatus) return GO_HTTP_STATUS_MAP[namedStatus[1]];

  // status_code: 404, StatusCode: 200
  const numericStatus = value.match(/\b([1-5][0-9]{2})\b/);
  if (numericStatus) return parseInt(numericStatus[1], 10);

  return undefined;
}

const GO_HTTP_STATUS_MAP: Record<string, number> = {
  Continue: 100, SwitchingProtocols: 101,
  OK: 200, Created: 201, Accepted: 202, NoContent: 204,
  MovedPermanently: 301, Found: 302, SeeOther: 303, NotModified: 304,
  BadRequest: 400, Unauthorized: 401, Forbidden: 403, NotFound: 404,
  MethodNotAllowed: 405, Conflict: 409, Gone: 410, UnprocessableEntity: 422,
  TooManyRequests: 429,
  InternalServerError: 500, NotImplemented: 501, BadGateway: 502,
  ServiceUnavailable: 503, GatewayTimeout: 504,
};
