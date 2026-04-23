import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation, fieldText } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { DataNode, TypedField } from '../../types/topology';

/**
 * Extracts DataNodes from Java source:
 * - class_declaration (POJOs, DTOs, entities) — skips Spring beans
 * - interface_declaration
 * - enum_declaration
 * - annotation_type_declaration (@interface)
 * - @Autowired / @Inject field declarations (for DI edge building)
 *
 * Anonymous classes (object_creation_expression with class_body) are skipped —
 * they are represented as FunctionNodes by function.extractor.
 */
export function extractJavaDataNodes(
  rootNode: SyntaxNode,
  filePath: string,
): DataNode[] {
  const nodes: DataNode[] = [];

  // Class declarations — walk recursively to qualify inner class names
  walkClassDataNodes(rootNode, filePath, null, nodes);

  // Interface declarations
  for (const node of findAll(rootNode, 'interface_declaration')) {
    // Skip @FeignClient interfaces — those become ExternalCallNodes
    if (hasAnnotation(node, 'FeignClient')) continue;

    const name = fieldText(node, 'name') ?? 'Unknown';
    const loc = toLocation(node, filePath);
    const id = nodeId('data', filePath, loc.line, name);
    const modifiers = node.childForFieldName('modifiers')?.text ?? '';

    const fields = extractInterfaceMethods(node);
    const superInterfaces = extractSuperInterfaces(node);

    nodes.push({
      id,
      type: 'data',
      name,
      location: loc,
      children: [],
      metadata: {
        kind: 'interface',
        mutable: false,
        scope: 'module',
        exported: modifiers.includes('public'),
        fields,
        implements: superInterfaces.length > 0 ? superInterfaces : undefined,
      },
    });
  }

  // Enum declarations
  for (const node of findAll(rootNode, 'enum_declaration')) {
    const name = fieldText(node, 'name') ?? 'Unknown';
    const loc = toLocation(node, filePath);
    const id = nodeId('data', filePath, loc.line, name);
    const modifiers = node.childForFieldName('modifiers')?.text ?? '';

    const body = node.childForFieldName('body') ?? node;
    const fields: TypedField[] = [];
    for (const constant of body.namedChildren) {
      if (constant.type !== 'enum_constant') continue;
      const constName = fieldText(constant, 'name') ?? constant.namedChildren[0]?.text ?? '';
      if (constName) fields.push({ name: constName, type: 'enum_value', required: true });
    }

    nodes.push({
      id,
      type: 'data',
      name,
      location: loc,
      children: [],
      metadata: {
        kind: 'enum',
        mutable: false,
        scope: 'module',
        exported: modifiers.includes('public'),
        fields,
      },
    });
  }

  // Annotation type declarations: @interface Cacheable { ... }
  for (const node of findAll(rootNode, 'annotation_type_declaration')) {
    const name = fieldText(node, 'name') ?? 'Unknown';
    const loc = toLocation(node, filePath);
    const id = nodeId('data', filePath, loc.line, `@${name}`);
    const modifiers = node.childForFieldName('modifiers')?.text ?? '';

    const body = node.childForFieldName('body') ?? node;
    const fields: TypedField[] = [];
    for (const element of body.namedChildren) {
      if (element.type !== 'annotation_type_element_declaration') continue;
      const elemName = element.childForFieldName('name')?.text ?? '';
      const elemType = element.childForFieldName('type')?.text ?? 'String';
      const hasDefault = element.childForFieldName('default_value') !== null;
      if (elemName) fields.push({ name: elemName, type: elemType, required: !hasDefault });
    }

    nodes.push({
      id,
      type: 'data',
      name: `@${name}`,
      location: loc,
      children: [],
      metadata: {
        kind: 'interface',
        dataType: 'annotation',
        mutable: false,
        scope: 'module',
        exported: modifiers.includes('public'),
        fields,
      },
    });
  }

  return nodes;
}

/**
 * Recursively walks class_declaration nodes, qualifying names and emitting DataNodes.
 * Skips Spring bean classes (Controller, Service, Repository, Component).
 * Skips anonymous classes.
 */
