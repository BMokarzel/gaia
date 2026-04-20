import type { DataNode, TypedField, ResolvedField, ServiceNode } from '../types/topology';

/**
 * Constrói um índice de nome-de-tipo → campos a partir dos DataNodes extraídos.
 * Usado para popular ParamInfo.resolvedFields.
 */
export function buildTypeIndex(services: ServiceNode[]): Map<string, TypedField[]> {
  const index = new Map<string, TypedField[]>();

  for (const service of services) {
    for (const global of service.globals) {
      if (global.type !== 'data') continue;
      const node = global as DataNode;
      if (
        (node.metadata.kind === 'interface' || node.metadata.kind === 'type') &&
        node.metadata.fields &&
        node.metadata.fields.length > 0
      ) {
        index.set(node.name, node.metadata.fields);
      }
    }

    // Também busca em filhos de funções (classes aninhadas, tipos locais)
    for (const fn of service.functions) {
      for (const child of fn.children) {
        if (child.type !== 'data') continue;
        const node = child as DataNode;
        if (
          (node.metadata.kind === 'interface' || node.metadata.kind === 'type') &&
          node.metadata.fields &&
          node.metadata.fields.length > 0
        ) {
          index.set(node.name, node.metadata.fields);
        }
      }
    }
  }

  return index;
}

const PRIMITIVE_TYPES = new Set([
  'string', 'number', 'boolean', 'any', 'unknown', 'void',
  'never', 'null', 'undefined', 'object', 'symbol', 'bigint',
  'String', 'Number', 'Boolean', 'Object', 'Array', 'Date',
  'Buffer', 'Promise', 'Observable', 'Subject', 'BehaviorSubject',
]);

/**
 * Resolve um nome de tipo para ResolvedField[], usando o índice de tipos.
 * Retorna undefined se o tipo for primitivo, genérico externo ou não encontrado.
 */
export function resolveType(
  typeName: string,
  typeIndex: Map<string, TypedField[]>,
  visited = new Set<string>(),
): ResolvedField[] | undefined {
  if (!typeName) return undefined;

  // Extrai tipo base de genéricos: Promise<User> → User, Partial<User> → User
  const baseMatch = /^[A-Za-z_][A-Za-z0-9_]*<([A-Za-z_][A-Za-z0-9_]*)>/.exec(typeName);
  const baseName = baseMatch ? baseMatch[1] : typeName.replace(/[?[\]]/g, '').trim();

  if (PRIMITIVE_TYPES.has(baseName)) return undefined;
  if (visited.has(baseName)) return undefined; // proteção circular

  const fields = typeIndex.get(baseName);
  if (!fields || fields.length === 0) return undefined;

  visited.add(baseName);

  return fields.map(f => {
    const resolved: ResolvedField = {
      name: f.name,
      type: f.type,
      required: f.required,
    };

    // Resolve recursivamente apenas um nível (evita explosão)
    if (!PRIMITIVE_TYPES.has(f.type) && visited.size < 3) {
      const nested = resolveType(f.type, typeIndex, new Set(visited));
      if (nested && nested.length > 0) resolved.nested = nested;
    }

    return resolved;
  });
}

/**
 * Aplica resolvedFields em todos os ParamInfo de todos os serviços.
 * Mutação in-place — chamada como pós-processamento.
 */
export function resolveAllParamTypes(
  services: ServiceNode[],
  typeIndex: Map<string, TypedField[]>,
): void {
  for (const service of services) {
    for (const fn of service.functions) {
      for (const param of fn.metadata.params) {
        if (!param.type || param.resolvedFields) continue;
        const resolved = resolveType(param.type, typeIndex);
        if (resolved) param.resolvedFields = resolved;
      }
    }

    for (const ep of service.endpoints) {
      for (const child of ep.children) {
        if (child.type !== 'function') continue;
        const fn = child as import('../types/topology').FunctionNode;
        for (const param of fn.metadata.params) {
          if (!param.type || param.resolvedFields) continue;
          const resolved = resolveType(param.type, typeIndex);
          if (resolved) param.resolvedFields = resolved;
        }
      }
    }
  }
}
