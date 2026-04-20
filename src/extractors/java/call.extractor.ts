import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { CallNode } from '../../types/topology';

export function extractJavaCalls(
  rootNode: SyntaxNode,
  filePath: string,
): CallNode[] {
  const nodes: CallNode[] = [];

  for (const call of findAll(rootNode, 'method_invocation')) {
    const node = buildJavaCall(call, filePath);
    if (node) nodes.push(node);
  }

  // object_creation_expression: new Foo(args) — treat as call
  for (const call of findAll(rootNode, 'object_creation_expression')) {
    const typeNode = call.childForFieldName('type');
    if (!typeNode) continue;
    const callee = `new ${typeNode.text}`;
    const args = call.childForFieldName('arguments');
    const argTexts = args ? args.namedChildren.map(a => a.text.slice(0, 200)) : [];
    const loc = toLocation(call, filePath);
    nodes.push({
      id: nodeId('call', filePath, loc.line, callee),
      type: 'call',
      name: callee,
      location: loc,
      children: [],
      metadata: { callee, arguments: argTexts, awaited: false, chained: false, optional: false },
    });
  }

  return nodes;
}

function buildJavaCall(node: SyntaxNode, filePath: string): CallNode | null {
  const methodNode = node.childForFieldName('name');
  if (!methodNode) return null;

  const obj = node.childForFieldName('object');
  const callee = obj ? `${obj.text}.${methodNode.text}` : methodNode.text;

  const args = node.childForFieldName('arguments');
  const argTexts = args ? args.namedChildren.map(a => a.text.slice(0, 200)) : [];

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
      arguments: argTexts,
      awaited: false,
      chained: obj?.type === 'method_invocation',
      optional: false,
    },
  };
}
