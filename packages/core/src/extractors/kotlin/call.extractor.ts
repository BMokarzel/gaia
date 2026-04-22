import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { CallNode } from '../../types/topology';

// Node types to skip — skip calls that are inside annotations or imports
const SKIP_PARENTS = new Set([
  'annotation', 'import_header',
]);

export function extractKotlinCalls(
  rootNode: SyntaxNode,
  filePath: string,
): CallNode[] {
  const nodes: CallNode[] = [];

  for (const node of findAll(rootNode, 'call_expression')) {
    const call = buildCallNode(node, filePath);
    if (call) nodes.push(call);
  }

  return nodes;
}

function buildCallNode(node: SyntaxNode, filePath: string): CallNode | null {
  // Skip calls that are part of annotations or imports
  let p = node.parent;
  while (p) {
    if (SKIP_PARENTS.has(p.type)) return null;
    p = p.parent;
  }

  // Callee is either a navigation_expression or a simple_identifier
  const calleeNode = node.namedChildren.find(c =>
    c.type === 'navigation_expression' || c.type === 'simple_identifier'
  );
  if (!calleeNode) return null;

  const callee = calleeNode.text.slice(0, 200);
  if (!callee) return null;

  // Skip annotation-like single-word calls that are annotations in disguise
  if (calleeNode.type === 'simple_identifier' && /^[A-Z]/.test(callee) && callee.length < 4) return null;

  const valueArgs = node.namedChildren.find(c => c.type === 'value_arguments');
  const argList = valueArgs
    ? valueArgs.namedChildren
        .filter(c => c.type === 'value_argument')
        .map(a => a.text.slice(0, 200))
    : [];

  const loc = toLocation(node, filePath);
  const id = nodeId('call', filePath, loc.line, callee);

  // Determine if chained (receiver is itself a call or nav expression)
  const isChained = calleeNode.type === 'navigation_expression' &&
    calleeNode.namedChildren[0]?.type === 'call_expression';

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
      chained: isChained,
      optional: node.children.some(c => c.type === '?.'),
    },
  };
}
