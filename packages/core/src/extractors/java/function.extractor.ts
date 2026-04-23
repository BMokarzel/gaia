import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, findParent, toLocation, fieldText, javaVisibility } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { FunctionNode, ParamInfo } from '../../types/topology';

export function extractJavaFunctions(
  rootNode: SyntaxNode,
  filePath: string,
): FunctionNode[] {
  const functions: FunctionNode[] = [];

  // Recursive walker for class_declaration (handles inner/nested/anonymous)
  walkClassDeclarations(rootNode, filePath, null, functions);

  // Interface declarations (default methods)
  for (const ifaceNode of findAll(rootNode, 'interface_declaration')) {
    const ifaceName = fieldText(ifaceNode, 'name') ?? 'Unknown';
    const body = ifaceNode.childForFieldName('body') ?? ifaceNode;
    for (const method of findAll(body, 'method_declaration')) {
      const fn = buildFunctionNode(method, filePath, ifaceName, 'method');
      if (fn) functions.push(fn);
    }
  }

  // Enum declarations (methods + constructors)
  for (const enumNode of findAll(rootNode, 'enum_declaration')) {
    const enumName = fieldText(enumNode, 'name') ?? 'Unknown';
    const body = enumNode.childForFieldName('body') ?? enumNode;
    for (const method of findAll(body, 'method_declaration')) {
      const fn = buildFunctionNode(method, filePath, enumName, 'method');
      if (fn) functions.push(fn);
    }
    for (const ctor of findAll(body, 'constructor_declaration')) {
      const fn = buildFunctionNode(ctor, filePath, enumName, 'constructor');
      if (fn) functions.push(fn);
    }
  }

  // Record declarations (Java 16+)
  for (const recordNode of findAll(rootNode, 'record_declaration')) {
    const recordName = fieldText(recordNode, 'name') ?? 'Unknown';
    const body = recordNode.childForFieldName('body') ?? recordNode;
    for (const method of findAll(body, 'method_declaration')) {
      const fn = buildFunctionNode(method, filePath, recordName, 'method');
      if (fn) functions.push(fn);
    }
    for (const ctor of findAll(body, 'constructor_declaration')) {
      const fn = buildFunctionNode(ctor, filePath, recordName, 'constructor');
      if (fn) functions.push(fn);
    }
  }

  // Static initializer blocks — synthetic FunctionNode for proper child nesting
  for (const initNode of findAll(rootNode, 'static_initializer')) {
    const enclosingClass = findParent(initNode, 'class_declaration');
    const className = enclosingClass ? (fieldText(enclosingClass, 'name') ?? 'Unknown') : 'Unknown';
    const loc = toLocation(initNode, filePath);
    const qualifiedName = `${className}.<static_init>`;
    const id = nodeId('function', filePath, loc.line, qualifiedName);
    functions.push({
      id,
      type: 'function',
      name: qualifiedName,
      location: loc,
      children: [],
      metadata: {
        kind: 'method',
        async: false,
        generator: false,
        params: [],
        returnType: 'void',
        visibility: 'private',
        className,
        errorMap: [],
      },
    });
  }

  // Lambda expressions — only multi-statement block bodies
  for (const lambdaNode of findAll(rootNode, 'lambda_expression')) {
    const body = lambdaNode.childForFieldName('body');
    if (!body || body.type !== 'block') continue;
    // Only emit if block has at least 2 named children (statements)
    const stmts = body.namedChildren.filter(c => !['comment', 'line_comment', 'block_comment'].includes(c.type));
    if (stmts.length < 2) continue;

    const enclosingMethod = findParent(lambdaNode, 'method_declaration') ?? findParent(lambdaNode, 'constructor_declaration');
    const enclosingClass = findParent(lambdaNode, 'class_declaration') ?? findParent(lambdaNode, 'enum_declaration');
    const enclosingMethodName = enclosingMethod ? fieldText(enclosingMethod, 'name') ?? 'lambda' : 'lambda';
    const enclosingClassName = enclosingClass ? fieldText(enclosingClass, 'name') ?? 'Unknown' : 'Unknown';

    const loc = toLocation(lambdaNode, filePath);
    const qualifiedName = `${enclosingClassName}.${enclosingMethodName}$lambda$L${loc.line}`;
    const id = nodeId('function', filePath, loc.line, qualifiedName);

    functions.push({
      id,
      type: 'function',
      name: qualifiedName,
      location: loc,
      children: [],
      metadata: {
        kind: 'arrow',
        async: false,
        generator: false,
        params: extractLambdaParams(lambdaNode),
        returnType: undefined,
        visibility: 'private',
        className: enclosingClassName,
        errorMap: [],
      },
    });
  }

  return functions;
}

// Node types in Java that can contain class/anonymous class declarations.
// Limiting recursion to these prevents stack overflow on deep expression trees.
const CLASS_CONTAINER_TYPES = new Set([
  'program', 'class_body', 'interface_body', 'enum_body', 'record_body',
  'block', 'constructor_body',
  'local_variable_declaration', 'variable_declarator',
  'expression_statement', 'return_statement',
  'argument_list', 'array_initializer',
  'if_statement', 'for_statement', 'enhanced_for_statement',
  'while_statement', 'do_statement',
  'try_statement', 'catch_clause', 'finally_clause',
  'switch_expression', 'switch_statement', 'switch_block',
  'switch_block_statement_group', 'switch_rule',
  'lambda_expression', 'assignment_expression',
]);

