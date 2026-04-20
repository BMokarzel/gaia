import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { DataNode, TypedField } from '../../types/topology';

export function extractCSharpDataNodes(
  rootNode: SyntaxNode,
  filePath: string,
): DataNode[] {
  const nodes: DataNode[] = [];

  // Class declarations (DTOs, models, entities)
  for (const node of findAll(rootNode, 'class_declaration')) {
    const name = node.childForFieldName('name')?.text ?? 'Unknown';
    const loc = toLocation(node, filePath);
    const modifiers = node.childForFieldName('modifiers')?.text ?? '';

    // Skip controllers/services — handled by endpoint/function extractors
    const attrs = findAll(node, 'attribute').map(a => a.text);
    if (attrs.some(a => /ApiController|Controller|Service/.test(a))) continue;

    const fields = extractCSharpClassFields(node);

    nodes.push({
      id: nodeId('data', filePath, loc.line, name),
      type: 'data', name,
      location: loc, children: [],
      metadata: {
        kind: 'interface',
        mutable: false,
        scope: 'module' as const,
        fields,
        exported: modifiers.includes('public'),
      },
    });
  }

  // Interface declarations
  for (const node of findAll(rootNode, 'interface_declaration')) {
    const name = node.childForFieldName('name')?.text ?? 'Unknown';
    const loc = toLocation(node, filePath);
    const modifiers = node.childForFieldName('modifiers')?.text ?? '';
    const body = node.childForFieldName('declaration_list') ?? node;
    const fields = findAll(body, 'method_declaration').map((m): TypedField => ({
      name: m.childForFieldName('name')?.text ?? '',
      type: m.childForFieldName('type')?.text ?? 'void',
      required: true,
    })).filter(f => f.name);

    nodes.push({
      id: nodeId('data', filePath, loc.line, name),
      type: 'data', name,
      location: loc, children: [],
      metadata: {
        kind: 'interface',
        mutable: false,
        scope: 'module' as const,
        fields,
        exported: modifiers.includes('public'),
      },
    });
  }

  // Record declarations (C# 9+)
  for (const node of findAll(rootNode, 'record_declaration')) {
    const name = node.childForFieldName('name')?.text ?? 'Unknown';
    const loc = toLocation(node, filePath);
    const modifiers = node.childForFieldName('modifiers')?.text ?? '';
    const paramList = node.childForFieldName('parameter_list');
    const fields = paramList
      ? findAll(paramList, 'parameter').map((p): TypedField => ({
          name: p.childForFieldName('name')?.text ?? '',
          type: p.childForFieldName('type')?.text ?? 'object',
          required: true,
        })).filter(f => f.name)
      : [];

    nodes.push({
      id: nodeId('data', filePath, loc.line, name),
      type: 'data', name,
      location: loc, children: [],
      metadata: {
        kind: 'interface',
        mutable: false,
        scope: 'module' as const,
        fields,
        exported: modifiers.includes('public'),
      },
    });
  }

  // Enum declarations
  for (const node of findAll(rootNode, 'enum_declaration')) {
    const name = node.childForFieldName('name')?.text ?? 'Unknown';
    const loc = toLocation(node, filePath);
    const modifiers = node.childForFieldName('modifiers')?.text ?? '';
    const body = node.childForFieldName('declaration_list') ?? node;
    const fields = findAll(body, 'enum_member_declaration').map((m): TypedField => ({
      name: m.childForFieldName('name')?.text ?? m.namedChildren[0]?.text ?? '',
      type: 'enum_value',
      required: true,
    })).filter(f => f.name);

    nodes.push({
      id: nodeId('data', filePath, loc.line, name),
      type: 'data', name,
      location: loc, children: [],
      metadata: {
        kind: 'enum',
        mutable: false,
        scope: 'module' as const,
        fields,
        exported: modifiers.includes('public'),
      },
    });
  }

  return nodes;
}

function extractCSharpClassFields(classNode: SyntaxNode): TypedField[] {
  const fields: TypedField[] = [];
  const body = classNode.childForFieldName('declaration_list') ?? classNode;

  for (const prop of findAll(body, 'property_declaration')) {
    const nameNode = prop.childForFieldName('name') ?? prop.children.find(c => c.type === 'identifier');
    const typeNode = prop.childForFieldName('type');
    if (!nameNode) continue;

    const typeName = typeNode?.text ?? 'object';
    const modifiers = prop.childForFieldName('modifiers')?.text ?? '';

    fields.push({
      name: nameNode.text,
      type: typeName.replace('?', ''),
      required: !typeName.endsWith('?') && !modifiers.includes('?'),
    });
  }

  for (const field of findAll(body, 'field_declaration')) {
    const decls = findAll(field, 'variable_declarator');
    const typeNode = field.childForFieldName('type') ?? field.childForFieldName('declaration')?.childForFieldName('type');
    const typeName = typeNode?.text ?? 'object';

    for (const decl of decls) {
      const nameNode = decl.childForFieldName('identifier') ?? decl.namedChildren[0];
      if (!nameNode) continue;
      fields.push({
        name: nameNode.text,
        type: typeName.replace('?', ''),
        required: !typeName.endsWith('?'),
      });
    }
  }

  return fields;
}
