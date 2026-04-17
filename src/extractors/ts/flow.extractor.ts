import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, nodeText } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type {
  FlowControlNode, ReturnNode, ThrowNode, CodeNode,
} from '../../types/topology';

/**
 * Extrai nós de controle de fluxo de um arquivo TypeScript/JavaScript.
 * Detecta: if/else, switch, loops, try/catch, return, throw
 */
export function extractFlowControl(
  rootNode: SyntaxNode,
  filePath: string,
): CodeNode[] {
  const nodes: CodeNode[] = [];

  // If statements
  for (const node of findAll(rootNode, 'if_statement')) {
    nodes.push(buildIfNode(node, filePath));
  }

  // Switch statements
  for (const node of findAll(rootNode, 'switch_statement')) {
    nodes.push(buildSwitchNode(node, filePath));
  }

  // For loops
  for (const node of findAll(rootNode, 'for_statement')) {
    nodes.push(buildLoopNode(node, filePath, 'for'));
  }
  for (const node of findAll(rootNode, 'for_in_statement')) {
    nodes.push(buildLoopNode(node, filePath, 'for_in'));
  }
  for (const node of findAll(rootNode, 'for_of_statement')) {
    nodes.push(buildLoopNode(node, filePath, 'for_of'));
  }
  for (const node of findAll(rootNode, 'while_statement')) {
    nodes.push(buildLoopNode(node, filePath, 'while'));
  }
  for (const node of findAll(rootNode, 'do_statement')) {
    nodes.push(buildLoopNode(node, filePath, 'do_while'));
  }

  // Try/catch/finally
  for (const node of findAll(rootNode, 'try_statement')) {
    nodes.push(...buildTryCatchNodes(node, filePath));
  }

  // Return statements
  for (const node of findAll(rootNode, 'return_statement')) {
    nodes.push(buildReturnNode(node, filePath));
  }

  // Throw statements
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

  return {
    id,
    type: 'flowControl',
    name: `if (${condText ?? ''})`,
    location: loc,
    children: [],
    metadata: {
      kind: 'if',
      condition: condText,
      branches: buildIfBranches(node),
    },
  };
}

function buildIfBranches(node: SyntaxNode): { label: string; children: CodeNode[] }[] {
  const branches: { label: string; children: CodeNode[] }[] = [];

  const consequence = node.childForFieldName('consequence');
  if (consequence) {
    branches.push({ label: 'then', children: [] });
  }

  const alternative = node.childForFieldName('alternative');
  if (alternative) {
    const label = alternative.type === 'if_statement' ? 'else_if' : 'else';
    branches.push({ label, children: [] });
  }

  return branches;
}

function buildSwitchNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  const value = node.childForFieldName('value');
  const valText = value ? nodeText(value).slice(0, 100) : undefined;
  const id = nodeId('flowControl', filePath, loc.line, 'switch');

  const body = node.childForFieldName('body');
  const cases: { label: string; children: CodeNode[] }[] = [];

  if (body) {
    for (const child of body.namedChildren) {
      if (child.type === 'switch_case') {
        const caseVal = child.childForFieldName('value');
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
    metadata: {
      kind: 'switch',
      condition: valText,
      branches: cases,
    },
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
  switch (kind) {
    case 'for': {
      const body = node.text.split('{')[0];
      condition = body.replace(/for\s*/, '').trim().slice(0, 100);
      break;
    }
    case 'for_of':
    case 'for_in': {
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      condition = `${left?.text ?? ''} ${kind === 'for_of' ? 'of' : 'in'} ${right?.text ?? ''}`;
      break;
    }
    case 'while':
    case 'do_while': {
      const cond = node.childForFieldName('condition');
      condition = cond ? nodeText(cond).slice(0, 100) : undefined;
      break;
    }
  }

  return {
    id,
    type: 'flowControl',
    name: kind,
    location: loc,
    children: [],
    metadata: {
      kind,
      condition,
    },
  };
}

function buildTryCatchNodes(node: SyntaxNode, filePath: string): FlowControlNode[] {
  const nodes: FlowControlNode[] = [];
  const loc = toLocation(node, filePath);

  // try block
  const tryId = nodeId('flowControl', filePath, loc.line, 'try');
  nodes.push({
    id: tryId,
    type: 'flowControl',
    name: 'try',
    location: loc,
    children: [],
    metadata: { kind: 'try' },
  });

  // catch clause
  const catchClause = node.childForFieldName('handler');
  if (catchClause) {
    const catchLoc = toLocation(catchClause, filePath);
    const param = catchClause.childForFieldName('parameter');
    const catchId = nodeId('flowControl', filePath, catchLoc.line, 'catch');
    nodes.push({
      id: catchId,
      type: 'flowControl',
      name: `catch (${param?.text ?? 'error'})`,
      location: catchLoc,
      children: [],
      metadata: {
        kind: 'catch',
        condition: param?.text,
      },
    });
  }

  // finally clause
  const finallyClause = node.childForFieldName('finalizer');
  if (finallyClause) {
    const finallyLoc = toLocation(finallyClause, filePath);
    const finallyId = nodeId('flowControl', filePath, finallyLoc.line, 'finally');
    nodes.push({
      id: finallyId,
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

  // Detecta se é uma resposta HTTP
  const httpStatus = detectHttpStatus(valueNode);
  const responseType = detectResponseType(valueNode);

  return {
    id,
    type: 'return',
    name: 'return',
    location: loc,
    children: [],
    metadata: {
      kind: valueNode ? 'explicit' : 'implicit',
      value: valueText,
      httpStatus,
      responseType,
    },
  };
}

function buildThrowNode(node: SyntaxNode, filePath: string): ThrowNode {
  const loc = toLocation(node, filePath);
  const valueNode = node.namedChildren[0];
  const id = nodeId('throw', filePath, loc.line, 'throw');

  let errorClass = 'Error';
  let message: string | undefined;
  let httpStatus: number | undefined;

  if (valueNode) {
    // new ErrorClass('message')
    if (valueNode.type === 'new_expression') {
      const constructor = valueNode.childForFieldName('constructor');
      errorClass = constructor?.text ?? 'Error';

      const args = valueNode.childForFieldName('arguments');
      if (args?.namedChildren[0]) {
        const rawMsg = args.namedChildren[0].text.replace(/^['"`]|['"`]$/g, '');
        message = rawMsg.slice(0, 200);
      }

      // Detecta HTTP status a partir do nome da classe
      httpStatus = detectHttpStatusFromErrorClass(errorClass);
    } else {
      errorClass = valueNode.text.split('(')[0] ?? 'Error';
    }
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

function detectHttpStatus(node: SyntaxNode | undefined): number | undefined {
  if (!node) return undefined;
  const text = node.text;

  // res.status(200).json() ou response.status(404)
  const statusMatch = text.match(/\.status\((\d{3})\)/);
  if (statusMatch) return parseInt(statusMatch[1], 10);

  // { statusCode: 201 }
  const statusCodeMatch = text.match(/statusCode\s*:\s*(\d{3})/);
  if (statusCodeMatch) return parseInt(statusCodeMatch[1], 10);

  return undefined;
}

function detectResponseType(node: SyntaxNode | undefined): ReturnNode['metadata']['responseType'] | undefined {
  if (!node) return undefined;
  const text = node.text;

  if (text.includes('.json(') || text.includes('JSON.stringify')) return 'json';
  if (text.includes('.redirect(')) return 'redirect';
  if (text.includes('.render(')) return 'html';
  if (text.includes('.sendFile(') || text.includes('.download(')) return 'file';
  if (text.includes('.pipe(') || text.includes('stream')) return 'stream';

  return undefined;
}

function detectHttpStatusFromErrorClass(className: string): number | undefined {
  const map: Record<string, number> = {
    NotFoundException: 404,
    BadRequestException: 400,
    UnauthorizedException: 401,
    ForbiddenException: 403,
    ConflictException: 409,
    InternalServerErrorException: 500,
    UnprocessableEntityException: 422,
    NotImplementedException: 501,
    ServiceUnavailableException: 503,
    HttpException: 400,
    NotFoundError: 404,
    ValidationError: 400,
    AuthenticationError: 401,
    AuthorizationError: 403,
  };
  return map[className];
}
