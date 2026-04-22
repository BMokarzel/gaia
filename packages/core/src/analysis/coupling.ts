import type { ServiceNode, FunctionNode, Edge } from '../types/topology';

export interface ServiceCoupling {
  serviceId: string;
  ca: number;
  ce: number;
  instability: number;
  classes: { name: string; ca: number; ce: number; instability: number }[];
}

/**
 * Computa métricas de acoplamento Ca/Ce/Instabilidade por serviço.
 * Retorna os dados sem modificar ServiceNode.
 *
 * Ca (afferent)  = quantas classes externas dependem desta
 * Ce (efferent)  = quantas classes externas esta depende
 * I  (instability) = Ce / (Ca + Ce) — 0=estável, 1=instável
 */
export function computeCoupling(
  services: ServiceNode[],
  edges: Edge[],
): ServiceCoupling[] {
  const result: ServiceCoupling[] = [];
  // Mapas auxiliares
  const fnToClass = new Map<string, string>();   // fnId → className
  const fnToService = new Map<string, string>(); // fnId → serviceId
  const classToService = new Map<string, string>(); // className → serviceId

  for (const svc of services) {
    for (const fn of svc.functions) {
      fnToClass.set(fn.id, fn.metadata.className ?? fn.name);
      fnToService.set(fn.id, svc.id);
      if (fn.metadata.className) {
        classToService.set(fn.metadata.className, svc.id);
      }
    }
  }

  // Para cada serviço, coletar Ca e Ce entre classes distintas
  const couplingKinds = new Set(['calls', 'depends_on']);

  for (const svc of services) {
    const ownClasses = new Set(
      svc.functions
        .map(f => f.metadata.className ?? f.name)
        .filter(Boolean),
    );

    const caClasses = new Set<string>(); // classes externas que dependem deste serviço
    const ceClasses = new Set<string>(); // classes externas que este serviço usa

    for (const edge of edges) {
      if (!couplingKinds.has(edge.kind)) continue;

      const fromClass = fnToClass.get(edge.source);
      const toClass = fnToClass.get(edge.target);
      if (!fromClass || !toClass) continue;
      if (fromClass === toClass) continue; // intra-classe não conta

      const fromSvc = fnToService.get(edge.source);
      const toSvc = fnToService.get(edge.target);

      // Ce: edge saindo deste serviço para classe externa
      if (fromSvc === svc.id && toSvc !== svc.id) {
        ceClasses.add(toClass);
      }
      // Ca: edge entrando neste serviço vindo de classe externa
      if (toSvc === svc.id && fromSvc !== svc.id) {
        caClasses.add(fromClass);
      }
    }

    const ca = caClasses.size;
    const ce = ceClasses.size;
    const instability = ca + ce === 0 ? 0 : ce / (ca + ce);

    const classes = computeClassCoupling(svc, edges, fnToClass);

    result.push({
      serviceId: svc.id,
      ca,
      ce,
      instability: Math.round(instability * 100) / 100,
      classes,
    });
  }

  return result;
}

/**
 * Calcula Ca/Ce/Instabilidade para cada classe dentro de um serviço,
 * considerando todas as edges (incluindo intra-serviço) entre classes distintas.
 */
function computeClassCoupling(
  svc: ServiceNode,
  edges: Edge[],
  fnToClass: Map<string, string>,
): { name: string; ca: number; ce: number; instability: number }[] {
  const ownClasses = new Set(
    svc.functions
      .map(f => f.metadata.className)
      .filter((c): c is string => Boolean(c)),
  );

  const couplingKinds = new Set(['calls', 'depends_on']);
  const classCa = new Map<string, Set<string>>();
  const classCe = new Map<string, Set<string>>();

  for (const cls of ownClasses) {
    classCa.set(cls, new Set());
    classCe.set(cls, new Set());
  }

  for (const edge of edges) {
    if (!couplingKinds.has(edge.kind)) continue;

    const fromClass = fnToClass.get(edge.source);
    const toClass = fnToClass.get(edge.target);
    if (!fromClass || !toClass || fromClass === toClass) continue;

    if (ownClasses.has(fromClass)) {
      classCe.get(fromClass)!.add(toClass);
    }
    if (ownClasses.has(toClass)) {
      classCa.get(toClass)!.add(fromClass);
    }
  }

  return [...ownClasses].map(name => {
    const ca = classCa.get(name)!.size;
    const ce = classCe.get(name)!.size;
    const instability = ca + ce === 0 ? 0 : Math.round((ce / (ca + ce)) * 100) / 100;
    return { name, ca, ce, instability };
  });
}
