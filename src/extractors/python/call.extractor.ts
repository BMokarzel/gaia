import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { CallNode } from '../../types/topology';

export function extractPythonCalls(
  rootNode: SyntaxNode,
  filePath: string,
): CallNode[] {
  const nodes: CallNode[] = [];

  for (const call of findAll(rootNode, 'call')) {
    const node = buildPythonCall(call, filePath);
    if (node) nodes.push(node);
  }

  return nodes;
}

function buildPythonCall(node: SyntaxNode, filePath: string): CallNode | null {
  const fn = node.childForFieldName('function');
  if (!fn) return null;

  const callee = fn.text.trim();
  if (!callee) return null;

  // Skip common built-ins that don't represent business logic calls
  const builtins = new Set([
    'print', 'len', 'range', 'enumerate', 'zip', 'map', 'filter',
    'list', 'dict', 'set', 'tuple', 'str', 'int', 'float', 'bool',
    'isinstance', 'hasattr', 'getattr', 'setattr', 'type', 'repr',
    'super', 'staticmethod', 'classmethod', 'property',
  ]);
  const baseName = callee.split('.').pop() ?? callee;
  if (builtins.has(baseName)) return null;

  const args = node.childForFieldName('arguments');
  const argTexts = args
    ? args.namedChildren
        .filter(a => a.type !== 'comment')
        .map(a => a.text.slice(0, 200))
    : [];

  // Detect await: parent is await expression
  const awaited = node.parent?.type === 'await';

  // Detect method chain: fn is attribute and its object is a call
  const chained = fn.type === 'attribute'
    && fn.childForFieldName('object')?.type === 'call';

  const loc = toLocation(node, filePath);
  const id = nodeId('call', filePath, loc.line, callee);

  return {
    id,
    type: 'call',
    name: callee,
    location: loc,
    children: [],
    metadata: { callee, arguments: argTexts, awaited, chained, optional: false },
  };
}
