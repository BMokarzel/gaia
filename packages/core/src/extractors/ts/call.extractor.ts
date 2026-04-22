import type { SyntaxNode } from '../../utils/ast-helpers';
import {
  findAll, toLocation, calleeText, callArguments, isAwaited,
} from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { CallNode } from '../../types/topology';

// JS built-in single-word coercions that produce noise as flow nodes
const JS_BUILTIN_CALLS = new Set([
  'Number', 'String', 'Boolean', 'BigInt', 'Symbol',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'decodeURI', 'encodeURI', 'decodeURIComponent', 'encodeURIComponent',
])

/**
 * Extrai chamadas de função/método de um arquivo TypeScript/JavaScript.
 * Detecta: chamadas diretas, chamadas de método, chamadas encadeadas, chamadas opcionais.
 */
export function extractCalls(
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
  const loc = toLocation(node, filePath);
  const callee = calleeText(node);

  if (!callee || callee.length === 0) return null;
  // Skip bare built-in coercions like Number(x), String(x) — they're noise, not service calls
  if (!callee.includes('.') && JS_BUILTIN_CALLS.has(callee)) return null;

  const args = callArguments(node).map(a => a.slice(0, 200));
  const awaited = isAwaited(node);

  // Encadeamento: a().b() — o objeto da member_expression é outro call_expression
  const fnNode = node.childForFieldName('function');
  const chained =
    fnNode?.type === 'member_expression' &&
    fnNode.childForFieldName('object')?.type === 'call_expression';

  // Optional chaining: this.repo?.findAll()
  const optional = callee.includes('?.');

  const id = nodeId('call', filePath, loc.line, callee);

  return {
    id,
    type: 'call',
    name: callee,
    location: loc,
    children: [],
    metadata: {
      callee,
      arguments: args,
      awaited,
      chained,
      optional,
    },
  };
}
