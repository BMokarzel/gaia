import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { CallNode } from '../../types/topology';

export function extractGoCalls(
  rootNode: SyntaxNode,
  filePath: string,
): CallNode[] {
  const nodes: CallNode[] = [];

  for (const call of findAll(rootNode, 'call_expression')) {
    const node = buildGoCall(call, filePath);
    if (node) nodes.push(node);
  }

  return nodes;
}

function buildGoCall(node: SyntaxNode, filePath: string): CallNode | null {
  const fn = node.childForFieldName('function');
  if (!fn) return null;

  const callee = fn.text.trim();
  if (!callee) return null;

  // Skip built-ins that aren't real function calls in the graph sense
  const builtins = new Set(['make', 'len', 'cap', 'append', 'copy', 'delete',
    'close', 'new', 'panic', 'recover', 'print', 'println']);
  const baseName = callee.split('.').pop() ?? callee;
  if (builtins.has(baseName)) return null;

  const args = node.childForFieldName('arguments');
  const argTexts = args ? args.namedChildren.map(a => a.text.slice(0, 200)) : [];

  // Detect goroutine: parent is go_statement
  const isGoroutine = node.parent?.type === 'go_statement';

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
      chained: fn.type === 'selector_expression' &&
        fn.childForFieldName('operand')?.type === 'call_expression',
      optional: false,
    },
  };
}
