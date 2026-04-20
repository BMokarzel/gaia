import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { CallNode } from '../../types/topology';

export function extractJavaCalls(
  rootNode: SyntaxNode,
  filePath: string,
): CallNode[] {
  const nodes: CallNode[] = [];

  for (const node of findAll(rootNode, 'method_invocation')) {
    const call = buildCallNode(node, filePath);
    if (call) nodes.push(call);
  }

  // object_creation_expression: new SomeClass(args) — important for event objects
  for (const node of findAll(rootNode, 'object_creation_expression')) {
    const call = buildNewCallNode(node, filePath);
    if (call) nodes.push(call);
  }

  return nodes;
}

function buildCallNode(node: SyntaxNode, filePath: string): CallNode | null {
  const methodName = node.childForFieldName('name')?.text;
  if (!methodName) return null;

  const objectNode = node.childForFieldName('object');
  const callee = objectNode ? `${objectNode.text}.${methodName}` : methodName;

  const args = node.childForFieldName('arguments');
  const argList = args?.namedChildren.map(a => a.text.slice(0, 200)) ?? [];

  const loc = toLocation(node, filePath);
  const id = nodeId('call', filePath, loc.line, callee);

  return {
    id,
    type: 'call',
    name: callee,
    location: loc,
    children: [],
    metadata: {
      callee,
      arguments: argList,
      awaited: false,
      chained: objectNode?.type === 'method_invocation',
      optional: false,
    },
  };
}

function buildNewCallNode(node: SyntaxNode, filePath: string): CallNode | null {
  const typeNode = node.childForFieldName('type');
  if (!typeNode) return null;

  const callee = `new ${typeNode.text}`;
  const args = node.childForFieldName('arguments');
  const argList = args?.namedChildren.map(a => a.text.slice(0, 200)) ?? [];

  const loc = toLocation(node, filePath);
  const id = nodeId('call', filePath, loc.line, callee);

  return {
    id,
    type: 'call',
    name: callee,
    location: loc,
    children: [],
    metadata: {
      callee,
      arguments: argList,
      awaited: false,
      chained: false,
      optional: false,
    },
  };
}
