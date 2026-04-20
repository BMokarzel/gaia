import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, nodeText } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { FlowControlNode, ReturnNode, ThrowNode, CodeNode } from '../../types/topology';

export function extractJavaFlowControl(
  rootNode: SyntaxNode,
  filePath: string,
): CodeNode[] {
  const nodes: CodeNode[] = [];

  for (const node of findAll(rootNode, 'if_statement')) {
    nodes.push(buildIfNode(node, filePath));
  }

  for (const node of findAll(rootNode, 'switch_expression').concat(findAll(rootNode, 'switch_statement'))) {
    nodes.push(buildSwitchNode(node, filePath));
  }

  for (const node of findAll(rootNode, 'for_statement')) {
    nodes.push(buildLoopNode(node, filePath, 'for'));
  }
  for (const node of findAll(rootNode, 'enhanced_for_statement')) {
    nodes.push(buildLoopNode(node, filePath, 'for_in'));
  }
  for (const node of findAll(rootNode, 'while_statement')) {
    nodes.push(buildLoopNode(node, filePath, 'while'));
  }
  for (const node of findAll(rootNode, 'do_statement')) {
    nodes.push(buildLoopNode(node, filePath, 'do_while'));
  }

  for (const node of findAll(rootNode, 'try_statement')) {
    nodes.push(...buildTryCatchNodes(node, filePath));
  }

  for (const node of findAll(rootNode, 'return_statement')) {
    nodes.push(buildReturnNode(node, filePath));
  }

  for (const node of findAll(rootNode, 'throw_statement')) {
    nodes.push(buildThrowNode(node, filePath));
  }

  return nodes;
}

function buildIfNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  const condition = node.childForFieldName('condition');
  const condText = condition ? nodeText(condition).slice(0, 200) : undefined;
  const id = nodeId('flowControl', filePath, loc.line, 'if');

  const branches: { label: string; children: CodeNode[] }[] = [{ label: 'then', children: [] }];
  const alt = node.childForFieldName('alternative');
  if (alt) branches.push({ label: alt.type === 'if_statement' ? 'else_if' : 'else', children: [] });

  return {
    id,
    type: 'flowControl',
    name: `if (${condText ?? ''})`,
    location: loc,
    children: [],
    metadata: { kind: 'if', condition: condText, branches },
  };
}

function buildSwitchNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  const value = node.childForFieldName('condition');
  const valText = value ? nodeText(value).slice(0, 100) : undefined;
  const id = nodeId('flowControl', filePath, loc.line, 'switch');

  const body = node.childForFieldName('body');
  const cases: { label: string; children: CodeNode[] }[] = [];

  if (body) {
    for (const child of body.namedChildren) {
      if (child.type === 'switch_label') {
        const caseVal = child.namedChildren[0];
        const label = caseVal ? `case ${nodeText(caseVal).slice(0, 50)}` : 'default';
        cases.push({ label, children: [] });
      }
    }
  }

  return {
    id,
    type: 'flowControl',
    name: `switch (${valText ?? ''})`,
    location: loc,
    children: [],
    metadata: { kind: 'switch', condition: valText, branches: cases },
  };
}

function buildLoopNode(
  node: SyntaxNode,
  filePath: string,
  kind: FlowControlNode['metadata']['kind'],
): FlowControlNode {
  const loc = toLocation(node, filePath);
  const id = nodeId('flowControl', filePath, loc.line, kind);

  let condition: string | undefined;
  if (kind === 'for_in') {
    // enhanced_for_statement: for (Type var : iterable)
    const typeNode = node.childForFieldName('type');
    const nameNode = node.childForFieldName('name');
    const valueNode = node.childForFieldName('value');
    condition = `${typeNode?.text ?? ''} ${nameNode?.text ?? ''} : ${valueNode?.text ?? ''}`;
  } else {
    const cond = node.childForFieldName('condition');
    condition = cond ? nodeText(cond).slice(0, 100) : undefined;
  }

  return {
    id,
    type: 'flowControl',
    name: kind,
    location: loc,
    children: [],
    metadata: { kind, condition },
  };
}

function buildTryCatchNodes(node: SyntaxNode, filePath: string): FlowControlNode[] {
  const nodes: FlowControlNode[] = [];
  const loc = toLocation(node, filePath);

  nodes.push({
    id: nodeId('flowControl', filePath, loc.line, 'try'),
    type: 'flowControl',
    name: 'try',
    location: loc,
    children: [],
    metadata: { kind: 'try' },
  });

  // Java catch_clause
  for (const catchNode of findAll(node, 'catch_clause')) {
    const catchLoc = toLocation(catchNode, filePath);
    const param = catchNode.childForFieldName('catch_formal_parameter') ?? catchNode.namedChildren[0];
    const paramText = param?.text ?? 'Exception e';
    nodes.push({
      id: nodeId('flowControl', filePath, catchLoc.line, 'catch'),
      type: 'flowControl',
      name: `catch (${paramText})`,
      location: catchLoc,
      children: [],
      metadata: { kind: 'catch', condition: paramText },
    });
  }

  const finallyNode = node.childForFieldName('finally_clause') ?? findAll(node, 'finally_clause')[0];
  if (finallyNode) {
    const finallyLoc = toLocation(finallyNode, filePath);
    nodes.push({
      id: nodeId('flowControl', filePath, finallyLoc.line, 'finally'),
      type: 'flowControl',
      name: 'finally',
      location: finallyLoc,
      children: [],
      metadata: { kind: 'finally' },
    });
  }

  return nodes;
}

function buildReturnNode(node: SyntaxNode, filePath: string): ReturnNode {
  const loc = toLocation(node, filePath);
  const valueNode = node.namedChildren[0];
  const valueText = valueNode ? nodeText(valueNode).slice(0, 200) : undefined;
  const id = nodeId('return', filePath, loc.line, 'return');

  return {
    id,
    type: 'return',
    name: 'return',
    location: loc,
    children: [],
    metadata: {
      kind: valueNode ? 'explicit' : 'implicit',
      value: valueText,
    },
  };
}

function buildThrowNode(node: SyntaxNode, filePath: string): ThrowNode {
  const loc = toLocation(node, filePath);
  const valueNode = node.namedChildren[0];
  const id = nodeId('throw', filePath, loc.line, 'throw');

  let errorClass = 'Exception';
  let message: string | undefined;

  if (valueNode?.type === 'object_creation_expression') {
    const typeNode = valueNode.childForFieldName('type');
    errorClass = typeNode?.text ?? 'Exception';
    const args = valueNode.childForFieldName('arguments');
    const firstArg = args?.namedChildren[0];
    if (firstArg) {
      message = firstArg.text.replace(/^["']|["']$/g, '').slice(0, 200);
    }
  } else if (valueNode) {
    errorClass = valueNode.text.split('(')[0];
  }

  const httpStatus = detectHttpStatusFromErrorClass(errorClass);

  return {
    id,
    type: 'throw',
    name: `throw ${errorClass}`,
    location: loc,
    children: [],
    metadata: { kind: 'throw', errorClass, message, httpStatus, propagates: true },
  };
}

function detectHttpStatusFromErrorClass(name: string): number | undefined {
  const map: Record<string, number> = {
    ResponseStatusException: 400,
    NotFoundException: 404,
    EntityNotFoundException: 404,
    BadRequestException: 400,
    UnauthorizedException: 401,
    ForbiddenException: 403,
    ConflictException: 409,
    InternalServerErrorException: 500,
    IllegalArgumentException: 400,
    IllegalStateException: 500,
  };
  return map[name];
}
