import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, nodeText } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type {
  FlowControlNode, ReturnNode, ThrowNode, CodeNode,
} from '../../types/topology';

/**
 * Extrai nós de controle de fluxo de arquivos Java.
 * Detecta: if/else, for, for-each, while, do-while, switch, try/catch/finally,
 *          return, throw.
 */
export function extractJavaFlowControl(
  rootNode: SyntaxNode,
  filePath: string,
): CodeNode[] {
  const nodes: CodeNode[] = [];

  for (const node of findAll(rootNode, 'if_statement')) {
    nodes.push(buildJavaIfNode(node, filePath));
  }

  for (const node of findAll(rootNode, 'for_statement')) {
    nodes.push(buildJavaLoopNode(node, filePath, 'for'));
  }
  // enhanced for: for (Type var : collection)
  for (const node of findAll(rootNode, 'enhanced_for_statement')) {
    nodes.push(buildJavaLoopNode(node, filePath, 'for_of'));
  }
  for (const node of findAll(rootNode, 'while_statement')) {
    nodes.push(buildJavaLoopNode(node, filePath, 'while'));
  }
  for (const node of findAll(rootNode, 'do_statement')) {
    nodes.push(buildJavaLoopNode(node, filePath, 'do_while'));
  }

  // switch statement (Java < 14) e switch expression (Java 14+)
  for (const node of findAll(rootNode, 'switch_statement').concat(findAll(rootNode, 'switch_expression'))) {
    nodes.push(buildJavaSwitchNode(node, filePath));
  }

  for (const node of findAll(rootNode, 'try_statement')) {
    nodes.push(...buildJavaTryCatchNodes(node, filePath));
  }

  // try-with-resources
  for (const node of findAll(rootNode, 'try_with_resources_statement')) {
    nodes.push(...buildJavaTryCatchNodes(node, filePath));
  }

  for (const node of findAll(rootNode, 'return_statement')) {
    nodes.push(buildJavaReturnNode(node, filePath));
  }

  for (const node of findAll(rootNode, 'throw_statement')) {
    nodes.push(buildJavaThrowNode(node, filePath));
  }

  return nodes;
}

// ─────────────────────────────────────────────────────────────────
// Builders
// ─────────────────────────────────────────────────────────────────

function buildJavaIfNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  const id = nodeId('flowControl', filePath, loc.line, 'if');

  const condition = node.childForFieldName('condition');
  const condText = condition ? nodeText(condition).slice(0, 200) : undefined;

  const branches: { label: string; children: CodeNode[] }[] = [
    { label: 'then', children: [] },
  ];
  const alt = node.childForFieldName('alternative');
  if (alt) {
    branches.push({
      label: alt.type === 'if_statement' ? 'else_if' : 'else',
      children: [],
    });
  }

  return {
    id,
    type: 'flowControl',
    name: `if (${condText ?? ''})`,
    location: loc,
    children: [],
    metadata: { kind: 'if', condition: condText, branches },
  };
}

function buildJavaLoopNode(
  node: SyntaxNode,
  filePath: string,
  kind: FlowControlNode['metadata']['kind'],
): FlowControlNode {
  const loc = toLocation(node, filePath);
  const id = nodeId('flowControl', filePath, loc.line, String(kind));

  let condition: string | undefined;
  const header = node.text.split('{')[0].trim();

  switch (kind) {
    case 'for':
      // for (init; condition; update)
      condition = header.replace(/^for\s*\(/, '').replace(/\)\s*$/, '').slice(0, 150);
      break;
    case 'for_of':
      // for (Type var : collection)
      condition = header.replace(/^for\s*\(/, '').replace(/\)\s*$/, '').slice(0, 150);
      break;
    case 'while': {
      const cond = node.childForFieldName('condition');
      condition = cond ? nodeText(cond).slice(0, 150) : undefined;
      break;
    }
    case 'do_while': {
      const cond = node.childForFieldName('condition');
      condition = cond ? nodeText(cond).slice(0, 150) : undefined;
      break;
    }
  }

  return {
    id,
    type: 'flowControl',
    name: String(kind),
    location: loc,
    children: [],
    metadata: { kind, condition },
  };
}

function buildJavaSwitchNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  const id = nodeId('flowControl', filePath, loc.line, 'switch');

  // Suporte a switch(expr) e switch expressions (Java 14+)
  const condition = node.childForFieldName('condition') ?? node.childForFieldName('value');
  const condText = condition ? nodeText(condition).slice(0, 100) : undefined;

  // Detecta labels: switch_label (case X:) e switch_rule (case X ->)
  const caseLabels = findAll(node, 'switch_label').concat(findAll(node, 'switch_rule'));
  const branches: { label: string; children: CodeNode[] }[] = caseLabels.map(c => {
    const text = c.text.replace(/:|\s*->.*$/s, '').trim().slice(0, 60);
    return { label: text || 'default', children: [] };
  });

  return {
    id,
    type: 'flowControl',
    name: `switch (${condText ?? ''})`,
    location: loc,
    children: [],
    metadata: { kind: 'switch', condition: condText, branches },
  };
}

