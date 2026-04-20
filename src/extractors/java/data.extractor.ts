import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, fieldText } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { DataNode, TypedField } from '../../types/topology';

export function extractJavaDataNodes(
  rootNode: SyntaxNode,
  filePath: string,
): DataNode[] {
  const nodes: DataNode[] = [];

  // Interface declarations
  for (const node of findAll(rootNode, 'interface_declaration')) {
    const name = fieldText(node, 'name') ?? 'Unknown';
    const loc = toLocation(node, filePath);
    const id = nodeId('data', filePath, loc.line, name);
    const modifiers = node.childForFieldName('modifiers')?.text ?? '';
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
        fields: extractJavaInterfaceMethods(node),
        exported: modifiers.includes('public'),
      },
    });
  }

  // Class declarations (POJOs, DTOs, Records)
  for (const node of findAll(rootNode, 'class_declaration')) {
    const name = fieldText(node, 'name') ?? 'Unknown';
    const loc = toLocation(node, filePath);

    // Skip controllers, services, repositories — those are handled as functions/endpoints
    const annotations = findAll(node, 'marker_annotation').concat(findAll(node, 'annotation'));
    const annNames = annotations.map(a => a.childForFieldName('name')?.text ?? '');
    if (annNames.some(a => ['Controller', 'RestController', 'Service', 'Repository', 'Component'].includes(a))) {
      continue;
    }

    const id = nodeId('data', filePath, loc.line, name);
    const modifiers = node.childForFieldName('modifiers')?.text ?? '';
    const fields = extractJavaClassFields(node);

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
        fields,
        exported: modifiers.includes('public'),
      },
    });
  }

  // Record declarations (Java 16+)
  for (const node of findAll(rootNode, 'record_declaration')) {
    const name = fieldText(node, 'name') ?? 'Unknown';
    const loc = toLocation(node, filePath);
    const id = nodeId('data', filePath, loc.line, name);
    const modifiers = node.childForFieldName('modifiers')?.text ?? '';
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
        fields: extractJavaRecordComponents(node),
        exported: modifiers.includes('public'),
      },
    });
  }

  // Enum declarations
  for (const node of findAll(rootNode, 'enum_declaration')) {
    const name = fieldText(node, 'name') ?? 'Unknown';
    const loc = toLocation(node, filePath);
    const id = nodeId('data', filePath, loc.line, name);
    const fields = findAll(node, 'enum_constant')
      .map(c => fieldText(c, 'name') ?? c.children[0]?.text ?? '')
      .filter(Boolean)
      .map((name): TypedField => ({ name, type: 'enum_value', required: true }));
    const modifiers = node.childForFieldName('modifiers')?.text ?? '';
    nodes.push({
      id,
      type: 'data',
      name,
      location: loc,
      children: [],
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

function extractJavaClassFields(classNode: SyntaxNode): TypedField[] {
  const fields: TypedField[] = [];
  const body = classNode.childForFieldName('body') ?? classNode;

  for (const field of findAll(body, 'field_declaration')) {
    const typeNode = field.childForFieldName('type');
    const declarators = findAll(field, 'variable_declarator');
    const typeName = typeNode?.text ?? 'Object';

    const modifiers = field.childForFieldName('modifiers')?.text ?? '';
    if (modifiers.includes('static') && modifiers.includes('final')) continue;

    for (const decl of declarators) {
      const name = decl.childForFieldName('name')?.text ?? decl.children[0]?.text ?? '';
      if (!name) continue;
      fields.push({
        name,
        type: typeName,
        required: ! modifiers.includes('@Nullable') || modifiers.includes('Optional'),
      });
    }
  }

  return fields;
}

function extractJavaRecordComponents(recordNode: SyntaxNode): TypedField[] {
  const params = recordNode.childForFieldName('parameters') ?? recordNode;
  return findAll(params, 'formal_parameter').map(p => ({
    name: p.childForFieldName('name')?.text ?? 'param',
    type: p.childForFieldName('type')?.text ?? 'Object',
    required: true,
  }));
}

function extractJavaInterfaceMethods(ifaceNode: SyntaxNode): TypedField[] {
  const methods: TypedField[] = [];
  const body = ifaceNode.childForFieldName('body') ?? ifaceNode;
  for (const method of findAll(body, 'method_declaration')) {
    const name = fieldText(method, 'name') ?? '';
    const returnType = method.childForFieldName('type')?.text ?? 'void';
    if (name) methods.push({ name, type: returnType, required: true });
  }
  return methods;
}
