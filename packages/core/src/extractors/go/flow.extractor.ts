import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, nodeText } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { FlowControlNode, ReturnNode, ThrowNode, CodeNode } from '../../types/topology';

export function extractGoFlowControl(
  rootNode: SyntaxNode,
  filePath: string,
): CodeNode[] {
  const nodes: CodeNode[] = [];

  for (const node of findAll(rootNode, 'if_statement')) {
    nodes.push(buildIfNode(node, filePath));
  }

  for (const node of findAll(rootNode, 'expression_switch_statement').concat(
    findAll(rootNode, 'type_switch_statement'),
  )) {
    nodes.push(buildSwitchNode(node, filePath));
  }

  // Go uses `for` for all loops
  for (const node of findAll(rootNode, 'for_statement')) {
    nodes.push(buildForNode(node, filePath));
  }

  // select statement (channel operations)
  for (const node of findAll(rootNode, 'select_statement')) {
    nodes.push(buildSelectNode(node, filePath));
  }

  for (const node of findAll(rootNode, 'return_statement')) {
    nodes.push(buildReturnNode(node, filePath));
  }

  // Go error handling: if err != nil { ... }
  // These are already captured as if_statements, but we want to specifically mark panics
  for (const node of findAll(rootNode, 'call_expression')) {
    const fn = node.childForFieldName('function');
    if (fn?.text === 'panic') {
      nodes.push(buildPanicNode(node, filePath));
    }
  }

  return nodes;
}

function buildIfNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  const condition = node.childForFieldName('condition');
  const condText = condition ? nodeText(condition).slice(0, 200) : undefined;
  const id = nodeId('flowControl', filePath, loc.line, 'if');

  const branches: { label: string; children: CodeNode[] }[] = [{ label: 'then', children: [] }];
  const alt = node.childForFieldName('alternative');
  if (alt) {
    const label = alt.type === 'if_statement' ? 'else_if' : 'else';
    branches.push({ label, children: [] });
  }

  // Detect Go error check pattern: if err != nil
  const isErrCheck = /err\s*!=\s*nil/.test(condText ?? '');

  return {
    id,
    type: 'flowControl',
    name: isErrCheck ? `if err != nil` : `if ${condText ?? ''}`,
    location: loc,
    children: [],
    metadata: {
      kind: 'if',
      condition: condText,
      branches,
    },
  };
}

function buildSwitchNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  const value = node.childForFieldName('value') ?? node.childForFieldName('initializer');
  const valText = value ? nodeText(value).slice(0, 100) : undefined;
  const id = nodeId('flowControl', filePath, loc.line, 'switch');

  const cases: { label: string; children: CodeNode[] }[] = [];
  for (const child of node.namedChildren) {
    if (child.type === 'expression_case' || child.type === 'type_case') {
      const caseVal = child.namedChildren[0];
      const label = caseVal ? `case ${nodeText(caseVal).slice(0, 50)}` : 'default';
      cases.push({ label, children: [] });
    }
    if (child.type === 'default_case') {
      cases.push({ label: 'default', children: [] });
    }
  }

  return {
    id,
    type: 'flowControl',
    name: `switch ${valText ?? ''}`,
    location: loc,
    children: [],
    metadata: { kind: 'switch', condition: valText, branches: cases },
  };
}

function buildForNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  const id = nodeId('flowControl', filePath, loc.line, 'for');

  // Detect loop kind from structure
  // range: for k, v := range collection
  const rangeClause = node.childForFieldName('range_clause') ?? findRangeClause(node);
  if (rangeClause) {
    const right = rangeClause.childForFieldName('right');
    const left = rangeClause.childForFieldName('left');
    const condition = `${left?.text ?? ''} := range ${right?.text ?? ''}`;
    return {
      id,
      type: 'flowControl',
      name: 'for_in',
      location: loc,
      children: [],
      metadata: { kind: 'for_in', condition },
    };
  }

  // for condition: while equivalent
  const condition = node.childForFieldName('condition');
  if (condition && !node.childForFieldName('init_statement') && !node.childForFieldName('post_statement')) {
    return {
      id,
      type: 'flowControl',
      name: 'while',
      location: loc,
      children: [],
      metadata: { kind: 'while', condition: nodeText(condition).slice(0, 100) },
    };
  }

  // classic for with init; condition; post
  const condText = condition ? nodeText(condition).slice(0, 100) : undefined;
  return {
    id,
    type: 'flowControl',
    name: 'for',
    location: loc,
    children: [],
    metadata: { kind: 'for', condition: condText },
  };
}

function findRangeClause(node: SyntaxNode): SyntaxNode | null {
  for (const child of node.namedChildren) {
    if (child.type === 'range_clause' || child.type === 'for_clause' && child.text.includes('range')) {
      return child;
    }
  }
  return null;
}

function buildSelectNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  const id = nodeId('flowControl', filePath, loc.line, 'switch');

  const cases: { label: string; children: CodeNode[] }[] = [];
  for (const child of node.namedChildren) {
    if (child.type === 'communication_case') {
      const comm = child.namedChildren[0];
      const label = comm ? `case ${nodeText(comm).slice(0, 50)}` : 'case';
      cases.push({ label, children: [] });
    }
    if (child.type === 'default_case') {
      cases.push({ label: 'default', children: [] });
    }
  }

  return {
    id,
    type: 'flowControl',
    name: 'select',
    location: loc,
    children: [],
    metadata: { kind: 'switch', branches: cases },
  };
}

function buildReturnNode(node: SyntaxNode, filePath: string): ReturnNode {
  const loc = toLocation(node, filePath);
  const id = nodeId('return', filePath, loc.line, 'return');

  // Go supports multiple return values
  const values = node.namedChildren.map(n => nodeText(n).slice(0, 200));
  const valueText = values.join(', ');

  return {
    id,
    type: 'return',
    name: 'return',
    location: loc,
    children: [],
    metadata: {
      kind: values.length > 0 ? 'explicit' : 'implicit',
      value: valueText || undefined,
    },
  };
}

function buildPanicNode(node: SyntaxNode, filePath: string): ThrowNode {
  const loc = toLocation(node, filePath);
  const id = nodeId('throw', filePath, loc.line, 'panic');

  const args = node.childForFieldName('arguments');
  const firstArg = args?.namedChildren[0];
  const message = firstArg ? nodeText(firstArg).replace(/^["']|["']$/g, '').slice(0, 200) : undefined;

  return {
    id,
    type: 'throw',
    name: 'panic',
    location: loc,
    children: [],
    metadata: {
      kind: 'panic',
      errorClass: 'panic',
      message,
      propagates: true,
    },
  };
}
