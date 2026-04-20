import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, fieldText } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { DataNode, TypedField } from '../../types/topology';

export function extractGoDataNodes(
  rootNode: SyntaxNode,
  filePath: string,
): DataNode[] {
  const nodes: DataNode[] = [];

  // Struct and interface declarations
  for (const decl of findAll(rootNode, 'type_declaration')) {
    for (const spec of findAll(decl, 'type_spec')) {
      const nameNode = spec.childForFieldName('name');
      const typeNode = spec.childForFieldName('type');
      if (!nameNode || !typeNode) continue;

      const name = nameNode.text;
      const loc = toLocation(spec, filePath);
      const id = nodeId('data', filePath, loc.line, name);

      if (typeNode.type === 'struct_type') {
        nodes.push({
          id,
          type: 'data',
          name,
          location: loc,
          children: [],
          metadata: {
            kind: 'interface',
            mutable: false,
            scope: 'module' as const,
            fields: extractStructFields(typeNode),
            exported: /^[A-Z]/.test(name),
          },
        });
      } else if (typeNode.type === 'interface_type') {
        nodes.push({
          id,
          type: 'data',
          name,
          location: loc,
          children: [],
          metadata: {
            kind: 'interface',
            mutable: false,
            scope: 'module' as const,
            fields: [],
            exported: /^[A-Z]/.test(name),
          },
        });
      }
    }
  }

  // Const block for enum-like iota declarations
  for (const decl of findAll(rootNode, 'const_declaration')) {
    const specs = findAll(decl, 'const_spec');
    if (specs.length < 2) continue;

    const firstSpec = specs[0];
    const loc = toLocation(decl, filePath);

    // Check if it looks like an iota enum
    const hasIota = specs.some(s => s.text.includes('iota'));
    if (!hasIota) continue;

    const enumName = inferEnumName(specs);
    if (!enumName) continue;

    const id = nodeId('data', filePath, loc.line, enumName);
    const fields = specs
      .map(s => s.childForFieldName('name')?.text ?? s.children[0]?.text)
      .filter(Boolean)
      .map((name): TypedField => ({ name: name as string, type: 'enum_value', required: true }));

    nodes.push({
      id,
      type: 'data',
      name: enumName,
      location: loc,
      children: [],
      metadata: {
        kind: 'enum',
        mutable: false,
        scope: 'module' as const,
        fields,
        exported: /^[A-Z]/.test(enumName),
      },
    });
  }

  return nodes;
}

function extractStructFields(structNode: SyntaxNode): TypedField[] {
  const fields: TypedField[] = [];
  const body = structNode.childForFieldName('body') ?? structNode;

  for (const field of findAll(body, 'field_declaration')) {
    const nameList = field.childForFieldName('name');
    const typeNode = field.childForFieldName('type');
    if (!typeNode) continue;

    const typeName = typeNode.text;

    // Go allows multiple names: Name1, Name2 type
    const names = nameList
      ? [nameList.text, ...field.children
          .filter(c => c.type === 'identifier' && c !== nameList)
          .map(c => c.text)]
      : [];

    // Embedded field (no name)
    if (names.length === 0) {
      fields.push({
        name: typeName.replace(/^\*/, ''),
        type: typeName,
        required: true,
      });
      continue;
    }

    const jsonTag = extractJsonTag(field);

    for (const name of names.filter(Boolean)) {
      fields.push({
        name: jsonTag ?? name,
        type: typeName,
        required: true,
      });
    }
  }

  return fields;
}

function extractJsonTag(fieldNode: SyntaxNode): string | null {
  // `json:"fieldName,omitempty"` — struct tag
  const tag = fieldNode.children.find(c => c.type === 'raw_string_literal' || c.type === 'interpreted_string_literal');
  if (!tag) return null;
  const match = tag.text.match(/json:"([^",]+)/);
  return match ? match[1] : null;
}

function inferEnumName(specs: SyntaxNode[]): string | null {
  // Try to find a common prefix or use type annotation
  const firstType = specs[0].childForFieldName('type');
  if (firstType) return firstType.text;

  // Heuristic: if names share a prefix, use it
  const names = specs.map(s => s.childForFieldName('name')?.text ?? '').filter(Boolean);
  if (names.length === 0) return null;

  let prefix = names[0];
  for (const name of names.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < name.length && prefix[i] === name[i]) i++;
    prefix = prefix.slice(0, i);
  }

  return prefix.length > 2 ? prefix : null;
}
