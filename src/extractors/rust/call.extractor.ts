import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { CallNode } from '../../types/topology';

export function extractRustCalls(
  rootNode: SyntaxNode,
  filePath: string,
): CallNode[] {
  const nodes: CallNode[] = [];

  // Function calls: foo(), foo::bar(), pkg::Struct::method()
  for (const call of findAll(rootNode, 'call_expression')) {
    const node = buildRustFnCall(call, filePath);
    if (node) nodes.push(node);
  }

  // Method calls: obj.method(args)
  for (const call of findAll(rootNode, 'method_call_expression')) {
    const node = buildRustMethodCall(call, filePath);
    if (node) nodes.push(node);
  }

  return nodes;
}

function buildRustFnCall(node: SyntaxNode, filePath: string): CallNode | null {
  const fn = node.childForFieldName('function');
  if (!fn) return null;

  const callee = fn.text.trim();
  if (!callee || callee.startsWith('"') || callee.startsWith("'")) return null;

  const args = node.childForFieldName('arguments');
  const argTexts = args ? args.namedChildren.map(a => a.text.slice(0, 200)) : [];

  // Detect .await: parent is await_expression or field_expression ending with .await
  const awaited = node.parent?.type === 'await_expression'
    || node.parent?.text?.endsWith('.await') === true;

  const loc = toLocation(node, filePath);
  return {
    id: nodeId('call', filePath, loc.line, callee),
    type: 'call',
    name: callee,
    location: loc,
    children: [],
    metadata: { callee, arguments: argTexts, awaited, chained: false, optional: false },
  };
}

function buildRustMethodCall(node: SyntaxNode, filePath: string): CallNode | null {
  const receiver = node.childForFieldName('receiver');
  const method = node.childForFieldName('method');
  if (!method) return null;

  const callee = receiver ? `${receiver.text}.${method.text}` : method.text;

  const args = node.childForFieldName('arguments');
  const argTexts = args ? args.namedChildren.map(a => a.text.slice(0, 200)) : [];

  const awaited = node.parent?.type === 'await_expression';
  const chained = receiver?.type === 'call_expression'
    || receiver?.type === 'method_call_expression';

  const loc = toLocation(node, filePath);
  return {
    id: nodeId('call', filePath, loc.line, callee),
    type: 'call',
    name: callee,
    location: loc,
    children: [],
    metadata: { callee, arguments: argTexts, awaited, chained, optional: false },
  };
}
