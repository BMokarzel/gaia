// Public surface of @topology/code-graph.

export * from './element';
export * from './edge';
export * from './ids';
export * from './graph';
export * from './serializer';
export { labelFor, shortModuleLabel } from './labels';

// Walkers
export type { ASTWalker, ElementBatch } from './walkers/ast-walker';
export { emptyBatch, mergeBatches } from './walkers/ast-walker';
export type { SourceFile } from './walkers/source-file';
export { TsAstWalker, serializeConditionExpr } from './walkers/ts-ast-walker';
export { isAvailable as isTsParserAvailable } from './walkers/ts-parser-adapter';

// Resolvers
export {
  runResolvers,
  runImportResolver,
  runDIResolver,
  runCallResolver,
  runTypeResolver,
  runStructuralResolver,
  createResolverContext,
  emptyStats,
  type ResolverContext,
  type ResolverStats,
  type InjectionMap,
  type RunResolversOptions,
} from './resolvers';

// Flow + queries + builder
export {
  type FlowTree,
  type FlowNode,
  type FlowOptions,
  type FlowStats,
  isFlowRelevant,
  FLOW_RELEVANT_KINDS,
  DEFAULT_FLOW_OPTIONS,
} from './flow/flow-tree';
export { buildFlowTree } from './flow/flow-tree-builder';
export { detectCycles, type CycleDetectorOptions } from './flow/cycle-detector';
export {
  callersOf,
  calleesOf,
  deadCode,
  throwSitesReachableFrom,
  depthFromEntry,
  cycles,
  unresolvedCalls,
} from './queries';
export { buildGraph, type BuildGraphOptions, type BuildGraphResult } from './builder';

// Schema validation
export {
  validateGraphJSON,
  type ValidationResult,
  type ValidationIssue,
} from './schema-validate';
