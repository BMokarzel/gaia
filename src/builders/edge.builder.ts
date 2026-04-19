import type {
  Edge, ServiceNode, DatabaseNode, BrokerNode, CodeNode,
  DbProcessNode, EventNode, CallNode, FunctionNode, EndpointNode,
  BaseCodeNode, DataNode, ReturnNode,
} from '../types/topology';

/**
 * Constrói edges a partir dos nós extraídos.
 * Conecta: endpoints → functions → dbProcesses → databases
 *          functions → events → brokers
 *          services → databases / brokers (ServiceDependency)
 */
export function buildEdges(
  services: ServiceNode[],
  databases: DatabaseNode[],
  brokers: BrokerNode[],
): Edge[] {
  const edges: Edge[] = [];

  for (const service of services) {
    const dbIds = new Set(databases.map(d => d.id));
    const brokerIds = new Map(brokers.map(b => [b.metadata.connectionAlias, b.id]));

    // Endpoint → Function (endpoints são implementados por funções)
    for (const endpoint of service.endpoints) {
      const fn = service.functions.find(f =>
        f.name === endpoint.name &&
        f.location.file === endpoint.location.file
      );
      if (fn) {
        edges.push({ from: endpoint.id, to: fn.id, kind: 'calls' });
      }
    }

    // Coleta todos os codeNodes do serviço
    const allNodes: CodeNode[] = [
      ...service.endpoints,
      ...service.functions,
      ...service.globals,
    ];

    for (const node of allNodes) {
      // Function → DbProcess (writes_to / reads_from)
      if (node.type === 'dbProcess') {
        const dbNode = node as DbProcessNode;
        const db = databases.find(d => d.id === dbNode.metadata.databaseId);
        if (db) {
          const isWrite = ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany', 'raw', 'migrate'].includes(dbNode.metadata.operation);
          edges.push({
            from: dbNode.id,
            to: db.id,
            kind: isWrite ? 'writes_to' : 'reads_from',
            metadata: {
              operation: dbNode.metadata.operation,
              orm: dbNode.metadata.orm,
              table: dbNode.metadata.tableId,
            },
          });
        }
      }

      // Event → Broker
      if (node.type === 'event') {
        const eventNode = node as EventNode;
        const channel = eventNode.metadata.channel;
        if (channel) {
          const brokerId = brokerIds.get(channel);
          if (brokerId) {
            const kind = ['emit', 'publish', 'dispatch'].includes(eventNode.metadata.kind)
              ? 'publishes_to'
              : 'consumes_from';
            edges.push({
              from: service.id,
              to: brokerId,
              kind,
              metadata: { topic: eventNode.metadata.eventName },
            });
          }
        }
      }
    }

    // Service → Database (depends_on)
    for (const dep of service.dependencies) {
      edges.push({
        from: service.id,
        to: dep.targetId,
        kind: 'depends_on',
        metadata: {
          kind: dep.kind,
          protocol: dep.protocol,
          critical: dep.critical,
        },
      });
    }
  }

  // Import edges — DataNode de kind='import' viram edges estruturais
  // Construir mapa de arquivo → serviceId para resolução de imports relativos
  const fileToServiceId = new Map<string, string>();
  for (const svc of services) {
    for (const fn of svc.functions) {
      if (!fileToServiceId.has(fn.location.file)) {
        fileToServiceId.set(fn.location.file, svc.id);
      }
    }
  }

  for (const service of services) {
    for (const global of service.globals) {
      if (global.type !== 'data') continue;
      const dataNode = global as DataNode;
      if (dataNode.metadata.kind !== 'import') continue;

      const modulePath = dataNode.metadata.dataType as string ?? '';
      if (!modulePath) continue;

      // Tenta resolver import relativo para serviceId
      let targetId: string = modulePath;
      if (modulePath.startsWith('.')) {
        // Normaliza: remove extensão e leading ./
        const normalized = modulePath.replace(/^\.\//, '').replace(/\.(ts|js|tsx|jsx)$/, '');
        const resolved = [...fileToServiceId.entries()].find(([file]) =>
          file.replace(/\.(ts|js|tsx|jsx)$/, '').endsWith(normalized)
        );
        if (resolved) targetId = resolved[1];
      }

      edges.push({
        from: service.id,
        to: targetId,
        kind: 'imports',
        metadata: { modulePath },
      });
    }
  }

  // Type dependency edges — parâmetros de constructors com tipos anotados
  const PRIMITIVE_TYPES = new Set([
    'string', 'number', 'boolean', 'any', 'unknown', 'void',
    'never', 'null', 'undefined', 'object', 'symbol', 'bigint',
  ]);

  // Mapa className → FunctionNode do constructor (ou primeiro método)
  const classToConstructor = new Map<string, FunctionNode>();
  for (const svc of services) {
    for (const fn of svc.functions) {
      if (fn.metadata.kind === 'constructor' && fn.metadata.className) {
        classToConstructor.set(fn.metadata.className, fn);
      }
    }
  }

  for (const service of services) {
    for (const fn of service.functions) {
      if (fn.metadata.kind !== 'constructor') continue;

      for (const param of fn.metadata.params) {
        if (!param.type) continue;

        // Extrai tipo base de generics: Partial<User> → User, Repository<User> → Repository
        const baseTypeMatch = /^([A-Z][a-zA-Z0-9]*)/.exec(param.type);
        const baseType = baseTypeMatch?.[1];
        if (!baseType || PRIMITIVE_TYPES.has(baseType.toLowerCase())) continue;

        const target = classToConstructor.get(baseType);
        if (target && target.id !== fn.id) {
          edges.push({
            from: fn.id,
            to: target.id,
            kind: 'depends_on',
            metadata: { paramName: param.name, typeName: baseType },
          });
        }
      }
    }
  }

  // Read edges — variáveis locais referenciadas em calls e returns
  const MIN_VAR_NAME_LENGTH = 2;

  for (const service of services) {
    for (const fn of service.functions) {
      const localVars = fn.children.filter(
        c => c.type === 'data' &&
          (c as DataNode).metadata.scope === 'local' &&
          (c as DataNode).metadata.kind !== 'destructuring' &&
          c.name.length >= MIN_VAR_NAME_LENGTH,
      ) as DataNode[];

      if (localVars.length === 0) continue;

      const calls = fn.children.filter(c => c.type === 'call') as CallNode[];
      const returns = fn.children.filter(c => c.type === 'return') as ReturnNode[];

      for (const varNode of localVars) {
        const varName = varNode.name;

        for (const call of calls) {
          if (call.metadata.arguments.some(a => a.includes(varName)) ||
              call.metadata.callee.includes(varName)) {
            edges.push({ from: varNode.id, to: call.id, kind: 'uses' });
          }
        }

        for (const ret of returns) {
          const val = ret.metadata.value ?? '';
          if (val.includes(varName)) {
            edges.push({ from: varNode.id, to: ret.id, kind: 'uses' });
          }
        }
      }
    }
  }

  // Function → Function call edges
  const allFunctions = services.flatMap(s => s.functions);
  const fnByName = new Map(allFunctions.map(f => [f.name, f]));

  // Índice por nome de método simples (último segmento de "Class.method")
  const fnByMethodName = new Map<string, FunctionNode[]>();
  for (const fn of allFunctions) {
    const methodName = fn.name.includes('.') ? fn.name.split('.').pop()! : fn.name;
    const bucket = fnByMethodName.get(methodName) ?? [];
    bucket.push(fn);
    fnByMethodName.set(methodName, bucket);
  }

  for (const service of services) {
    for (const fn of service.functions) {
      for (const child of fn.children) {
        if (child.type !== 'call') continue;
        const callNode = child as CallNode;

        const target = resolveCallTarget(
          callNode.metadata.callee,
          fn.metadata.className,
          fnByName,
          fnByMethodName,
        );

        if (target && target.id !== fn.id) {
          edges.push({ from: fn.id, to: target.id, kind: 'calls' });
          callNode.metadata.resolvedTo = target.id;
        }
      }
    }
  }

  // Broker topic producers/consumers → service edges
  for (const broker of brokers) {
    for (const topic of broker.metadata.topics) {
      for (const producerId of topic.producers) {
        edges.push({
          from: producerId,
          to: broker.id,
          kind: 'publishes_to',
          metadata: { topic: topic.name },
        });
      }
      for (const consumerId of topic.consumers) {
        edges.push({
          from: broker.id,
          to: consumerId,
          kind: 'consumes_from',
          metadata: { topic: topic.name },
        });
      }
    }
  }

  return deduplicateEdges(edges);
}

/**
 * Resolve o alvo de uma chamada para um FunctionNode conhecido.
 *
 * Estratégias (em ordem de prioridade):
 * 1. Match direto pelo nome completo (ex: "UsersService.validate")
 * 2. this.method → ClassName.method (mesmo classe)
 * 3. this.field.method → busca pelo nome do método em todos os serviços
 */
function resolveCallTarget(
  callee: string,
  className: string | undefined,
  fnByName: Map<string, FunctionNode>,
  fnByMethodName: Map<string, FunctionNode[]>,
): FunctionNode | undefined {
  // 1. Match direto
  if (fnByName.has(callee)) return fnByName.get(callee);

  const parts = callee.split('.');

  // 2. this.method → ClassName.method
  if (className && parts.length === 2 && parts[0] === 'this') {
    const fqn = `${className}.${parts[1]}`;
    if (fnByName.has(fqn)) return fnByName.get(fqn);
  }

  // 3. this.field.method → busca por nome de método (ex: this.repo.findAll → findAll)
  if (parts.length >= 3 && parts[0] === 'this') {
    const methodName = parts[parts.length - 1];
    const candidates = fnByMethodName.get(methodName) ?? [];
    if (candidates.length > 0) return candidates[0];
  }

  return undefined;
}

function deduplicateEdges(edges: Edge[]): Edge[] {
  const seen = new Set<string>();
  return edges.filter(e => {
    const key = `${e.from}→${e.to}:${e.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
