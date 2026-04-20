import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, nodeText } from '../../utils/ast-helpers';
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
    nodes.push(buildLoopNode(node, filePath, 'for_of'));
  }

  for (const node of findAll(rootNode, 'while_statement')) {
    nodes.push(buildLoopNode(node, filePath, 'while'));
  }

  for (const node of findAll(rootNode, 'do_while_statement')) {
    nodes.push(buildLoopNode(node, filePath, 'do_while'));
  }

  for (const node of findAll(rootNode, 'try_expression')) {
    nodes.push(...buildTryCatch(node, filePath));
  }

  for (const node of findAll(rootNode, 'return_at_expression').concat(findAll(rootNode, 'jump_expression'))) {
    if (node.text.startsWith('return')) nodes.push(buildReturn(node, filePath));
    else if (node.text.startsWith('throw')) nodes.push(buildThrow(node, filePath));
  }

  return nodes;
}

function buildIfNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  const condition = node.childForFieldName('condition');
  const condText = condition ? nodeText(condition).slice(0, 200) : undefined;
  const branches: { label: string; children: CodeNode[] }[] = [{ label: 'then', children: [] }];
  if (node.childForFieldName('else_body') ?? node.children.find(c => c.type === 'else')) {
    branches.push({ label: 'else', children: [] });
  }
  return {
    id: nodeId('flowControl', filePath, loc.line, 'if'),
    type: 'flowControl', name: `if (${condText ?? ''})`,
    location: loc, children: [],
    metadata: { kind: 'if', condition: condText, branches },
  };
}

function buildWhenNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  const subject = node.childForFieldName('subject');
  const condText = subject ? nodeText(subject).slice(0, 100) : undefined;
  const entries = findAll(node, 'when_entry');
  const branches: { label: string; children: CodeNode[] }[] = entries.map(e => {
    const cond = e.childForFieldName('condition') ?? e.namedChildren[0];
    const label = cond ? nodeText(cond).slice(0, 60) : 'else';
    return { label, children: [] };
  });
  return {
    id: nodeId('flowControl', filePath, loc.line, 'when'),
    type: 'flowControl', name: `when (${condText ?? ''})`,
    location: loc, children: [],
    metadata: { kind: 'switch', condition: condText, branches },
  };
}

function buildLoopNode(
  node: SyntaxNode, filePath: string,
  kind: FlowControlNode['metadata']['kind'],
): FlowControlNode {
  const loc = toLocation(node, filePath);
  const condition = node.childForFieldName('condition');
  const condText = condition ? nodeText(condition).slice(0, 150) : undefined;
  return {
    id: nodeId('flowControl', filePath, loc.line, String(kind)),
    type: 'flowControl', name: String(kind),
    location: loc, children: [],
    metadata: { kind, condition: condText },
  };
}

function buildTryCatch(node: SyntaxNode, filePath: string): FlowControlNode[] {
  const result: FlowControlNode[] = [];
  const loc = toLocation(node, filePath);
  result.push({
    id: nodeId('flowControl', filePath, loc.line, 'try'),
    type: 'flowControl', name: 'try',
    location: loc, children: [],
    metadata: { kind: 'try' },
  });
  for (const catch_ of findAll(node, 'catch_block')) {
    const catchLoc = toLocation(catch_, filePath);
    const param = catch_.childForFieldName('parameter') ?? catch_.namedChildren[0];
    const exType = param?.childForFieldName('type')?.text ?? 'Exception';
    result.push({
      id: nodeId('flowControl', filePath, catchLoc.line, 'catch'),
      type: 'flowControl', name: `catch (${exType})`,
      location: catchLoc, children: [],
      metadata: { kind: 'catch', condition: exType },
    });
  }
  const finally_ = node.childForFieldName('finally_block');
  if (finally_) {
    const fLoc = toLocation(finally_, filePath);
    result.push({
      id: nodeId('flowControl', filePath, fLoc.line, 'finally'),
      type: 'flowControl', name: 'finally',
      location: fLoc, children: [],
      metadata: { kind: 'finally' },
    });
  }
  return result;
}

function buildReturn(node: SyntaxNode, filePath: string): ReturnNode {
  const loc = toLocation(node, filePath);
  const value = node.namedChildren.find(c => c.type !== 'at_identifier')?.text?.slice(0, 200);
  return {
    id: nodeId('return', filePath, loc.line, 'return'),
    type: 'return', name: 'return',
    location: loc, children: [],
    metadata: { kind: value ? 'explicit' : 'implicit', value },
  };
}

function buildThrow(node: SyntaxNode, filePath: string): ThrowNode {
  const loc = toLocation(node, filePath);
  const expr = node.namedChildren[0];
  const errorClass = expr?.text.split('(')[0].trim() ?? 'Exception';
  return {
    id: nodeId('throw', filePath, loc.line, 'throw'),
    type: 'throw', name: `throw ${errorClass}`,
    location: loc, children: [],
    metadata: { kind: 'throw', errorClass, propagates: true },
  };
}
