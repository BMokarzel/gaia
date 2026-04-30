/**
 * TsAstWalker — walker tree-sitter para TypeScript / TSX.
 *
 * Implementa o mapeamento AST node → ElementKind descrito em
 * AST_FLOW_EXTRACTION_PLAN.md §4.3 e o algoritmo de §4.2.
 *
 * Responsabilidade ÚNICA: emitir Elements + Edges(contains). Não resolve
 * referências, não cria edges 'calls' / 'imports' / 'extends' — isso é
 * feito pelos resolvers da Fase 2.
 */

import type {
  Element,
  ElementKind,
  ElementMeta,
  ModuleMeta,
  ClassMeta,
  InterfaceMeta,
  TypeAliasMeta,
  EnumMeta,
  BehavioralMeta,
  BranchMeta,
  BranchSubBlockMeta,
  LoopMeta,
  LoopBodyMeta,
  TryBlockMeta,
  CatchMeta,
  FinallyMeta,
  CallSiteMeta,
  ReturnSiteMeta,
  ThrowSiteMeta,
  AssignSiteMeta,
  AwaitSiteMeta,
  ParameterMeta,
  FieldMeta,
  ImportBindingMeta,
  TypeRefMeta,
  DecoratorRefMeta,
  SourceLocation,
} from '../element';
import type { Edge } from '../edge';
import { makeElementId, makeEdgeId } from '../ids';
import type { ASTWalker, ElementBatch } from './ast-walker';
import type { SourceFile } from './source-file';
import { isAvailable, parseTypeScript, type SyntaxNode } from './ts-parser-adapter';
import {
  fieldText,
  namedChildOfType,
  namedChildrenOfType,
  findFirstDescendant,
  decoratorsOf,
  decoratorName,
  decoratorFirstStringArg,
  decoratorAllArgs,
  isAsync,
  visibilityOf,
  isStatic,
  isReadonly,
  returnTypeText,
  paramTypeText,
  calleeOf,
  argTextsOf,
  isAwaitedCall,
  isChainedCall,
  strLiteralValue,
} from './ts-ast-helpers';

const HTTP_DECORATORS = new Set(['Get', 'Post', 'Put', 'Delete', 'Patch', 'Options', 'Head', 'All']);

// AST node types que NÃO viram element próprio mas cujos filhos são
// processados (ver §4.4).
const TRANSPARENT_TYPES = new Set([
  'statement_block',
  'formal_parameters',
  'arguments',
  'class_body',
  'class_heritage',
  'interface_body',
  'object_type',
  'export_statement',
  'import_statement',
  'import_clause',
  'switch_body',
  'parenthesized_expression',
  'type_arguments',
  'named_imports',
  'expression_statement',
  'variable_declarator',
  'assignment_expression',
  'await_expression',
  'new_expression',
  'yield_expression',
  'pair',
  'object',
  'array',
  'object_pattern',
  'array_pattern',
  'spread_element',
  'sequence_expression',
  'binary_expression',
  'unary_expression',
  'update_expression',
  'subscript_expression',
  'member_expression',
  'template_string',
  'template_substitution',
  'jsx_element',
  'jsx_self_closing_element',
  'jsx_expression',
]);

// Containers conhecidos que ainda dispatcham filhos.
const CONTAINER_TYPES = new Set([
  'program',
  'class_declaration',
  'class_body',
  'interface_declaration',
  'method_definition',
  'function_declaration',
  'function_expression',
  'arrow_function',
  'if_statement',
  'switch_statement',
  'switch_case',
  'switch_default',
  'for_statement',
  'for_in_statement',
  'for_of_statement',
  'while_statement',
  'do_statement',
  'try_statement',
  'catch_clause',
  'finally_clause',
  'statement_block',
  'expression_statement',
]);

interface WalkContext {
  file: SourceFile;
  elements: Element[];
  edges: Edge[];
  /** Branch sibling counter por escopo (parent.id) — para BranchMeta.branchIndex. */
  branchIndexByParent: Map<string, number>;
}

export class TsAstWalker implements ASTWalker {
  readonly supportedExtensions = ['.ts', '.tsx', '.js', '.jsx'] as const;

