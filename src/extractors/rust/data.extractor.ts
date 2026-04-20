import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, fieldText } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { DataNode, TypedField } from '../../types/topology';

export function extractRustDataNodes(
  rootNode: SyntaxNode,
  filePath: string,
): DataNode[] {
  const nodes: DataNode[] = [];

  // struct Foo { field: Type, ... }
  for (const item of findAll(rootNode, 'struct_item')) {
    const nameNode = item.childForFieldName('name');
    if (!nameNode) continue;
    const name = nameNode.text;
    const loc = toLocation(item, filePath);
    const vis = item.childForFieldName('visibility_modifier');
    const fields = extractStructFields(item);
    nodes.push({
      id: nodeId('data', filePath, loc.line, name),
      type: 'data', name,
      location: loc, children: [],
      metadata: {
        kind: 'interface',
        mutable: false,
        scope: 'module' as const,
        fields,
        exported: vis?.text === 'pub',
      },
    });
  }

  // enum Foo { Variant, Variant(T), ... }
  for (const item of findAll(rootNode, 'enum_item')) {
    const nameNode = item.childForFieldName('name');
    if (!nameNode) continue;
    const name = nameNode.text;
    const loc = toLocation(item, filePath);
    const vis = item.childForFieldName('visibility_modifier');
    const body = item.childForFieldName('body') ?? item;
    const fields = findAll(body, 'enum_variant').map((v): TypedField => ({
      name: v.childForFieldName('name')?.text ?? v.children[0]?.text ?? '',
      type: 'enum_value',
      required: true,
    }));
    nodes.push({
      id: nodeId('data', filePath, loc.line, name),
      type: 'data', name,
      location: loc, children: [],
      metadata: {
        kind: 'enum',
        mutable: false,
        scope: 'module' as const,
        fields,
        exported: vis?.text === 'pub',
      },
    });
  }

  // trait Foo { fn method(&self) -> Type; }
  for (const item of findAll(rootNode, 'trait_item')) {
    const nameNode = item.childForFieldName('name');
    if (!nameNode) continue;
    const name = nameNode.text;
    const loc = toLocation(item, filePath);
    const vis = item.childForFieldName('visibility_modifier');
    const body = item.childForFieldName('body') ?? item;
    const fields = findAll(body, 'function_item').map((fn): TypedField => ({
      name: fn.childForFieldName('name')?.text ?? '',
      type: fn.childForFieldName('return_type')?.text ?? '()',
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
        exported: vis?.text === 'pub',
      },
    });
  }

  // type Alias = ...
  for (const item of findAll(rootNode, 'type_item')) {
    const nameNode = item.childForFieldName('name');
    if (!nameNode) continue;
    const name = nameNode.text;
    const loc = toLocation(item, filePath);
    const vis = item.childForFieldName('visibility_modifier');
    const typeNode = item.childForFieldName('type');
    nodes.push({
      id: nodeId('data', filePath, loc.line, name),
      type: 'data', name,
      location: loc, children: [],
      metadata: {
        kind: 'type',
        mutable: false,
        scope: 'module' as const,
        dataType: typeNode?.text,
        fields: [],
        exported: vis?.text === 'pub',
      },
    });
  }

  return nodes;
}

function extractStructFields(structNode: SyntaxNode): TypedField[] {
  const fields: TypedField[] = [];
  const body = structNode.childForFieldName('body') ?? structNode;

  for (const field of findAll(body, 'field_declaration')) {
    const nameNode = field.childForFieldName('name');
    const typeNode = field.childForFieldName('type');
    if (!nameNode) continue;

    const typeName = typeNode?.text ?? 'Unknown';
    const optional = typeName.startsWith('Option<');
    const vis = field.childForFieldName('visibility_modifier');

    fields.push({
      name: nameNode.text,
      type: typeName,
      required: !optional,
    });
  }

  return fields;
}
