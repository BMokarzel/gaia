import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, nodeText } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { FlowControlNode, ReturnNode, ThrowNode, CodeNode } from '../../types/topology';

export function extractPythonFlowControl(
  rootNode: SyntaxNode,
  filePath: string,
): CodeNode[] {
  const nodes: CodeNode[] = [];

  for (const node of findAll(rootNode, 'if_statement')) {
    nodes.push(buildIfNode(node, filePath));
  }

  // Python match_statement (Python 3.10+)
  for (const node of findAll(rootNode, 'match_statement')) {
    nodes.push(buildMatchNode(node, filePath));
  }

  for (const node of findAll(rootNode, 'for_statement')) {
    nodes.push(buildLoopNode(node, filePath, 'for_in'));
  }
  for (const node of findAll(rootNode, 'while_statement')) {
    nodes.push(buildLoopNode(node, filePath, 'while'));
  }

  for (const node of findAll(rootNode, 'try_statement')) {
    nodes.push(...buildTryCatchNodes(node, filePath));
  }

  for (const node of findAll(rootNode, 'return_statement')) {
    nodes.push(buildReturnNode(node, filePath));
  }

  for (const node of findAll(rootNode, 'raise_statement')) {
    nodes.push(buildThrowNode(node, filePath));
  }

  return nodes;
}

function buildIfNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  const condition = node.childForFieldName('condition');
  const condText = condition ? nodeText(condition).slice(0, 200) : undefined;
  const id = nodeId('flowControl', filePath, loc.line, 'if');

  const branches: { label: string; children: CodeNode[] }[] = [{ label: 'then', children: [] }];

  // elif and else
  for (const child of node.namedChildren) {
    if (child.type === 'elif_clause') branches.push({ label: 'elif', children: [] });
    if (child.type === 'else_clause') branches.push({ label: 'else', children: [] });
  }

  return {
    id,
    type: 'flowControl',
    name: `if ${condText ?? ''}:`,
    location: loc,
    children: [],
    metadata: { kind: 'if', condition: condText, branches },
  };
}

function buildMatchNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  const subject = node.childForFieldName('subject');
  const valText = subject ? nodeText(subject).slice(0, 100) : undefined;
  const id = nodeId('flowControl', filePath, loc.line, 'switch');

  const cases: { label: string; children: CodeNode[] }[] = [];
  for (const child of node.namedChildren) {
    if (child.type === 'case_clause') {
      const pattern = child.namedChildren[0];
      const label = pattern ? `case ${nodeText(pattern).slice(0, 50)}` : 'case _';
      cases.push({ label, children: [] });
    }
  }

  return {
    id,
    type: 'flowControl',
    name: `match ${valText ?? ''}:`,
    location: loc,
    children: [],
    metadata: { kind: 'switch', condition: valText, branches: cases },
  };
}

function buildLoopNode(
  node: SyntaxNode,
  filePath: string,
  kind: FlowControlNode['metadata']['kind'],
): FlowControlNode {
  const loc = toLocation(node, filePath);
  const id = nodeId('flowControl', filePath, loc.line, kind);

  let condition: string | undefined;
  if (kind === 'for_in') {
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    condition = `${left?.text ?? ''} in ${right?.text ?? ''}`;
  } else {
    const cond = node.childForFieldName('condition');
    condition = cond ? nodeText(cond).slice(0, 100) : undefined;
  }

  return {
    id,
    type: 'flowControl',
    name: kind,
    location: loc,
    children: [],
    metadata: { kind, condition },
  };
}

function buildTryCatchNodes(node: SyntaxNode, filePath: string): FlowControlNode[] {
  const nodes: FlowControlNode[] = [];
  const loc = toLocation(node, filePath);

  nodes.push({
    id: nodeId('flowControl', filePath, loc.line, 'try'),
    type: 'flowControl',
    name: 'try',
    location: loc,
    children: [],
    metadata: { kind: 'try' },
  });

  for (const child of node.namedChildren) {
    if (child.type === 'except_clause') {
      const catchLoc = toLocation(child, filePath);
      const errType = child.namedChildren[0]?.text ?? 'Exception';
      nodes.push({
        id: nodeId('flowControl', filePath, catchLoc.line, 'catch'),
        type: 'flowControl',
        name: `except ${errType}:`,
        location: catchLoc,
        children: [],
        metadata: { kind: 'catch', condition: errType },
      });
    }
    if (child.type === 'finally_clause') {
      const finallyLoc = toLocation(child, filePath);
      nodes.push({
        id: nodeId('flowControl', filePath, finallyLoc.line, 'finally'),
        type: 'flowControl',
        name: 'finally',
        location: finallyLoc,
        children: [],
        metadata: { kind: 'finally' },
      });
    }
  }

  return nodes;
}

function buildReturnNode(node: SyntaxNode, filePath: string): ReturnNode {
  const loc = toLocation(node, filePath);
  const valueNode = node.namedChildren[0];
  const valueText = valueNode ? nodeText(valueNode).slice(0, 200) : undefined;
  const id = nodeId('return', filePath, loc.line, 'return');

  return {
    id,
    type: 'return',
    name: 'return',
    location: loc,
    children: [],
    metadata: {
      kind: valueNode ? 'explicit' : 'implicit',
      value: valueText,
    },
  };
}

function buildThrowNode(node: SyntaxNode, filePath: string): ThrowNode {
  const loc = toLocation(node, filePath);
  const valueNode = node.namedChildren[0];
  const id = nodeId('throw', filePath, loc.line, 'raise');

  let errorClass = 'Exception';
  let message: string | undefined;

  if (valueNode) {
    if (valueNode.type === 'call') {
      const fn = valueNode.childForFieldName('function');
      errorClass = fn?.text ?? 'Exception';
      const args = valueNode.childForFieldName('arguments');
      const firstArg = args?.namedChildren[0];
      if (firstArg) {
        message = firstArg.text.replace(/^["']|["']$/g, '').slice(0, 200);
      }
    } else {
      errorClass = valueNode.text.split('(')[0];
    }
  }

  const httpStatus = detectHttpStatus(errorClass);

  return {
    id,
    type: 'throw',
    name: `raise ${errorClass}`,
    location: loc,
    children: [],
    metadata: { kind: 'throw', errorClass, message, httpStatus, propagates: true },
  };
}

function detectHttpStatus(name: string): number | undefined {
  const map: Record<string, number> = {
    HTTPException: 400,
    Http404: 404,
    PermissionDenied: 403,
    ValidationError: 400,
    NotFound: 404,
    Unauthorized: 401,
    Forbidden: 403,
  };
  return map[name];
}
