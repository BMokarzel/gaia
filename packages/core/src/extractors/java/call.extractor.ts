import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { CallNode } from '../../types/topology';

export function extractJavaCalls(
  rootNode: SyntaxNode,
  filePath: string,
): CallNode[] {
  const nodes: CallNode[] = [];

  for (const node of findAll(rootNode, 'method_invocation')) {
    const call = buildCallNode(node, filePath);
    if (call) nodes.push(call);
  }

  // object_creation_expression: new SomeClass(args)
  for (const node of findAll(rootNode, 'object_creation_expression')) {
    // Skip anonymous class bodies — those are handled as FunctionNodes
    if (node.childForFieldName('class_body')) continue;
    const call = buildNewCallNode(node, filePath);
    if (call) nodes.push(call);
  }

  // method_reference: ClassName::method or instance::method
  for (const node of findAll(rootNode, 'method_reference')) {
    const call = buildMethodRefNode(node, filePath);
    if (call) nodes.push(call);
  }

  return nodes;
}

/**
 * Unwraps a chained object node to produce a clean callee prefix.
 * a.b().c() → obj for .c() is method_invocation(a.b())
 * We extract: "a.b.c" instead of "a.b().c"
 */
function unwrapCallObject(objectNode: SyntaxNode): string {
  if (objectNode.type === 'method_invocation') {
    const innerObj = objectNode.childForFieldName('object');
    const methodName = objectNode.childForFieldName('name')?.text ?? '';
    if (innerObj) {
      return `${unwrapCallObject(innerObj)}.${methodName}`;
    }
    return methodName;
  }
  if (objectNode.type === 'field_access') {
    // this.field or obj.field — already a clean reference
    const obj = objectNode.childForFieldName('object')?.text ?? '';
    const field = objectNode.childForFieldName('field')?.text ?? '';
    return obj && field ? `${obj}.${field}` : objectNode.text;
  }
  // identifier, this, super, type_identifier — return as-is
  return objectNode.text;
}

function buildCallNode(node: SyntaxNode, filePath: string): CallNode | null {
  const methodName = node.childForFieldName('name')?.text;
  if (!methodName) return null;

  const objectNode = node.childForFieldName('object');
  const callee = objectNode
    ? `${unwrapCallObject(objectNode)}.${methodName}`
    : methodName;

  const args = node.childForFieldName('arguments');
  const argList = args?.namedChildren.map(a => a.text.slice(0, 200)) ?? [];

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
      arguments: argList,
      awaited: false,
      chained: objectNode?.type === 'method_invocation',
      optional: false,
    },
  };
}

function buildNewCallNode(node: SyntaxNode, filePath: string): CallNode | null {
  const typeNode = node.childForFieldName('type');
  if (!typeNode) return null;

  const callee = `new ${typeNode.text}`;
  const args = node.childForFieldName('arguments');
  const argList = args?.namedChildren.map(a => a.text.slice(0, 200)) ?? [];

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
      arguments: argList,
      awaited: false,
      chained: false,
      optional: false,
    },
  };
}

function buildMethodRefNode(node: SyntaxNode, filePath: string): CallNode | null {
  // method_reference structure: [type/expression] '::' [identifier | 'new']
  const namedChildren = node.namedChildren;
  if (namedChildren.length < 1) return null;

  const receiver = namedChildren[0]?.text ?? '?';
  // The method name is the last named child (after '::' token)
  const methodPart = namedChildren[namedChildren.length - 1]?.text ?? '?';
  const callee = `${receiver}::${methodPart}`;

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
      arguments: [],
      awaited: false,
      chained: false,
      optional: false,
      isMethodRef: true,
    } as CallNode['metadata'] & { isMethodRef: boolean },
  };
}