  walk(file: SourceFile): ElementBatch | null {
    if (!isAvailable()) return null;
    if (!this.supportedExtensions.includes(file.extension as never)) return null;

    const root = parseTypeScript(file.content, file.extension);
    if (!root) return null;

    const ctx: WalkContext = {
      file,
      elements: [],
      edges: [],
      branchIndexByParent: new Map(),
    };

    const moduleEl = this.makeModule(file, root, ctx);
    ctx.elements.push(moduleEl);

    for (const child of root.namedChildren) {
      this.dispatch(child, moduleEl.id, ctx);
    }

    return { elements: ctx.elements, edges: ctx.edges };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Dispatch principal
  // ──────────────────────────────────────────────────────────────────────────

  private dispatch(node: SyntaxNode, parentId: string, ctx: WalkContext): void {
    const created = this.tryCreate(node, parentId, ctx);
    if (created) {
      ctx.elements.push(created.element);
      this.addContains(parentId, created.element.id, ctx);
      this.descend(node, created.element.id, ctx, created.skipChildren ?? false);
      return;
    }

    // Sem element → continua descendo se for container/transparente
    if (TRANSPARENT_TYPES.has(node.type) || CONTAINER_TYPES.has(node.type)) {
      this.descend(node, parentId, ctx, false);
    }
  }

  private descend(
    node: SyntaxNode,
    parentId: string,
    ctx: WalkContext,
    skipChildren: boolean,
  ): void {
    if (skipChildren) return;
    for (const child of node.namedChildren) {
      this.dispatch(child, parentId, ctx);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Element factories
  // ──────────────────────────────────────────────────────────────────────────

  private tryCreate(
    node: SyntaxNode,
    parentId: string,
    ctx: WalkContext,
  ): { element: Element; skipChildren?: boolean } | null {
    switch (node.type) {
      case 'class_declaration':
      case 'abstract_class_declaration':
        return { element: this.makeClass(node, ctx) };
      case 'interface_declaration':
        return { element: this.makeInterface(node, ctx) };
      case 'type_alias_declaration':
        return { element: this.makeTypeAlias(node, ctx), skipChildren: true };
      case 'enum_declaration':
        return { element: this.makeEnum(node, ctx), skipChildren: true };

      case 'method_definition':
      case 'method_signature':
        return { element: this.makeMethodLike(node, ctx) };

      case 'function_declaration':
      case 'function_expression':
        return { element: this.makeFunction(node, ctx) };

      case 'lexical_declaration':
      case 'variable_declaration':
        return this.makeFromLexical(node, ctx);

      case 'if_statement':
        return { element: this.makeBranch(node, parentId, 'if', ctx) };
      case 'switch_statement':
        return { element: this.makeBranch(node, parentId, 'switch', ctx) };
      case 'ternary_expression':
        return { element: this.makeBranch(node, parentId, 'ternary', ctx) };

      case 'switch_case':
        return { element: this.makeBranchSubBlock(node, 'branch_then', ctx) };
      case 'switch_default':
        return { element: this.makeBranchSubBlock(node, 'branch_else', ctx) };

      case 'for_statement':
      case 'for_in_statement':
      case 'while_statement':
      case 'do_statement':
        return { element: this.makeLoop(node, ctx) };

      case 'try_statement':
        return { element: this.makeTryBlock(node, ctx) };
      case 'catch_clause':
        return { element: this.makeCatchBlock(node, ctx) };
      case 'finally_clause':
        return { element: this.makeFinallyBlock(node, ctx) };

      case 'call_expression':
        if (this.shouldEmitCallSite(node)) {
          return { element: this.makeCallSite(node, ctx), skipChildren: true };
        }
        return null;

      case 'return_statement':
        // skipChildren=false: queremos capturar call_sites embutidos no valor.
        return { element: this.makeReturnSite(node, ctx), skipChildren: false };
      case 'throw_statement':
        return { element: this.makeThrowSite(node, ctx), skipChildren: false };

      case 'await_expression':
        if (node.parent?.type === 'expression_statement') {
          return { element: this.makeAwaitSite(node, ctx), skipChildren: false };
        }
        return null;

      case 'required_parameter':
      case 'optional_parameter':
        // skipChildren=false: queremos extrair type_annotation (→ type_ref)
        // e decorator (→ decorator_ref) como filhos do parameter.
        return { element: this.makeParameter(node, ctx), skipChildren: false };

      case 'public_field_definition':
      case 'property_signature':
        return { element: this.makeField(node, ctx), skipChildren: false };

      case 'import_specifier':
        return { element: this.makeImportBinding(node, 'named', ctx), skipChildren: true };
      case 'namespace_import':
        return { element: this.makeImportBinding(node, 'namespace', ctx), skipChildren: true };
      case 'import_clause': {
        // Default import: import_clause cujo primeiro filho é identifier (não named_imports)
        const first = node.namedChildren[0];
        if (first && first.type === 'identifier') {
          return { element: this.makeImportBinding(node, 'default', ctx) };
        }
        return null;
      }

      case 'decorator':
        return { element: this.makeDecoratorRef(node, parentId, ctx), skipChildren: true };

      case 'type_annotation':
        return { element: this.makeTypeRef(node, ctx), skipChildren: true };

      case 'assignment_expression':
        if (node.parent?.type === 'expression_statement') {
          return { element: this.makeAssignFromExpression(node, ctx), skipChildren: true };
        }
        return null;

      default:
        return null;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // makers — um por kind
  // ──────────────────────────────────────────────────────────────────────────

  private makeModule(file: SourceFile, root: SyntaxNode, _ctx: WalkContext): Element<ModuleMeta> {
    const exports: string[] = [];
    for (const child of root.namedChildren) {
      if (child.type === 'export_statement') {
        const decl =
          child.childForFieldName('declaration') ??
          namedChildOfType(child, 'class_declaration') ??
          namedChildOfType(child, 'function_declaration') ??
          namedChildOfType(child, 'lexical_declaration');
        if (decl) {
          const nameNode = decl.childForFieldName('name');
          if (nameNode) exports.push(nameNode.text);
        }
      }
    }
    return {
      id: this.idFor(file.path, root, 'module'),
      kind: 'module',
      location: this.locOf(file, root),
      name: file.path,
      meta: { language: file.language ?? this.langFromExt(file.extension), exports },
    };
  }

  private makeClass(node: SyntaxNode, ctx: WalkContext): Element<ClassMeta> {
    const name = fieldText(node, 'name') ?? '<anonymous>';
    const decorators = decoratorsOf(node).map(decoratorName).filter(Boolean);
    const isAbstract =
      node.type === 'abstract_class_declaration' || node.children.some(c => c.type === 'abstract');
    const heritage = namedChildOfType(node, 'class_heritage');
    let extendsName: string | undefined;
    const implementsNames: string[] = [];
    if (heritage) {
      const ext = namedChildOfType(heritage, 'extends_clause');
      if (ext) {
        const t = ext.namedChildren.find(c => c.type !== 'extends')?.text;
        if (t) extendsName = t;
      }
      const impl = namedChildOfType(heritage, 'implements_clause');
      if (impl) {
        for (const c of impl.namedChildren) implementsNames.push(c.text);
      }
    }
    const controllerArg = decoratorsOf(node)
      .filter(d => decoratorName(d) === 'Controller')
      .map(decoratorFirstStringArg)
      .find((v): v is string => typeof v === 'string');

    return {
      id: this.idFor(ctx.file.path, node, 'class'),
      kind: 'class',
      location: this.locOf(ctx.file, node),
      name,
      meta: {
        isAbstract,
        decorators,
        extendsName,
        implementsNames,
        controllerPath: controllerArg,
      },
    };
  }

  private makeInterface(node: SyntaxNode, ctx: WalkContext): Element<InterfaceMeta> {
    const name = fieldText(node, 'name') ?? '<anonymous>';
    const extendsNames: string[] = [];
    for (const child of node.namedChildren) {
      if (child.type === 'extends_type_clause' || child.type === 'extends_clause') {
        for (const c of child.namedChildren) {
          if (c.type !== 'extends') extendsNames.push(c.text);
        }
      }
    }
    return {
      id: this.idFor(ctx.file.path, node, 'interface'),
      kind: 'interface',
      location: this.locOf(ctx.file, node),
      name,
      meta: { decorators: [], extendsNames },
    };
  }

  private makeTypeAlias(node: SyntaxNode, ctx: WalkContext): Element<TypeAliasMeta> {
    const name = fieldText(node, 'name') ?? '<anonymous>';
    return {
      id: this.idFor(ctx.file.path, node, 'type_alias'),
      kind: 'type_alias',
      location: this.locOf(ctx.file, node),
      name,
      meta: {
        exported: node.parent?.type === 'export_statement',
        text: fieldText(node, 'value') ?? undefined,
      },
    };
  }

  private makeEnum(node: SyntaxNode, ctx: WalkContext): Element<EnumMeta> {
    const name = fieldText(node, 'name') ?? '<anonymous>';
    const body = namedChildOfType(node, 'enum_body');
    const members: string[] = [];
    if (body) {
      for (const child of body.namedChildren) {
        if (child.type === 'property_identifier' || child.type === 'enum_assignment') {
          const n = child.childForFieldName('name')?.text ?? child.text;
          if (n) members.push(n);
        }
      }
    }
    return {
      id: this.idFor(ctx.file.path, node, 'enum'),
      kind: 'enum',
      location: this.locOf(ctx.file, node),
      name,
      meta: { members, exported: node.parent?.type === 'export_statement' },
    };
  }

  private makeMethodLike(node: SyntaxNode, ctx: WalkContext): Element<BehavioralMeta> {
    const name = fieldText(node, 'name') ?? '<anonymous>';
    const isCtor = name === 'constructor';
    const isGet = node.children.some(c => c.text === 'get' && c.type === 'get');
    const isSet = node.children.some(c => c.text === 'set' && c.type === 'set');
    const kind: ElementKind = isCtor ? 'constructor' : isGet ? 'getter' : isSet ? 'setter' : 'method';

    const decoratorEls = decoratorsOf(node);
    const decorators = decoratorEls.map(decoratorName).filter(Boolean);
    const httpDeco = decoratorEls.find(d => HTTP_DECORATORS.has(decoratorName(d)));
    const params = namedChildOfType(node, 'formal_parameters');
    const paramCount = params ? params.namedChildren.length : 0;

    return {
      id: this.idFor(ctx.file.path, node, kind),
      kind,
      location: this.locOf(ctx.file, node),
      name,
      signature: this.signatureOf(node),
      meta: {
        visibility: visibilityOf(node),
        isAsync: isAsync(node),
        isStatic: isStatic(node),
        decorators,
        httpMethod: httpDeco ? decoratorName(httpDeco).toUpperCase() : undefined,
        httpPath: httpDeco ? decoratorFirstStringArg(httpDeco) ?? undefined : undefined,
        returnTypeName: returnTypeText(node) ?? undefined,
        paramCount,
      },
    };
  }

  private makeFunction(node: SyntaxNode, ctx: WalkContext): Element<BehavioralMeta> {
    const name = fieldText(node, 'name') ?? '<anonymous>';
    const params = namedChildOfType(node, 'formal_parameters');
    return {
      id: this.idFor(ctx.file.path, node, 'function'),
      kind: 'function',
      location: this.locOf(ctx.file, node),
      name,
      signature: this.signatureOf(node),
      meta: {
        visibility: 'public',
        isAsync: isAsync(node),
        isStatic: false,
        decorators: [],
        returnTypeName: returnTypeText(node) ?? undefined,
        paramCount: params ? params.namedChildren.length : 0,
      },
    };
  }

  /**
   * Para `lexical_declaration`, dependendo do RHS pode virar:
   *   - arrow_function (se RHS é arrow)
   *   - assign_site (caso comum)
   * Sempre retorna skipChildren=false para que call_expressions internas e
   * outras estruturas dentro do RHS continuem sendo capturadas.
   */
  private makeFromLexical(
    node: SyntaxNode,
    ctx: WalkContext,
  ): { element: Element; skipChildren?: boolean } | null {
    const declarator = namedChildOfType(node, 'variable_declarator');
    const value = declarator?.childForFieldName('value');
    const target = declarator?.childForFieldName('name')?.text ?? '<anonymous>';

    if (value && value.type === 'arrow_function') {
      const fn: Element<BehavioralMeta> = {
        id: this.idFor(ctx.file.path, node, 'arrow_function'),
        kind: 'arrow_function',
        location: this.locOf(ctx.file, node),
        name: target,
        signature: this.signatureOf(value),
        meta: {
          visibility: 'public',
          isAsync: isAsync(value),
          isStatic: false,
          decorators: [],
          returnTypeName: returnTypeText(value) ?? undefined,
          paramCount: namedChildOfType(value, 'formal_parameters')?.namedChildren.length ?? 0,
        },
      };
      return { element: fn };
    }

    const isConst = node.children.some(c => c.type === 'const');
    const valueText = value?.text ?? '';
    const isAwait = value?.type === 'await_expression';
    const meta: AssignSiteMeta = {
      targetText: target,
      valueText,
      isConst,
      isAwait,
    };
    return {
      element: {
        id: this.idFor(ctx.file.path, node, 'assign_site'),
        kind: 'assign_site',
        location: this.locOf(ctx.file, node),
        name: target,
        meta,
      },
    };
  }

  private makeAssignFromExpression(node: SyntaxNode, ctx: WalkContext): Element<AssignSiteMeta> {
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    return {
      id: this.idFor(ctx.file.path, node, 'assign_site'),
      kind: 'assign_site',
      location: this.locOf(ctx.file, node),
      name: left?.text,
      meta: {
        targetText: left?.text ?? '',
        valueText: right?.text ?? '',
        isConst: false,
        isAwait: right?.type === 'await_expression',
      },
    };
  }

  private makeBranch(
    node: SyntaxNode,
    parentId: string,
    branchKind: BranchMeta['branchKind'],
    ctx: WalkContext,
  ): Element<BranchMeta> {
    const conditionNode =
      node.childForFieldName('condition') ?? node.childForFieldName('value') ?? null;
    const conditionText = conditionNode?.text ?? '';
    const altNode = node.childForFieldName('alternative');
    const hasElse = !!altNode;
    const idx = ctx.branchIndexByParent.get(parentId) ?? 0;
    ctx.branchIndexByParent.set(parentId, idx + 1);
    return {
      id: this.idFor(ctx.file.path, node, 'branch'),
      kind: 'branch',
      location: this.locOf(ctx.file, node),
      name: conditionText.slice(0, 80),
      meta: { branchKind, conditionText, hasElse, branchIndex: idx },
    };
  }

  private makeBranchSubBlock(
    node: SyntaxNode,
    kind: 'branch_then' | 'branch_else',
    ctx: WalkContext,
  ): Element<BranchSubBlockMeta> {
    let label: string | undefined;
    if (node.type === 'switch_case') {
      const v = node.childForFieldName('value')?.text;
      label = v ? `case ${v}` : undefined;
    } else if (node.type === 'switch_default') {
      label = 'default';
    }
    return {
      id: this.idFor(ctx.file.path, node, kind),
      kind,
      location: this.locOf(ctx.file, node),
      name: label,
      meta: { label },
    };
  }

  private makeLoop(node: SyntaxNode, ctx: WalkContext): Element<LoopMeta> {
    let loopKind: LoopMeta['loopKind'] = 'for';
    if (node.type === 'for_in_statement') {
      const isOf = node.children.some(c => c.type === 'of');
      loopKind = isOf ? 'for-of' : 'for-in';
    } else if (node.type === 'while_statement') {
      loopKind = 'while';
    } else if (node.type === 'do_statement') {
      loopKind = 'do-while';
    }
    const iterable =
      node.childForFieldName('right')?.text ??
      node.childForFieldName('condition')?.text ??
      undefined;
    const variable = node.childForFieldName('left')?.text ?? undefined;
    return {
      id: this.idFor(ctx.file.path, node, 'loop'),
      kind: 'loop',
      location: this.locOf(ctx.file, node),
      name: variable ? `${variable} ← ${iterable ?? ''}` : undefined,
      meta: { loopKind, iterableText: iterable, variableText: variable },
    };
  }

  private makeTryBlock(node: SyntaxNode, ctx: WalkContext): Element<TryBlockMeta> {
    const catches = namedChildrenOfType(node, 'catch_clause');
    const hasFinally = !!namedChildOfType(node, 'finally_clause');
    return {
      id: this.idFor(ctx.file.path, node, 'try_block'),
      kind: 'try_block',
      location: this.locOf(ctx.file, node),
      meta: { hasFinally, catchCount: catches.length },
    };
  }

  private makeCatchBlock(node: SyntaxNode, ctx: WalkContext): Element<CatchMeta> {
    const param = node.childForFieldName('parameter');
    return {
      id: this.idFor(ctx.file.path, node, 'catch_block'),
      kind: 'catch_block',
      location: this.locOf(ctx.file, node),
      meta: {
        errorParamName: param?.text,
        errorTypeName: undefined,
      },
    };
  }

  private makeFinallyBlock(node: SyntaxNode, ctx: WalkContext): Element<FinallyMeta> {
    const body = namedChildOfType(node, 'statement_block');
    return {
      id: this.idFor(ctx.file.path, node, 'finally_block'),
      kind: 'finally_block',
      location: this.locOf(ctx.file, node),
      meta: { empty: !body || body.namedChildren.length === 0 },
    };
  }

  private shouldEmitCallSite(node: SyntaxNode): boolean {
    const p = node.parent;
    if (!p) return false;
    return (
      p.type === 'expression_statement' ||
      p.type === 'await_expression' ||
      p.type === 'variable_declarator' ||
      p.type === 'assignment_expression' ||
      p.type === 'return_statement' ||
      p.type === 'arguments' || // call passada como arg
      p.type === 'member_expression' // chain root
    );
  }

  private makeCallSite(node: SyntaxNode, ctx: WalkContext): Element<CallSiteMeta> {
    const callee = calleeOf(node);
    const args = argTextsOf(node);
    return {
      id: this.idFor(ctx.file.path, node, 'call_site'),
      kind: 'call_site',
      location: this.locOf(ctx.file, node),
      name: callee,
      meta: {
        calleeText: callee,
        argsText: args,
        isAwaited: isAwaitedCall(node),
        isChained: isChainedCall(node),
      },
    };
  }

  private makeReturnSite(node: SyntaxNode, ctx: WalkContext): Element<ReturnSiteMeta> {
    const value = node.namedChildren[0];
    return {
      id: this.idFor(ctx.file.path, node, 'return_site'),
      kind: 'return_site',
      location: this.locOf(ctx.file, node),
      meta: {
        valueText: value?.text,
        isVoid: !value,
      },
    };
  }

  private makeThrowSite(node: SyntaxNode, ctx: WalkContext): Element<ThrowSiteMeta> {
    const expr = node.namedChildren[0];
    let exceptionClassName: string | undefined;
    let messageText: string | undefined;
    if (expr?.type === 'new_expression') {
      const cls = expr.childForFieldName('constructor');
      exceptionClassName = cls?.text;
      const args = expr.childForFieldName('arguments');
      const first = args?.namedChildren[0];
      if (first) messageText = strLiteralValue(first) ?? first.text;
    }
    return {
      id: this.idFor(ctx.file.path, node, 'throw_site'),
      kind: 'throw_site',
      location: this.locOf(ctx.file, node),
      meta: {
        exceptionText: expr?.text ?? '',
        exceptionClassName,
        messageText,
      },
    };
  }

  private makeAwaitSite(node: SyntaxNode, ctx: WalkContext): Element<AwaitSiteMeta> {
    const expr = node.namedChildren[0];
    return {
      id: this.idFor(ctx.file.path, node, 'await_site'),
      kind: 'await_site',
      location: this.locOf(ctx.file, node),
      meta: { expressionText: expr?.text ?? '' },
    };
  }

  private makeParameter(node: SyntaxNode, ctx: WalkContext): Element<ParameterMeta> {
    const pattern = node.childForFieldName('pattern');
    const value = node.childForFieldName('value');
    const decorators = decoratorsOf(node).map(decoratorName).filter(Boolean);
    return {
      id: this.idFor(ctx.file.path, node, 'parameter'),
      kind: 'parameter',
      location: this.locOf(ctx.file, node),
      name: pattern?.text,
      meta: {
        typeName: paramTypeText(node) ?? undefined,
        isOptional: node.type === 'optional_parameter' || node.children.some(c => c.text === '?'),
        hasDefault: !!value,
        defaultText: value?.text,
        decorators,
      },
    };
  }

  private makeField(node: SyntaxNode, ctx: WalkContext): Element<FieldMeta> {
    const name = fieldText(node, 'name') ?? '<anonymous>';
    const decorators = decoratorsOf(node).map(decoratorName).filter(Boolean);
    return {
      id: this.idFor(ctx.file.path, node, 'field'),
      kind: 'field',
      location: this.locOf(ctx.file, node),
      name,
      meta: {
        typeName: paramTypeText(node) ?? undefined,
        visibility: visibilityOf(node),
        isReadonly: isReadonly(node),
        isStatic: isStatic(node),
        decorators,
      },
    };
  }

  private makeImportBinding(
    node: SyntaxNode,
    importKind: 'named' | 'default' | 'namespace',
    ctx: WalkContext,
  ): Element<ImportBindingMeta> {
    let originalName = '';
    let localName = '';
    if (importKind === 'named') {
      originalName = fieldText(node, 'name') ?? node.namedChildren[0]?.text ?? '';
      localName = fieldText(node, 'alias') ?? originalName;
    } else if (importKind === 'default') {
      localName = node.namedChildren[0]?.text ?? '';
      originalName = 'default';
    } else {
      localName = node.namedChildren.find(c => c.type === 'identifier')?.text ?? '';
      originalName = '*';
    }

    const importStatement = this.findAncestorOfType(node, 'import_statement');
    const sourceNode = importStatement?.childForFieldName('source');
    const sourceModule = sourceNode ? strLiteralValue(sourceNode) ?? sourceNode.text : '';

    return {
      id: this.idFor(ctx.file.path, node, 'import_binding'),
      kind: 'import_binding',
      location: this.locOf(ctx.file, node),
      name: localName,
      meta: { originalName, localName, sourceModule },
    };
  }

  private makeDecoratorRef(
    node: SyntaxNode,
    parentId: string,
    ctx: WalkContext,
  ): Element<DecoratorRefMeta> {
    return {
      id: this.idFor(ctx.file.path, node, 'decorator_ref'),
      kind: 'decorator_ref',
      location: this.locOf(ctx.file, node),
      name: decoratorName(node),
      meta: {
        decoratorName: decoratorName(node),
        args: decoratorAllArgs(node),
        appliedToId: parentId,
      },
    };
  }

  private makeTypeRef(node: SyntaxNode, ctx: WalkContext): Element<TypeRefMeta> {
    // type_annotation = ': X<Y, Z>' — pega o tipo principal
    const typeNode = node.namedChildren[0];
    const typeName = typeNode?.text.replace(/<.*$/s, '').trim() ?? '';
    const argsNode = typeNode ? findFirstDescendant(typeNode, 'type_arguments') : null;
    const typeArgs = argsNode ? argsNode.namedChildren.map(c => c.text.trim()) : [];
    return {
      id: this.idFor(ctx.file.path, node, 'type_ref'),
      kind: 'type_ref',
      location: this.locOf(ctx.file, node),
      name: typeName,
      meta: { typeName, typeArgs },
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // helpers
  // ──────────────────────────────────────────────────────────────────────────

  private findAncestorOfType(node: SyntaxNode, type: string): SyntaxNode | null {
    let cur: SyntaxNode | null = node.parent;
    while (cur) {
      if (cur.type === type) return cur;
      cur = cur.parent;
    }
    return null;
  }

  private addContains(parentId: string, childId: string, ctx: WalkContext): void {
    if (parentId === childId) return;
    ctx.edges.push({
      id: makeEdgeId(parentId, 'contains', childId),
      from: parentId,
      to: childId,
      kind: 'contains',
    });
  }

  private idFor(file: string, node: SyntaxNode, kind: ElementKind): string {
    return makeElementId(file, node.startPosition.row, node.startPosition.column, kind);
  }

  private locOf(file: SourceFile, node: SyntaxNode): SourceLocation {
    return {
      file: file.path,
      startLine: node.startPosition.row,
      startCol: node.startPosition.column,
      endLine: node.endPosition.row,
      endCol: node.endPosition.column,
    };
  }

  private signatureOf(node: SyntaxNode): string {
    const params = namedChildOfType(node, 'formal_parameters');
    const ret = returnTypeText(node);
    const paramText = params?.text ?? '()';
    const name = fieldText(node, 'name') ?? '';
    return `${name}${paramText}${ret ? ': ' + ret : ''}`.trim();
  }

  private langFromExt(ext: string): string {
    if (ext === '.tsx') return 'tsx';
    if (ext === '.ts') return 'typescript';
    if (ext === '.jsx') return 'jsx';
    return 'javascript';
  }

  // Used to silence unused-import linter on ElementMeta in some targets
  private readonly _phantom?: ElementMeta;
}
