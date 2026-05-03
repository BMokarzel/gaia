// ─────────────────────────────────────────────────────────────
// Format a TopologyDiff as a GitHub PR review comment (Markdown).
// Pure function — easy to snapshot test, easy to render in any
// surface (CLI, web preview, GH comment).
// ─────────────────────────────────────────────────────────────

import type { TopologyDiff } from './topology-diff';
import type { SystemTopology } from '../types/topology';

export interface PrCommentOptions {
  /** Pull request number — included as anchor in the header. */
  prNumber?: number;
  /** Optional `topologyId` to render in the header. */
  topologyName?: string;
  /**
   * Map of serviceId → owner names (already resolved). When provided, modified
   * services are annotated with their owners so the PR bot can mention them.
   */
  ownersByService?: Record<string, string[]>;
  /** Drives whether breaking-change warnings are surfaced (default true). */
  highlightBreaking?: boolean;
}

/**
 * Renders a diff as a GitHub-flavored Markdown comment. The output is intentionally
 * compact: a header, a summary table, then per-section bullet lists. Sections with
 * no changes are omitted so a PR with only metadata edits doesn't produce noise.
 */
export function formatPrDiffComment(
  diff: TopologyDiff,
  opts: PrCommentOptions = {},
): string {
  const lines: string[] = [];
  const { summary } = diff;
  const noChanges = summary.totalChanges === 0;

  const headerSuffix = opts.topologyName ? ` for **${opts.topologyName}**` : '';
  lines.push(`### 🗺 Topology impact${headerSuffix}`);
  lines.push('');

  if (noChanges) {
    lines.push('_No structural changes detected._');
    lines.push('');
    lines.push(refLine(diff));
    return lines.join('\n');
  }

  // Summary chips
  const chips: string[] = [];
  if (summary.servicesAdded)     chips.push(`+${summary.servicesAdded} service(s)`);
  if (summary.servicesRemoved)   chips.push(`-${summary.servicesRemoved} service(s)`);
  if (summary.servicesModified)  chips.push(`~${summary.servicesModified} service(s)`);
  if (summary.endpointsAdded)    chips.push(`+${summary.endpointsAdded} endpoint(s)`);
  if (summary.endpointsRemoved)  chips.push(`-${summary.endpointsRemoved} endpoint(s)`);
  if (summary.endpointsModified) chips.push(`~${summary.endpointsModified} endpoint(s)`);
  if (chips.length > 0) {
    lines.push(chips.map(c => `\`${c}\``).join(' '));
    lines.push('');
  }

  // Breaking-change banner
  const highlightBreaking = opts.highlightBreaking !== false;
  if (highlightBreaking) {
    const breaking = collectBreakingChanges(diff);
    if (breaking.length > 0) {
      lines.push('> ⚠ **Possibly breaking:**');
      for (const item of breaking) lines.push(`> - ${item}`);
      lines.push('');
    }
  }

  // Services
  if (diff.services.added.length > 0) {
    lines.push('**New services**');
    for (const s of diff.services.added) lines.push(`- \`${s.name}\` (\`${s.id}\`)`);
    lines.push('');
  }

  if (diff.services.removed.length > 0) {
    lines.push('**Removed services**');
    for (const s of diff.services.removed) lines.push(`- \`${s.name}\` (\`${s.id}\`)`);
    lines.push('');
  }

  if (diff.services.modified.length > 0) {
    lines.push('**Modified services**');
    for (const svc of diff.services.modified) {
      const owners = opts.ownersByService?.[svc.id];
      const ownerSuffix = owners && owners.length > 0 ? ` _— owners: ${owners.join(', ')}_` : '';
      lines.push(`- \`${svc.name}\`${ownerSuffix}`);
      if (svc.changes.length > 0) {
        for (const c of svc.changes) lines.push(`  - ${c}`);
      }
      if (svc.endpoints.added.length > 0) {
        lines.push(`  - \`+${svc.endpoints.added.length}\` endpoint(s):`);
        for (const e of svc.endpoints.added) lines.push(`    - \`${e.method} ${e.path}\``);
      }
      if (svc.endpoints.removed.length > 0) {
        lines.push(`  - \`-${svc.endpoints.removed.length}\` endpoint(s):`);
        for (const e of svc.endpoints.removed) lines.push(`    - \`${e.method} ${e.path}\``);
      }
      if (svc.endpoints.modified.length > 0) {
        lines.push(`  - \`~${svc.endpoints.modified.length}\` endpoint(s):`);
        for (const e of svc.endpoints.modified) {
          lines.push(`    - \`${e.method} ${e.path}\` — ${e.changes.join('; ')}`);
        }
      }
      if (svc.databases.added.length > 0 || svc.databases.removed.length > 0) {
        const dbBits: string[] = [];
        if (svc.databases.added.length > 0) dbBits.push(`+${svc.databases.added.join(', ')}`);
        if (svc.databases.removed.length > 0) dbBits.push(`-${svc.databases.removed.join(', ')}`);
        lines.push(`  - dbs: ${dbBits.join(' / ')}`);
      }
    }
    lines.push('');
  }

  // Topology-level dbs/edges
  if (diff.databases.added.length > 0 || diff.databases.removed.length > 0) {
    lines.push('**Databases**');
    for (const d of diff.databases.added)   lines.push(`- \`+\` \`${d.name}\``);
    for (const d of diff.databases.removed) lines.push(`- \`-\` \`${d.name}\``);
    lines.push('');
  }

  if (diff.edges.added.length > 0 || diff.edges.removed.length > 0) {
    lines.push('**Cross-service edges**');
    for (const e of diff.edges.added)   lines.push(`- \`+\` \`${e.kind}\` \`${e.source}\` → \`${e.target}\``);
    for (const e of diff.edges.removed) lines.push(`- \`-\` \`${e.kind}\` \`${e.source}\` → \`${e.target}\``);
    lines.push('');
  }

  // Reviewer suggestions (collected from modified services)
  const reviewerSuggestion = buildReviewerSuggestion(diff, opts.ownersByService);
  if (reviewerSuggestion) {
    lines.push(reviewerSuggestion);
    lines.push('');
  }

  if (opts.prNumber) lines.push(`<!-- topology-bot pr=${opts.prNumber} -->`);
  lines.push(refLine(diff));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function refLine(diff: TopologyDiff): string {
  return `_diff: \`${diff.from.sha.slice(0, 7)}\` → \`${diff.to.sha.slice(0, 7)}\`_`;
}

/**
 * Heuristic breaking-change detection from a diff. Conservative — only flags
 * removals (services / endpoints / dbs), since those almost certainly break callers.
 * Auth-tightening on modified endpoints is also flagged.
 */
function collectBreakingChanges(diff: TopologyDiff): string[] {
  const out: string[] = [];
  for (const s of diff.services.removed) out.push(`service removed: \`${s.name}\``);
  for (const svc of diff.services.modified) {
    for (const e of svc.endpoints.removed) {
      out.push(`endpoint removed: \`${e.method} ${e.path}\` (in \`${svc.name}\`)`);
    }
    for (const e of svc.endpoints.modified) {
      const authChange = e.changes.find(c => c.toLowerCase().startsWith('auth'));
      if (authChange) out.push(`endpoint auth changed: \`${e.method} ${e.path}\` — ${authChange}`);
    }
  }
  for (const d of diff.databases.removed) out.push(`database removed: \`${d.name}\``);
  return out;
}

/**
 * Builds a "cc @owner-a, @owner-b" line from the modified services' owner sets.
 * Returns null when no owners are mappable (so we don't emit an empty mention).
 */
function buildReviewerSuggestion(
  diff: TopologyDiff,
  ownersByService?: Record<string, string[]>,
): string | null {
  if (!ownersByService) return null;
  const reviewers = new Set<string>();
  const consider = [
    ...diff.services.modified.map(s => s.id),
    ...diff.services.removed.map(s => s.id),
  ];
  for (const id of consider) {
    const owners = ownersByService[id];
    if (!owners) continue;
    for (const o of owners) reviewers.add(o);
  }
  if (reviewers.size === 0) return null;
  return `**Suggested reviewers** (via CODEOWNERS): ${[...reviewers].map(o => `\`${o}\``).join(', ')}`;
}

/**
 * Convenience: extract a serviceId → owner-names map from a SystemTopology.
 * Mirrors the indexing used by the API's ecosystem updater so PR comments stay
 * consistent with the ecosystem view.
 */
export function ownersByServiceFromTopology(topology: SystemTopology): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const ownership = topology.ownership;
  if (!ownership) return result;
  const ownerById = new Map(ownership.owners.map(o => [o.id, o] as const));
  for (const edge of ownership.edges) {
    if (edge.targetKind !== 'service') continue;
    const owner = ownerById.get(edge.ownerId);
    if (!owner) continue;
    const list = result[edge.targetId] ?? (result[edge.targetId] = []);
    if (!list.includes(owner.name)) list.push(owner.name);
  }
  return result;
}
