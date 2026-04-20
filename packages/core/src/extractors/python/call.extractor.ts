import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { CallNode } from '../../types/topology';

export function extractPythonCalls(
  rootNode: SyntaxNode,
  filePath: string,
): CallNode[] {
  const nodes: CallNode[] = [];

  for (const node of findAll(rootNode, 'call')) {
    const call = buildCallNode(node, filePath);
    if (call) nodes.push(call);
  }

  return nodes;
}

function buildCallNode(node: SyntaxNode, filePath: string): CallNode | null {
  const fn = node.childForFieldName('function');
  if (!fn) return null;

  let callee: string;
  let chained = false;

  if (fn.type === 'attribute') {
    const obj = fn.childForFieldName('object');
    const attr = fn.childForFieldName('attribute');
    callee = obj && attr ? `${obj.text}.${attr.text}` : fn.text;
    chained = obj?.type === 'call';
  } else if (fn.type === 'identifier') {
    callee = fn.text;
  } else {
    callee = fn.text.slice(0, 100);
  }

  if (!callee) return null;

  const args = node.childForFieldName('arguments');
  const argList = args?.namedChildren
    .filter(a => a.type !== 'comment')
    .map(a => a.text.slice(0, 200)) ?? [];

  const loc = toLocation(node, filePath);
  const id = nodeId('call', filePath, loc.line, callee);

  // Check if call is inside an await expression
  const awaited = node.parent?.type === 'await';

  return {
    id,
    type: 'call',
    name: callee,
    location: loc,
    children: [],
    metadata: {
      callee,
      arguments: argList,
      awaited,
      chained,
      optional: false,
    },
  };
}
