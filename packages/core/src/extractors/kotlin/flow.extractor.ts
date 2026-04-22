import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { FlowControlNode, ReturnNode, ThrowNode, CodeNode } from '../../types/topology';

export function extractKotlinFlowControl(
  rootNode: SyntaxNode,
  filePath: string,
): CodeNode[] {
  const nodes: CodeNode[] = [];

  for (const node of findAll(rootNode, 'if_expression')) {
    nodes.push(buildIfNode(node, filePath));
  }

  for (const node of findAll(rootNode, 'when_expression')) {
    nodes.push(buildWhenNode(node, filePath));
  }

  for (const node of findAll(rootNode, 'for_statement')) {
    nodes.push(buildForNode(node, filePath));
  }

  for (const node of findAll(rootNode, 'while_statement')) {
    nodes.push(buildWhileNode(node, filePath));
  }

  for (const node of findAll(rootNode, 'do_while_statement')) {
    nodes.push(buildDoWhileNode(node, filePath));
  }

  for (const node of findAll(rootNode, 'try_expression')) {
    nodes.push(...buildTryCatchNodes(node, filePath));
  }

  for (const node of findAll(rootNode, 'jump_expression')) {
    const jmpNode = buildJumpNode(node, filePath);
    if (jmpNode) nodes.push(jmpNode);
  }

  return nodes;
}

function buildIfNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);

  // In Kotlin AST: if_expression { "if" "(" expr ")" body ("else" body)? }
  // condition is the first non-keyword named child (parenthesized_expression or the expression itself)
  const condition = node.namedChildren.find(c =>
    c.type === 'parenthesized_expression' ||
    (!['control_structure_body', 'block'].includes(c.type) && c.isNamed)
  );
  const condText = condition?.text?.replace(/^\(|\)$/g, '').slice(0, 200);

  const branches: { label: string; children: CodeNode[] }[] = [{ label: 'then', children: [] }];
  const hasElse = node.children.some(c => c.type === 'else');
  if (hasElse) {
    const elseBody = node.namedChildren[node.namedChildren.length - 1];
    const isElseIf = elseBody?.type === 'if_expression' ||
      elseBody?.namedChildren.some(c => c.type === 'if_expression');
    branches.push({ label: isElseIf ? 'else_if' : 'else', children: [] });
  }

  return {
    id: nodeId('flowControl', filePath, loc.line, 'if'),
    type: 'flowControl',
    name: `if (${condText ?? ''})`,
    location: loc,
    children: [],
    metadata: { kind: 'if', condition: condText, branches },
  };
}

function buildWhenNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);

  // when_expression { "when" ("(" expr ")")? "{" when_entry* "}" }
  const subject = node.namedChildren.find(c => c.type === 'when_subject');
  const subjectText = subject?.text?.replace(/^\(|\)$/g, '').slice(0, 100);

  const entries = node.namedChildren.filter(c => c.type === 'when_entry');
  const branches = entries.map((e, i) => {
    const cond = e.namedChildren.find(c => c.type === 'when_condition');
    return { label: cond?.text?.slice(0, 50) ?? `case${i}`, children: [] as CodeNode[] };
  });

  return {
    id: nodeId('flowControl', filePath, loc.line, 'switch'),
    type: 'flowControl',
    name: `when${subjectText ? ` (${subjectText})` : ''}`,
    location: loc,
    children: [],
    metadata: { kind: 'switch', condition: subjectText, branches },
  };
}

function buildForNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  // for_statement { "for" "(" variable "in" expression ")" body }
  const children = node.namedChildren;
  const varNode = children.find(c =>
    c.type === 'multi_variable_declaration' || c.type === 'variable_declaration'
  );
  const inExpr = children.find(c =>
    c !== varNode && c.type !== 'control_structure_body' && c.type !== 'block' && c.isNamed
  );
  const condition = `${varNode?.text ?? '_'} in ${inExpr?.text?.slice(0, 80) ?? '...'}`;

  return {
    id: nodeId('flowControl', filePath, loc.line, 'for_in'),
    type: 'flowControl',
    name: 'for',
    location: loc,
    children: [],
    metadata: { kind: 'for_in', condition },
  };
}

function buildWhileNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  const cond = node.namedChildren.find(c => c.type === 'parenthesized_expression');
  const condition = cond?.text?.replace(/^\(|\)$/g, '').slice(0, 100);

  return {
    id: nodeId('flowControl', filePath, loc.line, 'while'),
    type: 'flowControl',
    name: 'while',
    location: loc,
    children: [],
    metadata: { kind: 'while', condition },
  };
}

function buildDoWhileNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  const cond = node.namedChildren.find(c => c.type === 'parenthesized_expression');
  const condition = cond?.text?.replace(/^\(|\)$/g, '').slice(0, 100);

  return {
    id: nodeId('flowControl', filePath, loc.line, 'do_while'),
    type: 'flowControl',
    name: 'do_while',
    location: loc,
    children: [],
    metadata: { kind: 'do_while', condition },
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

  for (const catchBlock of node.namedChildren.filter(c => c.type === 'catch_block')) {
    const catchLoc = toLocation(catchBlock, filePath);
    // catch_block { "catch" "(" simple_identifier ":" type ")" block }
    const paramText = catchBlock.namedChildren
      .filter(c => c.type === 'simple_identifier' || c.type === 'user_type' || c.type === 'type_reference')
      .map(c => c.text)
      .join(': ')
      .slice(0, 100) || 'Exception e';

    nodes.push({
      id: nodeId('flowControl', filePath, catchLoc.line, 'catch'),
      type: 'flowControl',
      name: `catch (${paramText})`,
      location: catchLoc,
      children: [],
      metadata: { kind: 'catch', condition: paramText },
    });
  }

  const finallyBlock = node.namedChildren.find(c => c.type === 'finally_block');
  if (finallyBlock) {
    const finallyLoc = toLocation(finallyBlock, filePath);
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

function buildJumpNode(node: SyntaxNode, filePath: string): ReturnNode | ThrowNode | null {
  const loc = toLocation(node, filePath);

  // jump_expression first non-named child is the keyword
  const keyword = node.children.find(c => !c.isNamed)?.type ??
    node.children[0]?.type ?? '';

  if (keyword === 'return') {
    const valueNode = node.namedChildren[0];
    const valueText = valueNode?.text?.slice(0, 200);
    return {
      id: nodeId('return', filePath, loc.line, 'return'),
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

  if (keyword === 'throw') {
    const valueNode = node.namedChildren[0];
    let errorClass = 'Exception';
    let message: string | undefined;

    if (valueNode) {
      // call_expression like IllegalArgumentException("msg")
      if (valueNode.type === 'call_expression') {
        const callee = valueNode.namedChildren[0];
        errorClass = callee?.text?.split('(')[0] ?? 'Exception';
        const args = valueNode.namedChildren.find(c => c.type === 'value_arguments');
        const firstArg = args?.namedChildren[0];
        if (firstArg) {
          message = firstArg.text.replace(/^["']|["']$/g, '').slice(0, 200);
        }
      } else {
        errorClass = valueNode.text.split('(')[0];
      }
    }

    const httpStatus = detectHttpStatus(errorClass);
    return {
      id: nodeId('throw', filePath, loc.line, 'throw'),
      type: 'throw',
      name: `throw ${errorClass}`,
      location: loc,
      children: [],
      metadata: { kind: 'throw', errorClass, message, httpStatus, propagates: true },
    };
  }

  return null;
}

function detectHttpStatus(name: string): number | undefined {
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