function walkClassDataNodes(
  root: SyntaxNode,
  filePath: string,
  outerName: string | null,
  results: DataNode[],
): void {
  for (const child of root.namedChildren) {
    if (child.type === 'class_declaration') {
      const ownName = fieldText(child, 'name');

      // Anonymous class — skip (represented as FunctionNodes)
      if (!ownName) {
        const body = child.childForFieldName('body');
        if (body) walkClassDataNodes(body, filePath, outerName, results);
        continue;
      }

      const qualifiedName = outerName ? `${outerName}.${ownName}` : ownName;

      // Skip Spring bean classes — they are endpoints/functions
      if (!hasAnnotation(child, 'Controller', 'RestController', 'Service', 'Repository', 'Component', 'Configuration')) {
        const loc = toLocation(child, filePath);
        const id = nodeId('data', filePath, loc.line, qualifiedName);
        const modifiers = child.childForFieldName('modifiers')?.text ?? '';
        const fields = extractClassFields(child);
        const superClass = child.childForFieldName('superclass')?.text;
        const superInterfaces = extractSuperInterfaces(child);
        const isInner = outerName !== null;

        results.push({
          id,
          type: 'data',
          name: qualifiedName,
          location: loc,
          children: [],
          metadata: {
            kind: 'class',
            mutable: true,
            scope: isInner ? 'class' : 'module',
            exported: modifiers.includes('public'),
            fields,
            superClass: superClass || undefined,
            implements: superInterfaces.length > 0 ? superInterfaces : undefined,
          },
        });
      }

      // Recurse into the class body for nested classes
      const body = child.childForFieldName('body');
      if (body) walkClassDataNodes(body, filePath, qualifiedName, results);

    } else if (child.type !== 'object_creation_expression') {
      // Recurse into other containers but not object_creation_expression
      walkClassDataNodes(child, filePath, outerName, results);
    }
  }
}

function extractClassFields(classNode: SyntaxNode): TypedField[] {
  const fields: TypedField[] = [];
  const body = classNode.childForFieldName('body') ?? classNode;

  for (const field of body.namedChildren) {
    if (field.type !== 'field_declaration') continue;

    // Only direct children of this class body
    if (field.parent !== body) continue;

    const modifiers = field.childForFieldName('modifiers')?.text ?? '';
    // Skip static final constants
    if (modifiers.includes('static') && modifiers.includes('final')) continue;

    const typeNode = field.childForFieldName('type');
    const typeName = typeNode?.text ?? 'Object';

    for (const declarator of field.namedChildren) {
      if (declarator.type !== 'variable_declarator') continue;
      const name = declarator.childForFieldName('name')?.text ?? declarator.namedChildren[0]?.text ?? '';
      if (!name) continue;

      const isNullable = modifiers.includes('@Nullable') || typeName.startsWith('Optional');
      fields.push({ name, type: typeName, required: !isNullable });
    }
  }

  return fields;
}

function extractInterfaceMethods(ifaceNode: SyntaxNode): TypedField[] {
  const methods: TypedField[] = [];
  const body = ifaceNode.childForFieldName('body') ?? ifaceNode;

  for (const method of body.namedChildren) {
    if (method.type !== 'method_declaration') continue;
    const name = fieldText(method, 'name') ?? '';
    const returnType = method.childForFieldName('type')?.text ?? 'void';
    if (name) methods.push({ name, type: returnType, required: true });
  }

  return methods;
}

function extractSuperInterfaces(node: SyntaxNode): string[] {
  const interfaces: string[] = [];

  // class: implements clause → type_list
  const impl = node.childForFieldName('interfaces') ?? findAll(node, 'super_interfaces')[0];
  if (impl) {
    for (const typeNode of impl.namedChildren) {
      if (typeNode.type === 'type_list') {
        for (const t of typeNode.namedChildren) {
          const name = t.text?.split('<')[0]?.trim();
          if (name) interfaces.push(name);
        }
      } else {
        const name = typeNode.text?.split('<')[0]?.trim();
        if (name && !['implements', ','].includes(name)) interfaces.push(name);
      }
    }
  }

  // interface: extends clause
  const ext = node.childForFieldName('extends_interfaces') ?? findAll(node, 'extends_interfaces')[0];
  if (ext) {
    for (const typeNode of ext.namedChildren) {
      const name = typeNode.text?.split('<')[0]?.trim();
      if (name && !['extends', ','].includes(name)) interfaces.push(name);
    }
  }

  return interfaces.filter(Boolean);
}

/**
 * Checks if a node has any of the given annotation names as direct children.
 */
function hasAnnotation(node: SyntaxNode, ...annotationNames: string[]): boolean {
  const nameSet = new Set(annotationNames);
  const annotations = node.namedChildren.filter(c =>
    c.type === 'marker_annotation' || c.type === 'annotation'
  );
  // Also check modifiers node
  const modifiers = node.childForFieldName('modifiers');
  if (modifiers) {
    annotations.push(...modifiers.namedChildren.filter(c =>
      c.type === 'marker_annotation' || c.type === 'annotation'
    ));
  }

  return annotations.some(ann => {
    const name = fieldText(ann, 'name') ?? ann.namedChildren[0]?.text ?? '';
    return nameSet.has(name);
  });
}
