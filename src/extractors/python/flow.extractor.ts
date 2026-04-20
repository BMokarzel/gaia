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

  for (const node of findAll(rootNode, 'for_statement')) {
    nodes.push(buildForNode(node, filePath));
  }

  for (const node of findAll(rootNode, 'while_statement')) {
    nodes.push(buildWhileNode(node, filePath));
  }

  for (const node of findAll(rootNode, 'try_statement')) {
    nodes.push(...buildTryCatch(node, filePath));
  }

  // with statement: context managers (DB sessions, file handles)
  for (const node of findAll(rootNode, 'with_statement')) {
    nodes.push(buildWithNode(node, filePath));
  }

  for (const node of findAll(rootNode, 'return_statement')) {
    nodes.push(buildReturn(node, filePath));
  }

  for (const node of findAll(rootNode, 'raise_statement')) {
    nodes.push(buildThrow(node, filePath));
  }

  return nodes;
}

function buildIfNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  const condition = node.childForFieldName('condition');
  const condText = condition ? nodeText(condition).slice(0, 200) : undefined;

  const branches: { label: string; children: CodeNode[] }[] = [{ label: 'then', children: [] }];
  const elifClauses = node.children.filter(c => c.type === 'elif_clause');
  for (const elif of elifClauses) {
    const elifCond = elif.childForFieldName('condition');
    branches.push({ label: `elif (${elifCond ? nodeText(elifCond).slice(0, 60) : ''})`, children: [] });
  }
  if (node.childForFieldName('alternative') ?? node.children.find(c => c.type === 'else_clause')) {
    branches.push({ label: 'else', children: [] });
  }

  return {
    id: nodeId('flowControl', filePath, loc.line, 'if'),
    type: 'flowControl', name: `if (${condText ?? ''})`,
    location: loc, children: [],
    metadata: { kind: 'if', condition: condText, branches },
  };
}

function buildForNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  // for x in iterable: — left is the variable, right is the iterable
  const left = node.childForFieldName('left');
  const right = node.childForFieldName('right');
  const condText = right ? `${left?.text ?? '_'} in ${nodeText(right).slice(0, 100)}` : undefined;
  return {
    id: nodeId('flowControl', filePath, loc.line, 'for_of'),
    type: 'flowControl', name: 'for',
    location: loc, children: [],
    metadata: { kind: 'for_of', condition: condText },
  };
}

function buildWhileNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  const condition = node.childForFieldName('condition');
  const condText = condition ? nodeText(condition).slice(0, 150) : undefined;
  return {
    id: nodeId('flowControl', filePath, loc.line, 'while'),
    type: 'flowControl', name: 'while',
    location: loc, children: [],
    metadata: { kind: 'while', condition: condText },
  };
}

function buildTryCatch(node: SyntaxNode, filePath: string): FlowControlNode[] {
  const result: FlowControlNode[] = [];
  const loc = toLocation(node, filePath);

  result.push({
    id: nodeId('flowControl', filePath, loc.line, 'try'),
    type: 'flowControl', name: 'try',
    location: loc, children: [],
    metadata: { kind: 'try' },
  });

  for (const clause of node.children.filter(c => c.type === 'except_clause')) {
    const clauseLoc = toLocation(clause, filePath);
    // except ExceptionType as e:
    const exType = clause.namedChildren
      .find(c => c.type !== 'identifier' || c.text !== 'as')
      ?.text ?? 'Exception';
    result.push({
      id: nodeId('flowControl', filePath, clauseLoc.line, 'catch'),
      type: 'flowControl', name: `except ${exType}`,
      location: clauseLoc, children: [],
      metadata: { kind: 'catch', condition: exType },
    });
  }

  const finally_ = node.children.find(c => c.type === 'finally_clause');
  if (finally_) {
    const fLoc = toLocation(finally_, filePath);
    result.push({
      id: nodeId('flowControl', filePath, fLoc.line, 'finally'),
      type: 'flowControl', name: 'finally',
      location: fLoc, children: [],
      metadata: { kind: 'finally' },
    });
  }

  return result;
}

function buildWithNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  const items = node.childForFieldName('items') ?? node.namedChildren[0];
  const condText = items ? nodeText(items).slice(0, 100) : undefined;
  return {
    id: nodeId('flowControl', filePath, loc.line, 'with'),
    type: 'flowControl', name: `with ${condText ?? ''}`,
    location: loc, children: [],
    metadata: { kind: 'try', condition: condText },
  };
}

function buildReturn(node: SyntaxNode, filePath: string): ReturnNode {
  const loc = toLocation(node, filePath);
  const value = node.namedChildren[0]?.text?.slice(0, 200);
  return {
    id: nodeId('return', filePath, loc.line, 'return'),
    type: 'return', name: 'return',
    location: loc, children: [],
    metadata: { kind: value ? 'explicit' : 'implicit', value },
  };
}

function buildThrow(node: SyntaxNode, filePath: string): ThrowNode {
  const loc = toLocation(node, filePath);
  const expr = node.namedChildren[0];
  const errorClass = expr?.text.split('(')[0].trim() ?? 'Exception';
  return {
    id: nodeId('throw', filePath, loc.line, 'raise'),
    type: 'throw', name: `raise ${errorClass}`,
    location: loc, children: [],
    metadata: { kind: 'throw', errorClass, propagates: true },
  };
}