function buildJavaTryCatchNodes(node: SyntaxNode, filePath: string): FlowControlNode[] {
  const result: FlowControlNode[] = [];
  const loc = toLocation(node, filePath);

  result.push({
    id: nodeId('flowControl', filePath, loc.line, 'try'),
    type: 'flowControl',
    name: 'try',
    location: loc,
    children: [],
    metadata: { kind: 'try' },
  });

  // catch_clause: catch (ExceptionType e)
  for (const catchClause of findAll(node, 'catch_clause')) {
    const catchLoc = toLocation(catchClause, filePath);

    // catch_formal_parameter → catch_type (pode ser "IOException | SQLException")
    const catchParam = catchClause.childForFieldName('catch_formal_parameter');
    const exType =
      catchParam?.childForFieldName('catch_type')?.text ??
      catchParam?.childForFieldName('type')?.text ??
      'Exception';

    result.push({
      id: nodeId('flowControl', filePath, catchLoc.line, 'catch'),
      type: 'flowControl',
      name: `catch (${exType})`,
      location: catchLoc,
      children: [],
      metadata: { kind: 'catch', condition: exType },
    });
  }

  // finally_clause
  const finallyClause =
    node.childForFieldName('finally_clause') ??
    node.children.find(c => c.type === 'finally_clause');
  if (finallyClause) {
    const finallyLoc = toLocation(finallyClause, filePath);
    result.push({
      id: nodeId('flowControl', filePath, finallyLoc.line, 'finally'),
      type: 'flowControl',
      name: 'finally',
      location: finallyLoc,
      children: [],
      metadata: { kind: 'finally' },
    });
  }

  return result;
}

function buildJavaReturnNode(node: SyntaxNode, filePath: string): ReturnNode {
  const loc = toLocation(node, filePath);
  const id = nodeId('return', filePath, loc.line, 'return');

  const valueNode = node.namedChildren[0];
  const valueText = valueNode ? nodeText(valueNode).slice(0, 200) : undefined;

  return {
    id,
    type: 'return',
    name: 'return',
    location: loc,
    children: [],
    metadata: {
      kind: valueText ? 'explicit' : 'implicit',
      value: valueText,
      httpStatus: detectJavaHttpStatus(valueText),
      responseType: valueText?.includes('.build()') || valueText?.includes('ResponseEntity') ? 'json' : undefined,
    },
  };
}

function buildJavaThrowNode(node: SyntaxNode, filePath: string): ThrowNode {
  const loc = toLocation(node, filePath);
  const id = nodeId('throw', filePath, loc.line, 'throw');

  const exprNode = node.namedChildren[0];
  let errorClass = 'Exception';
  let message: string | undefined;
  let httpStatus: number | undefined;

  if (exprNode) {
    if (exprNode.type === 'object_creation_expression') {
      // new SomeException("message")
      const typeNode = exprNode.childForFieldName('type');
      errorClass = typeNode?.text ?? 'Exception';

      const args = exprNode.childForFieldName('arguments');
      if (args?.namedChildren[0]) {
        message = args.namedChildren[0].text.replace(/^["']|["']$/g, '').slice(0, 200);
      }
    } else if (exprNode.type === 'method_invocation') {
      // ResponseStatusException.builder()... ou similar
      errorClass = exprNode.text.split('(')[0].trim().slice(0, 80);
    } else {
      errorClass = exprNode.text.split('(')[0].trim().slice(0, 80);
    }

    httpStatus = detectJavaHttpStatusFromClass(errorClass);
    if (!httpStatus) httpStatus = detectJavaHttpStatus(exprNode.text);
  }

  return {
    id,
    type: 'throw',
    name: `throw ${errorClass}`,
    location: loc,
    children: [],
    metadata: {
      kind: 'throw',
      errorClass,
      message,
      httpStatus,
      propagates: true,
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function detectJavaHttpStatus(value: string | undefined): number | undefined {
  if (!value) return undefined;
  // .status(404) ou HttpStatus.NOT_FOUND ou new ResponseStatusException(HttpStatus.NOT_FOUND)
  const byCode = value.match(/\.status\(\s*(\d{3})\s*\)/);
  if (byCode) return parseInt(byCode[1], 10);

  const byName = value.match(/HttpStatus\.([A-Z_]+)/);
  if (byName) return JAVA_HTTP_STATUS_MAP[byName[1]];

  return undefined;
}

function detectJavaHttpStatusFromClass(cls: string): number | undefined {
  const map: Record<string, number> = {
    NotFoundException: 404,
    ResourceNotFoundException: 404,
    EntityNotFoundException: 404,
    BadRequestException: 400,
    IllegalArgumentException: 400,
    UnauthorizedException: 401,
    AccessDeniedException: 403,
    ForbiddenException: 403,
    ConflictException: 409,
    DataIntegrityViolationException: 409,
    ValidationException: 422,
    ConstraintViolationException: 422,
    UnsupportedOperationException: 501,
    InternalServerErrorException: 500,
    ResponseStatusException: 400,
  };
  return map[cls];
}

const JAVA_HTTP_STATUS_MAP: Record<string, number> = {
  OK: 200, CREATED: 201, ACCEPTED: 202, NO_CONTENT: 204,
  MOVED_PERMANENTLY: 301, FOUND: 302, NOT_MODIFIED: 304,
  BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403,
  NOT_FOUND: 404, METHOD_NOT_ALLOWED: 405, CONFLICT: 409,
  GONE: 410, UNPROCESSABLE_ENTITY: 422, TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500, NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502, SERVICE_UNAVAILABLE: 503, GATEWAY_TIMEOUT: 504,
};
