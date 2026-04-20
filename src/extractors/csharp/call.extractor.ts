import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { CallNode } from '../../types/topology';

export function extractCSharpCalls(
  rootNode: SyntaxNode,
  filePath: string,
): CallNode[] {
  const nodes: CallNode[] = [];

  for (const call of findAll(rootNode, 'invocation_expression')) {
    const node = buildCSharpCall(call, filePath);
    if (node) nodes.push(node);
  }

  // object_creation_expression: new Foo(args)
  for (const call of findAll(rootNode, 'object_creation_expression')) {
    const typeNode = call.childForFieldName('type');
    if (!typeNode) continue;
    const callee = `new ${typeNode.text}`;
    const args = call.childForFieldName('argument_list');
    const argTexts = args ? args.namedChildren
      .filter(a => a.type === 'argument')
      .map(a => (a.childForFieldName('expression') ?? a).text.slice(0, 200)) : [];
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

function buildCSharpCall(node: SyntaxNode, filePath: string): CallNode | null {
  const expr = node.childForFieldName('expression');
  if (!expr) return null;

  let callee: string;
  let chained = false;
  let optional = false;

  if (expr.type === 'member_access_expression') {
    const obj = expr.childForFieldName('expression');
    const member = expr.childForFieldName('name')?.text ?? '';
    callee = obj ? `${obj.text}.${member}` : member;
    chained = obj?.type === 'invocation_expression';
    optional = expr.text.includes('?.');
  } else {
    callee = expr.text.trim();
  }

  if (!callee) return null;

  // Detect await
  const awaited = node.parent?.type === 'await_expression';

  const argList = node.childForFieldName('argument_list');
  const argTexts = argList
    ? argList.namedChildren
        .filter(a => a.type === 'argument')
        .map(a => (a.childForFieldName('expression') ?? a).text.slice(0, 200))
    : [];

  const loc = toLocation(node, filePath);
  const id = nodeId('call', filePath, loc.line, callee);

  return {
    id,
    type: 'call',
    name: callee,
    location: loc,
    children: [],
    metadata: { callee, arguments: argTexts, awaited, chained, optional },
  };
}
