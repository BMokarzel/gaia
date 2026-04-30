/**
 * labelFor — texto legível por kind, para display em FlowTree e CLI.
 * Referência: AST_FLOW_EXTRACTION_PLAN.md §6.4
 */

import type {
  Element,
  AssignSiteMeta,
  AwaitSiteMeta,
  BehavioralMeta,
  BranchMeta,
  CallSiteMeta,
  CatchMeta,
  ClassMeta,
  LoopMeta,
  ModuleMeta,
  ParameterMeta,
  ReturnSiteMeta,
  ThrowSiteMeta,
  VariableMeta,
} from './element';

export function labelFor(element: Element): string {
  switch (element.kind) {
    case 'module':
      return element.location.file;
    case 'class':
      return `class ${element.name ?? '<anon>'}`;
    case 'interface':
      return `interface ${element.name ?? '<anon>'}`;
    case 'type_alias':
      return `type ${element.name ?? '<anon>'}`;
    case 'enum':
      return `enum ${element.name ?? '<anon>'}`;
    case 'method':
    case 'function':
    case 'arrow_function':
    case 'getter':
    case 'setter':
    case 'constructor': {
      const m = element.meta as BehavioralMeta;
      const sig = element.signature ?? `${element.name ?? element.kind}(${'…'.repeat(m.paramCount > 0 ? 1 : 0)})`;
      const httpTag = m.httpMethod ? ` [${m.httpMethod}${m.httpPath ? ' ' + m.httpPath : ''}]` : '';
      return `${element.kind} ${sig}${httpTag}`;
    }
    case 'branch': {
      const m = element.meta as BranchMeta;
      return `if (${m.conditionText})`;
    }
    case 'branch_then':
      return 'then';
    case 'branch_else':
      return 'else';
    case 'loop': {
      const m = element.meta as LoopMeta;
      const v = m.variableText ?? '_';
      const it = m.iterableText ?? '?';
      switch (m.loopKind) {
        case 'for-of':
          return `for (${v} of ${it})`;
        case 'for-in':
          return `for (${v} in ${it})`;
        case 'for':
          return 'for (…)';
        case 'while':
          return `while (${it})`;
        case 'do-while':
          return `do … while (${it})`;
      }
      return 'loop';
    }
    case 'loop_body':
      return 'body';
    case 'try_block':
      return 'try';
    case 'catch_block': {
      const m = element.meta as CatchMeta;
      const param = m.errorParamName ?? 'e';
      const type = m.errorTypeName ? `: ${m.errorTypeName}` : '';
      return `catch (${param}${type})`;
    }
    case 'finally_block':
      return 'finally';
    case 'call_site': {
      const m = element.meta as CallSiteMeta;
      const args = m.argsText.join(', ');
      const prefix = m.isAwaited ? 'await ' : '';
      return `${prefix}${m.calleeText}(${args})`;
    }
    case 'return_site': {
      const m = element.meta as ReturnSiteMeta;
      return m.isVoid ? 'return' : `return ${m.valueText ?? ''}`;
    }
    case 'throw_site': {
      const m = element.meta as ThrowSiteMeta;
      return `throw ${m.exceptionText}`;
    }
    case 'assign_site': {
      const m = element.meta as AssignSiteMeta;
      const kw = m.isConst ? 'const' : 'let';
      const aw = m.isAwait ? 'await ' : '';
      return `${kw} ${m.targetText} = ${aw}${m.valueText}`;
    }
    case 'await_site': {
      const m = element.meta as AwaitSiteMeta;
      return `await ${m.expressionText}`;
    }
    case 'parameter': {
      const m = element.meta as ParameterMeta;
      const t = m.typeName ? `: ${m.typeName}` : '';
      const opt = m.isOptional ? '?' : '';
      return `${element.name ?? '_'}${opt}${t}`;
    }
    case 'field':
      return `field ${element.name ?? '_'}`;
    case 'variable': {
      const m = element.meta as VariableMeta;
      const kw = m.isConst ? 'const' : 'let';
      const t = m.typeName ? `: ${m.typeName}` : '';
      return `${kw} ${element.name ?? '_'}${t}`;
    }
    case 'import_binding':
      return `import ${element.name ?? '_'}`;
    case 'type_ref':
      return `type ${element.name ?? '_'}`;
    case 'decorator_ref':
      return `@${element.name ?? '_'}`;
  }
  // Defensive fallback — toda kind deveria estar coberta acima.
  const _exhaustive: never = element.kind as never;
  return String(_exhaustive);
}

/**
 * Helper para módulo: rótulo curto sem path inteiro.
 * Útil para módulos: "module: users.controller.ts" em vez do path completo.
 */
export function shortModuleLabel(element: Element): string {
  if (element.kind !== 'module') return labelFor(element);
  const m = element.meta as ModuleMeta;
  const file = element.location.file;
  const base = file.split('/').pop() ?? file;
  return `${base} (${m.language})`;
}
