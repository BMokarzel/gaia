import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  computeTopologyDiff,
  formatPrDiffComment,
  ownersByServiceFromTopology,
  type SystemTopology,
} from '@topology/core';
import { TOPOLOGY_STORAGE } from '../../storage/tokens';
import type { ITopologyStorageRepository, StoredTopology } from '../../storage/interfaces/topology-storage.interface';
import { EXTRACTION_SERVICE } from '../../extraction/tokens';
import type { IExtractionService } from '../../extraction/interfaces/extraction-service.interface';
import type { SourceDescriptor } from '../../extraction/interfaces/extraction-source-adapter.interface';

export interface PrAnalysisInput {
  topologyId: string;
  prNumber: number;
  /** Owner of the PR-targeted repo (`octocat` for `octocat/hello-world`). */
  baseOwner: string;
  /** Repo name. */
  baseRepo: string;
  /** Clone URL of the head repo (may be a fork). */
  headCloneUrl: string;
  /** Branch name on the head repo. */
  headRef: string;
  /** Head commit SHA. */
  headSha: string;
}

export interface PrAnalysisResult {
  status: 'commented' | 'no_changes' | 'skipped';
  reason?: string;
  /** SHA of the comment that was posted/updated, when applicable. */
  commentBody?: string;
  /** GitHub-assigned id of the comment when posting succeeded. */
  commentId?: number;
}

const COMMENT_MARKER_PREFIX = '<!-- topology-bot pr=';

@Injectable()
export class PrBotService {
  private readonly logger = new Logger(PrBotService.name);

  constructor(
    @Inject(TOPOLOGY_STORAGE) private readonly storage: ITopologyStorageRepository,
    @Inject(EXTRACTION_SERVICE) private readonly extraction: IExtractionService,
  ) {}

  /**
   * Full PR analysis flow:
   *   1. Look up the stored "main-branch" topology (we diff against this)
   *   2. Re-extract using a SourceDescriptor pointed at the PR head
   *   3. Compute diff (stored → head)
   *   4. Render Markdown comment, with reviewer suggestions when CODEOWNERS data exists
   *   5. Upsert comment via GitHub API (creates or updates the existing bot comment)
   *
   * Returns `no_changes` when the PR doesn't alter topology shape — the bot stays silent
   * to avoid noise on chore/test-only PRs.
   */
  async analyzeAndComment(input: PrAnalysisInput): Promise<PrAnalysisResult> {
    const stored = await this.storage.findById(input.topologyId);
    if (!stored) {
      throw new NotFoundException(`Topology "${input.topologyId}" not found for PR #${input.prNumber}`);
    }

    const headSource = this.deriveHeadSource(stored.source, input.headCloneUrl, input.headRef, input.headSha);
    let headTopology: SystemTopology;
    let headSha: string;
    try {
      const result = await this.extraction.extract(headSource);
      headTopology = result.topology;
      headSha = result.commitSha ?? input.headSha;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`PR #${input.prNumber} extraction failed: ${msg}`);
      return { status: 'skipped', reason: `extraction failed: ${msg}` };
    }

    const diff = computeTopologyDiff(stored.topology, headTopology, {
      fromSha: stored.commitSha ?? 'main',
      toSha: headSha,
      fromAnalyzedAt: stored.analyzedAt,
      toAnalyzedAt: new Date().toISOString(),
    });

    if (diff.summary.totalChanges === 0) {
      this.logger.log(`PR #${input.prNumber} has no topology changes — staying silent`);
      return { status: 'no_changes' };
    }

    // Owners come from the *stored* topology (the one PR is being merged into).
    // We don't recompute them off the head: a CODEOWNERS edit in the PR shouldn't
    // change who is asked to review *that* PR.
    const ownersByService = ownersByServiceFromTopology(stored.topology);
    const body = formatPrDiffComment(diff, {
      prNumber: input.prNumber,
      topologyName: stored.name,
      ownersByService,
    });

    if (!process.env.GITHUB_TOKEN) {
      this.logger.warn('GITHUB_TOKEN not set — skipping PR comment post (returning preview only)');
      return { status: 'skipped', reason: 'GITHUB_TOKEN not configured', commentBody: body };
    }

    const upserted = await this.upsertPrComment(input.baseOwner, input.baseRepo, input.prNumber, body);
    return { status: 'commented', commentBody: body, commentId: upserted.id };
  }

  /**
   * Construct a head-pointing SourceDescriptor.
   *
   * - If the stored source is `git`, replace url/ref but keep the original kind.
   * - If the stored source is `github`, switch to a `git` descriptor — github's
   *   own descriptor doesn't natively encode a fork's clone URL, so we fall back
   *   to git+clone_url+head SHA which the GitAdapter handles.
   * - For `local` sources we still emit a `git` descriptor: PR analysis only
   *   makes sense when there's a remote to clone.
   */
  private deriveHeadSource(
    base: SourceDescriptor,
    cloneUrl: string,
    headRef: string,
    headSha: string,
  ): SourceDescriptor {
    return {
      kind: 'git',
      url: cloneUrl,
      branch: headRef,
      ref: headSha,
    };
  }

  /**
   * Find an existing bot comment by marker, then either PATCH it or POST a new one.
   * The marker (`<!-- topology-bot pr=N -->`) is embedded in the formatter so we
   * don't accumulate a comment per push on the PR — one comment, kept up to date.
   */
  private async upsertPrComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
  ): Promise<{ id: number; url: string }> {
    const marker = `${COMMENT_MARKER_PREFIX}${prNumber} -->`;
    const existing = await this.findExistingComment(owner, repo, prNumber, marker);

    if (existing) {
      const res = await ghFetch(
        `/repos/${owner}/${repo}/issues/comments/${existing.id}`,
        { method: 'PATCH', body: JSON.stringify({ body }) },
      );
      const json = (await res.json()) as { id: number; html_url: string };
      return { id: json.id, url: json.html_url };
    }

    const res = await ghFetch(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
    const json = (await res.json()) as { id: number; html_url: string };
    return { id: json.id, url: json.html_url };
  }

  private async findExistingComment(
    owner: string,
    repo: string,
    prNumber: number,
    marker: string,
  ): Promise<{ id: number } | null> {
    // Iterate paginated comments — usually there are only a handful so 1-2 pages suffice.
    for (let page = 1; page <= 5; page++) {
      const res = await ghFetch(
        `/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`,
      );
      const items = await res.json();
      if (!Array.isArray(items) || items.length === 0) return null;
      const hit = items.find((c: any) => typeof c.body === 'string' && c.body.includes(marker));
      if (hit) return { id: hit.id };
      if (items.length < 100) return null;
    }
    return null;
  }
}

/**
 * Thin wrapper around fetch that adds GitHub auth + accept headers, throws on non-2xx.
 * Token comes from `GITHUB_TOKEN` (a GitHub App installation token or a PAT with
 * `repo` scope is enough for issue comments).
 */
async function ghFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN is required to call the GitHub API');
  }
  const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  }
  return res;
}
