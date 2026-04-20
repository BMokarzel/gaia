import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { CallNode } from '../../types/topology';

export function extractGoCalls(
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
  const fn = node.childForFieldName('function');
  if (!fn) return null;

  let callee: string;
  let chained = false;

  if (fn.type === 'selector_expression') {
    const operand = fn.childForFieldName('operand');
    const field = fn.childForFieldName('field');
    callee = operand && field ? `${operand.text}.${field.text}` : fn.text;
    chained = operand?.type === 'call_expression';
  } else if (fn.type === 'identifier') {
    callee = fn.text;
  } else {
    callee = fn.text.slice(0, 100);
  }

  if (!callee) return null;

  const args = node.childForFieldName('arguments');
  const argList = args?.namedChildren
    .filter(a => a.type !== 'comment' && a.type !== '...')
    .map(a => a.text.slice(0, 200)) ?? [];

  const loc = toLocation(node, filePath);
  const id = nodeId('call', filePath, loc.line, callee);

  // Go goroutines: go someFunc() — detect from parent
  const isGoroutine = node.parent?.type === 'go_statement';

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
      chained,
      optional: false,
      ...(isGoroutine ? { goroutine: true } : {}),
    },
  };
}
