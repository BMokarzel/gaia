/**
 * ResolverContext — estado compartilhado entre os resolvers.
 *
 * O contexto é construído pelo orquestrador (`runResolvers`) e mutado
 * por cada resolver na sequência import → DI → call → type → structural.
 */

export interface InjectionMap {
  /** className → fieldName → resolved class id */
  [className: string]: { [fieldName: string]: string };
}

export interface ResolverStats {
  importsResolved: number;
  importsExternal: number;
  diResolved: number;
  callsResolved: number;
  callsExternal: number;
  typesResolved: number;
  extendsResolved: number;
  implementsResolved: number;
}

export function emptyStats(): ResolverStats {
  return {
    importsResolved: 0,
    importsExternal: 0,
    diResolved: 0,
    callsResolved: 0,
    callsExternal: 0,
    typesResolved: 0,
    extendsResolved: 0,
    implementsResolved: 0,
  };
}

export interface ResolverContext {
  /** className → fieldName → injected class id */
  injectionMap: InjectionMap;
  /** rootDir absoluto usado para normalizar paths em resoluções de import. */
  rootDir?: string;
  /** Estatísticas acumuladas — úteis para diagnóstico. */
  stats: ResolverStats;
}

export function createResolverContext(rootDir?: string): ResolverContext {
  return {
    injectionMap: {},
    rootDir,
    stats: emptyStats(),
  };
}
