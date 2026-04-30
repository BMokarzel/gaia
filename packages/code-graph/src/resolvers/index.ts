/**
 * Pipeline de resolvers — ordem fixa (§A.4):
 *   1. Imports → permite que DI/Type/Call resolvam via import_binding
 *   2. DI      → preenche injectionMap usado por Call
 *   3. Structural → extends/implements (Call usa `implements` p/ achar
 *                   impl concreta quando o tipo injetado é interface)
 *   4. Calls   → resolve call_sites
 *   5. Types   → resolve type_refs / return / throws
 */

import type { ElementGraph } from '../graph';
import { createResolverContext, type ResolverContext, type ResolverStats } from './resolver-context';
import { runImportResolver } from './import-resolver';
import { runDIResolver } from './di-resolver';
import { runCallResolver } from './call-resolver';
import { runTypeResolver } from './type-resolver';
import { runStructuralResolver } from './structural-resolver';

export interface RunResolversOptions {
  rootDir?: string;
}

export function runResolvers(
  graph: ElementGraph,
  options: RunResolversOptions = {},
): { context: ResolverContext; stats: ResolverStats } {
  const ctx = createResolverContext(options.rootDir);
  runImportResolver(graph, ctx);
  runDIResolver(graph, ctx);
  runStructuralResolver(graph, ctx);
  runCallResolver(graph, ctx);
  runTypeResolver(graph, ctx);
  return { context: ctx, stats: ctx.stats };
}

export { runImportResolver } from './import-resolver';
export { runDIResolver } from './di-resolver';
export { runCallResolver } from './call-resolver';
export { runTypeResolver } from './type-resolver';
export { runStructuralResolver } from './structural-resolver';
export {
  createResolverContext,
  emptyStats,
  type ResolverContext,
  type ResolverStats,
  type InjectionMap,
} from './resolver-context';
