import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { CallNode } from '../../types/topology';

export function extractKotlinCalls(
  rootNode: SyntaxNode,
  filePath: string,
): CallNode[] {
  const nodes: CallNode[] = [];

  for (const call of findAll(rootNode, 'call_expression')) {
    const node = buildKotlinCall(call, filePath);
    if (node) nodes.push(node);
  }

  return nodes;
}

function buildKotlinCall(node: SyntaxNode, filePath: string): CallNode | null {
  // Kotlin AST: call_expression → navigation_expression? | simple_identifier
  const nav = node.childForFieldName('navigation_expression')
    ?? node.children.find(c => c.type === 'navigation_expression');

  let callee: string;
  let chained = false;

  if (nav) {
    callee = nav.text.trim();
    const receiver = nav.childForFieldName('expression');
    chained = receiver?.type === 'call_expression';
  } else {
    const fn = node.children.find(c =>
      c.type === 'simple_identifier' || c.type === 'identifier'
    );
    if (!fn) return null;
    callee = fn.text.trim();
  }

  if (!callee) return null;

  const valueArgs = node.childForFieldName('value_arguments')
    ?? node.children.find(c => c.type === 'value_arguments');
  const argTexts = valueArgs
    ? valueArgs.namedChildren.map(a => {
        const expr = a.childForFieldName('expression') ?? a;
        return expr.text.slice(0, 200);
      })
    : [];

  // Detect suspend/await context — parent is inside coroutine scope
  const awaited = isInsideCoroutine(node);

  const loc = toLocation(node, filePath);
  const id = nodeId('call', filePath, loc.line, callee);

  return {
    id,
    type: 'call',
    name: callee,
    location: loc,
    children: [],
    metadata: { callee, arguments: argTexts, awaited, chained, optional: callee.includes('?.') },
  };
}

function isInsideCoroutine(node: SyntaxNode): boolean {
  let cur = node.parent;
  while (cur) {
    if (cur.type === 'lambda_literal' || cur.type === 'function_declaration') {
      const text = cur.text ?? '';
      if (/\bsuspend\b/.test(text.split('{')[0])) return true;
      break;
    }
    cur = cur.parent;
  }
  return false;
}
