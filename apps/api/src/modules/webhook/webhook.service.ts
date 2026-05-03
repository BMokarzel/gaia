import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { TOPOLOGY_STORAGE } from '../../storage/tokens';
import type { ITopologyStorageRepository, StoredTopology } from '../../storage/interfaces/topology-storage.interface';
import { TOPOLOGY_SERVICE } from '../topology/tokens';
import type { ITopologyService } from '../topology/interfaces/topology-service.interface';
import { PrBotService } from '../pr-bot/pr-bot.service';
import type { GitHubPushPayload, GitHubPullRequestPayload, WebhookResult } from './dto/github-push.dto';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @Inject(TOPOLOGY_STORAGE) private readonly storage: ITopologyStorageRepository,
    @Inject(TOPOLOGY_SERVICE) private readonly topology: ITopologyService,
    private readonly prBot: PrBotService,
  ) {}

  /**
   * Verifies the HMAC SHA-256 signature delivered in the `X-Hub-Signature-256` header.
   * Uses constant-time comparison via {@link timingSafeEqual}. Returns false when the
   * webhook secret is unset (fail-closed) so misconfigurations don't accept arbitrary requests.
   */
  verifyGitHubSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) return false;
    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;

    const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  /**
   * Resolves a GitHub push payload to a stored topology, then triggers a re-analysis.
   * Skips silently when:
   *  - no topology matches the repository (we don't auto-onboard via webhooks),
   *  - the push isn't on the default branch (avoid noisy feature-branch re-runs),
   *  - the head SHA equals the topology's current commitSha (idempotency).
   */
  async handleGitHubPush(payload: GitHubPushPayload): Promise<WebhookResult> {
    const repo = payload.repository;
    if (!repo) return { status: 'skipped', reason: 'missing repository' };

    // Default-branch filter — pushed ref looks like "refs/heads/<branch>"
    const branch = payload.ref?.replace(/^refs\/heads\//, '');
    if (repo.default_branch && branch && branch !== repo.default_branch) {
      return { status: 'skipped', reason: `not default branch (${branch})` };
    }

    const matched = await this.findTopologyForRepo(repo);
    if (!matched) {
      return { status: 'skipped', reason: 'no matching topology' };
    }

    const headSha = payload.after ?? payload.head_commit?.id;
    if (headSha && matched.commitSha === headSha) {
      return { status: 'skipped', topologyId: matched.id, reason: 'already at head sha' };
    }

    this.logger.log(`Re-analyzing "${matched.id}" triggered by push ${headSha ?? '(unknown sha)'}`);
    const result = await this.topology.reanalyze(matched.id);
    if (result.status === 'pending_merge_decisions') {
      return { status: 'pending_merge_decisions', topologyId: matched.id, sessionId: result.sessionId };
    }
    return { status: 'reanalyzed', topologyId: result.topologyId ?? matched.id };
  }

  /**
   * Finds a stored topology whose `source` references the GitHub repo from the payload.
   * Matches against:
   *   - source.kind === 'github' with matching owner/repo, OR
   *   - source.kind === 'git' whose `url` matches one of the repository clone/html/ssh URLs.
   */
  /**
   * Handle a GitHub `pull_request` event. Only `opened`, `reopened`, and `synchronize`
   * (head-branch updated) actions trigger analysis — closed/labeled/etc. are ignored.
   * Drafts are skipped to avoid noise on WIP branches.
   */
  async handleGitHubPullRequest(payload: GitHubPullRequestPayload): Promise<WebhookResult> {
    const action = payload.action;
    if (!action || !['opened', 'reopened', 'synchronize'].includes(action)) {
      return { status: 'skipped', reason: `pr action "${action}" not handled` };
    }
    const pr = payload.pull_request;
    if (!pr) return { status: 'skipped', reason: 'missing pull_request' };
    if (pr.draft) return { status: 'skipped', reason: 'draft PR' };

    const baseRepo = pr.base?.repo;
    if (!baseRepo) return { status: 'skipped', reason: 'missing base.repo' };

    const matched = await this.findTopologyForRepo(baseRepo);
    if (!matched) return { status: 'skipped', reason: 'no matching topology' };

    const headRef = pr.head?.ref;
    const headSha = pr.head?.sha;
    const headCloneUrl = pr.head?.repo?.clone_url;
    const prNumber = pr.number ?? payload.number;
    const baseOwner = baseRepo.owner?.login ?? baseRepo.owner?.name ?? baseRepo.full_name?.split('/')[0];
    const baseRepoName = baseRepo.name ?? baseRepo.full_name?.split('/')[1];

    if (!headRef || !headSha || !headCloneUrl || !prNumber || !baseOwner || !baseRepoName) {
      return { status: 'skipped', reason: 'incomplete pr metadata' };
    }

    this.logger.log(`Analyzing PR #${prNumber} on ${baseOwner}/${baseRepoName} (head ${headSha.slice(0, 7)})`);
    const result = await this.prBot.analyzeAndComment({
      topologyId: matched.id,
      prNumber,
      baseOwner,
      baseRepo: baseRepoName,
      headCloneUrl,
      headRef,
      headSha,
    });

    if (result.status === 'commented') {
      return { status: 'pr_commented', topologyId: matched.id, prNumber };
    }
    if (result.status === 'no_changes') {
      return { status: 'pr_no_changes', topologyId: matched.id, prNumber };
    }
    return { status: 'skipped', topologyId: matched.id, prNumber, reason: result.reason };
  }

  private async findTopologyForRepo(
    repo: NonNullable<GitHubPushPayload['repository']>,
  ): Promise<StoredTopology | null> {
    const [items] = await this.storage.findAll({ limit: 1000 });
    const ownerLogin = repo.owner?.login ?? repo.owner?.name ?? repo.full_name?.split('/')[0];
    const repoName = repo.name ?? repo.full_name?.split('/')[1];
    const candidateUrls = [repo.clone_url, repo.html_url, repo.ssh_url]
      .filter((u): u is string => typeof u === 'string' && u.length > 0)
      .map(normalizeGitUrl);

    for (const stored of items) {
      const src = stored.source;
      if (src.kind === 'github') {
        if (
          ownerLogin && repoName &&
          src.owner.toLowerCase() === ownerLogin.toLowerCase() &&
          src.repo.toLowerCase() === repoName.toLowerCase()
        ) {
          return stored;
        }
      } else if (src.kind === 'git') {
        if (candidateUrls.includes(normalizeGitUrl(src.url))) {
          return stored;
        }
      }
    }
    return null;
  }
}

/**
 * Normalize a git URL so http/https/ssh forms of the same repo collapse to one key.
 * Strips protocol, trailing `.git`, and trailing slashes; lowercases the host portion.
 */
function normalizeGitUrl(url: string): string {
  let s = url.trim();
  // git@github.com:owner/repo.git → github.com/owner/repo
  s = s.replace(/^git@([^:]+):/, '$1/');
  // strip protocol
  s = s.replace(/^[a-z]+:\/\//i, '');
  // strip .git suffix and trailing slashes
  s = s.replace(/\.git$/i, '').replace(/\/+$/, '');
  // lowercase host (everything up to first /)
  const slash = s.indexOf('/');
  if (slash > 0) {
    s = s.slice(0, slash).toLowerCase() + s.slice(slash);
  } else {
    s = s.toLowerCase();
  }
  return s;
}