/**
 * Recursively walks class_declaration nodes, qualifying names with outer class context.
 * Only descends into node types that can contain class declarations —
 * this avoids stack overflow on deeply nested expression trees.
 */
function walkClassDeclarations(
  root: SyntaxNode,
  filePath: string,
  outerName: string | null,
  results: FunctionNode[],
): void {
  for (const child of root.namedChildren) {
    if (child.type === 'class_declaration') {
      const ownName = fieldText(child, 'name');
      const qualifiedName = ownName
        ? (outerName ? `${outerName}.${ownName}` : ownName)
        : (outerName ? `${outerName}.$Anon` : '$Anon');

      const body = child.childForFieldName('body');
      if (body) {
        // Extract only direct members of this class body
        for (const member of body.namedChildren) {
          if (member.type === 'method_declaration') {
            const fn = buildFunctionNode(member, filePath, qualifiedName, 'method');
            if (fn) results.push(fn);
          } else if (member.type === 'constructor_declaration') {
            const fn = buildFunctionNode(member, filePath, qualifiedName, 'constructor');
            if (fn) results.push(fn);
          }
        }
        // Recurse into the class body for nested class declarations
        walkClassDeclarations(body, filePath, qualifiedName, results);
      }
    } else if (child.type === 'object_creation_expression') {
      // Anonymous class: new Foo() { ... }
      const classBody = child.childForFieldName('class_body');
      if (classBody) {
        const anonType = child.childForFieldName('type')?.text ?? 'Anon';
        const anonName = outerName ? `${outerName}.$${anonType}` : `$${anonType}`;
        for (const member of classBody.namedChildren) {
          if (member.type === 'method_declaration') {
            const fn = buildFunctionNode(member, filePath, anonName, 'method');
            if (fn) results.push(fn);
          }
        }
        walkClassDeclarations(classBody, filePath, anonName, results);
      }
      // Don't recurse into args of non-anonymous object_creation_expression
    } else if (CLASS_CONTAINER_TYPES.has(child.type)) {
      walkClassDeclarations(child, filePath, outerName, results);
    }
    // Leaf nodes and non-container expressions: skip entirely
  }
}

function buildFunctionNode(
  node: SyntaxNode,
  filePath: string,
  className: string | null,
  kind: FunctionNode['metadata']['kind'],
): FunctionNode | null {
  const loc = toLocation(node, filePath);
  const name = fieldText(node, 'name') ?? (kind === 'constructor' ? className : null);
  if (!name) return null;

  const visibility = javaVisibility(node);
  const params = extractJavaParams(node);
  const returnType = node.childForFieldName('type')?.text;

  // Extract Java annotations on the method (@Override, @Transactional, etc.)
  const decorators: string[] = [];
  for (const child of node.namedChildren) {
    if (child.type === 'marker_annotation') {
      const annName = fieldText(child, 'name') ?? child.namedChildren[0]?.text;
      if (annName) decorators.push(`@${annName}`);
    } else if (child.type === 'annotation') {
      const annName = fieldText(child, 'name') ?? child.namedChildren[0]?.text;
      if (annName) decorators.push(`@${annName}`);
    }
  }

  const qualifiedName = className ? `${className}.${name}` : name;
  const id = nodeId('function', filePath, loc.line, qualifiedName);

  return {
    id,
    type: 'function',
    name: qualifiedName,
    location: loc,
    children: [],
    metadata: {
      kind,
      async: false,
      generator: false,
      params,
      returnType,
      visibility,
      decorators: decorators.length > 0 ? decorators : undefined,
      className: className ?? undefined,
      errorMap: [],
    },
  };
}

function extractJavaParams(node: SyntaxNode): ParamInfo[] {
  const paramsNode = node.childForFieldName('parameters');
  if (!paramsNode) return [];

  const params: ParamInfo[] = [];

  for (const param of paramsNode.namedChildren) {
    if (param.type !== 'formal_parameter' && param.type !== 'spread_parameter') continue;

    const typeNode = param.childForFieldName('type');
    const nameNode = param.childForFieldName('name');
    const name = nameNode?.text ?? 'param';
    const type = typeNode?.text;
    const isVarArgs = param.type === 'spread_parameter';

    params.push({
      name,
      type: isVarArgs && type ? `${type}...` : type,
      optional: false,
      destructured: false,
    });
  }

  return params;
}

function extractLambdaParams(lambdaNode: SyntaxNode): ParamInfo[] {
  const paramsNode = lambdaNode.childForFieldName('parameters');
  if (!paramsNode) {
    // Single identifier param: x -> ...
    const ident = lambdaNode.namedChildren[0];
    if (ident?.type === 'identifier') {
      return [{ name: ident.text, type: undefined, optional: false, destructured: false }];
    }
    return [];
  }
  return extractJavaParams(lambdaNode);
}
