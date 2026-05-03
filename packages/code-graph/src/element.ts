/**
 * Element — unidade atômica do grafo.
 *
 * Cada artefato semântico do código (módulo, classe, método, branch, call,
 * variável, etc.) vira exatamente um Element. A taxonomia ElementKind é
 * universal — não carrega construções específicas de TypeScript ou Java.
 *
 * Referência: AST_FLOW_EXTRACTION_PLAN.md §2.1, §2.2, §2.3
 */

export interface SourceLocation {
  /** Path relativo ao root do serviço analisado. */
  file: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export type ElementKind =
  // Estruturais
  | 'module'
  | 'class'
  | 'interface'
  | 'type_alias'
  | 'enum'
  // Comportamentais
  | 'method'
  | 'function'
  | 'constructor'
  | 'getter'
  | 'setter'
  | 'arrow_function'
  // Controle de fluxo
  | 'branch'
  | 'branch_then'
  | 'branch_else'
  | 'loop'
  | 'loop_body'
  | 'try_block'
  | 'catch_block'
  | 'finally_block'
  // Statements
  | 'call_site'
  | 'return_site'
  | 'throw_site'
  | 'assign_site'
  | 'await_site'
  // Declarações
  | 'parameter'
  | 'field'
  | 'variable'
  | 'import_binding'
  // Referências
  | 'type_ref'
  | 'decorator_ref';

export const ALL_ELEMENT_KINDS: ReadonlyArray<ElementKind> = [
  'module',
  'class',
  'interface',
  'type_alias',
  'enum',
  'method',
  'function',
  'constructor',
  'getter',
  'setter',
  'arrow_function',
  'branch',
  'branch_then',
  'branch_else',
  'loop',
  'loop_body',
  'try_block',
  'catch_block',
  'finally_block',
  'call_site',
  'return_site',
  'throw_site',
  'assign_site',
  'await_site',
  'parameter',
  'field',
  'variable',
  'import_binding',
  'type_ref',
  'decorator_ref',
];

// ────────────────────────────────────────────────────────────────────────────
// Metadados por kind
// ────────────────────────────────────────────────────────────────────────────

export interface ModuleMeta {
  language: string;
  exports: string[];
}

export interface ClassMeta {
  isAbstract: boolean;
  decorators: string[];
  controllerPath?: string;
  extendsName?: string;
  implementsNames: string[];
}

export interface InterfaceMeta {
  decorators: string[];
  extendsNames: string[];
}

export interface TypeAliasMeta {
  exported: boolean;
  text?: string;
}

export interface EnumMeta {
  members: string[];
  exported: boolean;
}

export interface BehavioralMeta {
  visibility: 'public' | 'private' | 'protected';
  isAsync: boolean;
  isStatic: boolean;
  decorators: string[];
  httpMethod?: string;
  httpPath?: string;
  returnTypeName?: string;
  paramCount: number;
}

/**
 * Structured AST of a branch condition. Mirrors @topology/core ConditionExpr
 * (kept duplicated because code-graph is autonomous — no core dep).
 * JSON-serializable; consumers (e.g. simulator) read this to evaluate the
 * branch deterministically against an input scope.
 */
export type ConditionExpr =
  | { kind: 'identifier'; name: string }
  | { kind: 'literal'; value: string | number | boolean | null; raw: string }
  | { kind: 'member'; object: ConditionExpr; property: string; computed?: boolean; optional?: boolean }
  | { kind: 'binary'; op: '===' | '!==' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '+' | '-' | '*' | '/' | '%' | 'in' | 'instanceof'; left: ConditionExpr; right: ConditionExpr }
  | { kind: 'logical'; op: '&&' | '||' | '??'; left: ConditionExpr; right: ConditionExpr }
  | { kind: 'unary'; op: '!' | '-' | '+' | 'typeof' | 'void'; operand: ConditionExpr }
  | { kind: 'call'; callee: ConditionExpr; args: ConditionExpr[] }
  | { kind: 'template'; quasis: string[]; expressions: ConditionExpr[] }
  | { kind: 'unknown'; text: string };

export interface BranchMeta {
  /** "if" | "else if" | "switch" | "ternary" — kind sintático do branch */
  branchKind: 'if' | 'else_if' | 'switch' | 'ternary';
  conditionText: string;
  /** Structured AST of the condition. Absent for switch (the discriminator)
   *  and for ternaries when serialization fails. */
  conditionAst?: ConditionExpr;
  hasElse: boolean;
  /** Posição entre irmãos (0=primeiro if, 1=else if, ...). */
  branchIndex: number;
}

export interface BranchSubBlockMeta {
  /** Texto opcional usado no rótulo (ex.: "case 'admin'", "default", "else"). */
  label?: string;
}

export interface LoopMeta {
  loopKind: 'for-of' | 'for-in' | 'for' | 'while' | 'do-while';
  iterableText?: string;
  variableText?: string;
}

export interface LoopBodyMeta {
  /** placeholder para metadata específica do corpo do loop. */
  empty?: boolean;
}

export interface TryBlockMeta {
  hasFinally: boolean;
  catchCount: number;
}

export interface CatchMeta {
  errorParamName?: string;
  errorTypeName?: string;
}

export interface FinallyMeta {
  empty?: boolean;
}

export interface CallSiteMeta {
  calleeText: string;
  argsText: string[];
  isAwaited: boolean;
  isChained: boolean;
  /** Preenchido pelo CallResolver. */
  resolvedElementId?: string;
  resolvedClassName?: string;
  isExternal?: boolean;
}

export interface ReturnSiteMeta {
  valueText?: string;
  isVoid: boolean;
}

export interface ThrowSiteMeta {
  exceptionText: string;
  exceptionClassName?: string;
  messageText?: string;
}

export interface AssignSiteMeta {
  targetText: string;
  valueText: string;
  isConst: boolean;
  isAwait: boolean;
  /**
   * Classification of the RHS expression. Used by the simulator to know
   * whether a variable's value can be derived deterministically (literal,
   * identifier alias) or comes from an external source (call, db, external)
   * whose shape must be looked up via the call's resolution.
   *
   * 'await_call' = `await someFn()` — the value is the resolved result.
   * 'call'       = bare call without await.
   * 'literal'    = string/number/boolean/null/undefined literal.
   * 'identifier' = bare identifier alias, e.g. `const x = y`.
   * 'member'     = property access, e.g. `const x = req.body`.
   * 'object'     = inline object literal.
   * 'array'      = inline array literal.
   * 'unknown'    = anything else.
   */
  sourceKind?: 'literal' | 'identifier' | 'member' | 'call' | 'await_call' | 'object' | 'array' | 'unknown';
}

export interface AwaitSiteMeta {
  expressionText: string;
}

export interface ParameterMeta {
  typeName?: string;
  isOptional: boolean;
  hasDefault: boolean;
  defaultText?: string;
  decorators: string[];
  /** Preenchido pelo DIResolver para parâmetros de constructor. */
  injectedClassId?: string;
}

export interface FieldMeta {
  typeName?: string;
  visibility: 'public' | 'private' | 'protected';
  isReadonly: boolean;
  isStatic: boolean;
  decorators: string[];
}

export interface VariableMeta {
  typeName?: string;
  isConst: boolean;
  /** Element id do escopo (function/method/arrow) que declara. */
  scopeElementId?: string;
}

export interface ImportBindingMeta {
  originalName: string;
  localName: string;
  sourceModule: string;
  /** Preenchidos pelo ImportResolver. */
  resolvedModuleId?: string;
  resolvedElementId?: string;
}

export interface TypeRefMeta {
  typeName: string;
  typeArgs: string[];
  resolvedElementId?: string;
}

export interface DecoratorRefMeta {
  decoratorName: string;
  args: string[];
  appliedToId: string;
}

export type ElementMeta =
  | ModuleMeta
  | ClassMeta
  | InterfaceMeta
  | TypeAliasMeta
  | EnumMeta
  | BehavioralMeta
  | BranchMeta
  | BranchSubBlockMeta
  | LoopMeta
  | LoopBodyMeta
  | TryBlockMeta
  | CatchMeta
  | FinallyMeta
  | CallSiteMeta
  | ReturnSiteMeta
  | ThrowSiteMeta
  | AssignSiteMeta
  | AwaitSiteMeta
  | ParameterMeta
  | FieldMeta
  | VariableMeta
  | ImportBindingMeta
  | TypeRefMeta
  | DecoratorRefMeta
  | Record<string, never>;

// ────────────────────────────────────────────────────────────────────────────
// Element
// ────────────────────────────────────────────────────────────────────────────

export interface Element<M extends ElementMeta = ElementMeta> {
  id: string;
  kind: ElementKind;
  location: SourceLocation;
  name?: string;
  signature?: string;
  text?: string;
  meta: M;
}
