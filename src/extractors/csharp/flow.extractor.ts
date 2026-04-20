import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, nodeText } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { FlowControlNode, ReturnNode, ThrowNode, CodeNode } from '../../types/topology';

export function extractCSharpFlowControl(
  rootNode: SyntaxNode,
  filePath: string,
): CodeNode[] {
  const nodes: CodeNode[] = [];

  for (const node of findAll(rootNode, 'if_statement')) {
    nodes.push(buildIfNode(node, filePath));
  }

  for (const node of findAll(rootNode, 'for_statement')) {
    nodes.push(buildLoopNode(node, filePath, 'for'));
  }

  for (const node of findAll(rootNode, 'for_each_statement')) {
    nodes.push(buildLoopNode(node, filePath, 'for_of'));
  }

  for (const node of findAll(rootNode, 'while_statement')) {
    nodes.push(buildLoopNode(node, filePath, 'while'));
  }

  for (const node of findAll(rootNode, 'do_statement')) {
    nodes.push(buildLoopNode(node, filePath, 'do_while'));
  }

  for (const node of findAll(rootNode, 'switch_statement')
      .concat(findAll(rootNode, 'switch_expression'))) {
    nodes.push(buildSwitchNode(node, filePath));
  }

  for (const node of findAll(rootNode, 'try_statement')) {
    nodes.push(...buildTryCatch(node, filePath));
  }

  for (const node of findAll(rootNode, 'return_statement')) {
    nodes.push(buildReturn(node, filePath));
  }

  for (const node of findAll(rootNode, 'throw_statement')
      .concat(findAll(rootNode, 'throw_expression'))) {
    nodes.push(buildThrow(node, filePath));
  }

  return nodes;
}

function buildIfNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  const condition = node.childForFieldName('condition');
  const condText = condition ? nodeText(condition).slice(0, 200) : undefined;
  const branches: { label: string; children: CodeNode[] }[] = [{ label: 'then', children: [] }];
  if (node.childForFieldName('alternative') ?? node.childForFieldName('else')) {
    branches.push({ label: 'else', children: [] });
  }
  return {
    id: nodeId('flowControl', filePath, loc.line, 'if'),
    type: 'flowControl', name: `if (${condText ?? ''})`,
    location: loc, children: [],
    metadata: { kind: 'if', condition: condText, branches },
  };
}

function buildLoopNode(
  node: SyntaxNode, filePath: string,
  kind: FlowControlNode['metadata']['kind'],
): FlowControlNode {
  const loc = toLocation(node, filePath);
  let condText: string | undefined;
  if (kind === 'for_of') {
    // foreach (var x in collection)
    const type_ = node.childForFieldName('type');
    const name = node.childForFieldName('identifier')?.text;
    const expr = node.childForFieldName('expression');
    condText = expr ? `${type_?.text ?? 'var'} ${name ?? '_'} in ${nodeText(expr).slice(0, 80)}` : undefined;
  } else {
    const cond = node.childForFieldName('condition');
    condText = cond ? nodeText(cond).slice(0, 150) : undefined;
  }
  return {
    id: nodeId('flowControl', filePath, loc.line, String(kind)),
    type: 'flowControl', name: String(kind),
    location: loc, children: [],
    metadata: { kind, condition: condText },
  };
}

function buildSwitchNode(node: SyntaxNode, filePath: string): FlowControlNode {
  const loc = toLocation(node, filePath);
  const expr = node.childForFieldName('value') ?? node.childForFieldName('expression');
  const condText = expr ? nodeText(expr).slice(0, 100) : undefined;

  const sections = findAll(node, 'switch_section').concat(findAll(node, 'switch_expression_arm'));
  const branches: { label: string; children: CodeNode[] }[] = sections.map(s => {
    const label = s.childForFieldName('labels')?.text ?? s.namedChildren[0]?.text ?? 'case';
    return { label: label.trim().slice(0, 60), children: [] };
  });

  return {
    id: nodeId('flowControl', filePath, loc.line, 'switch'),
    type: 'flowControl', name: `switch (${condText ?? ''})`,
    location: loc, children: [],
    metadata: { kind: 'switch', condition: condText, branches },
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

  for (const clause of findAll(node, 'catch_clause')) {
    const clauseLoc = toLocation(clause, filePath);
    const decl = clause.childForFieldName('declaration');
    const exType = decl?.childForFieldName('type')?.text ?? 'Exception';
    result.push({
      id: nodeId('flowControl', filePath, clauseLoc.line, 'catch'),
      type: 'flowControl', name: `catch (${exType})`,
      location: clauseLoc, children: [],
      metadata: { kind: 'catch', condition: exType },
    });
  }

  const finally_ = node.childForFieldName('finally_clause');
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
  const value = node.namedChildren[0]?.text?.slice(0, 200);
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
  let errorClass = 'Exception';
  if (expr?.type === 'object_creation_expression') {
    errorClass = expr.childForFieldName('type')?.text ?? 'Exception';
  } else if (expr) {
    errorClass = expr.text.split('(')[0].trim().slice(0, 80);
  }
  return {
    id: nodeId('throw', filePath, loc.line, 'throw'),
    type: 'throw', name: `throw ${errorClass}`,
    location: loc, children: [],
    metadata: { kind: 'throw', errorClass, propagates: true },
  };
}
