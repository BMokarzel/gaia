import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { ProcessNode } from '../../types/topology';

/**
 * Extrai expressões de atribuição (reatribuições) de um arquivo TypeScript/JavaScript.
 * Captura: =, +=, -=, *=, /=, |=, &=, etc.
 * NÃO captura declarações (const x = 1 usa variable_declarator, não assignment_expression).
 */
export function extractAssignments(
  rootNode: SyntaxNode,
  filePath: string,
): ProcessNode[] {
  const nodes: ProcessNode[] = [];

  for (const node of findAll(rootNode, 'assignment_expression')) {
    const loc = toLocation(node, filePath);

    const left = node.childForFieldName('left');
    const operator = node.childForFieldName('operator');
    const right = node.childForFieldName('right');

    if (!left) continue;

    const targetName = left.text.slice(0, 100);
    const op = operator?.text ?? '=';
    const valueText = right?.text?.slice(0, 200);
    const description = valueText
      ? `${targetName} ${op} ${valueText}`
      : `${targetName} ${op} ...`;

    const id = nodeId('process', filePath, loc.line, `assign:${targetName}`);

    nodes.push({
      id,
      type: 'process',
      name: description.slice(0, 120),
      location: loc,
      children: [],
      metadata: {
        kind: 'assignment',
        operator: op,
        description,
      },
    });
  }

  return nodes;
}
