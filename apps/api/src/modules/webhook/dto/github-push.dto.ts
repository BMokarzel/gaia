/**
 * Minimal subset of the GitHub push payload we consume.
 * Reference: https://docs.github.com/en/webhooks/webhook-events-and-payloads#push
 */
export interface GitHubPushPayload {
  ref?: string;
  before?: string;
  after?: string;
  repository?: {
    name?: string;
    full_name?: string;
    clone_url?: string;
    html_url?: string;
    ssh_url?: string;
    default_branch?: string;
    owner?: { name?: string; login?: string };
  };
  head_commit?: { id?: string };
  pusher?: { name?: string };
}

export interface WebhookResult {
  /** 'reanalyzed' = triggered, 'skipped' = no matching topology / not default branch / same SHA */
  status: 'reanalyzed' | 'skipped' | 'pending_merge_decisions' | 'pr_commented' | 'pr_no_changes';
  topologyId?: string;
  reason?: string;
  sessionId?: string;
  /** PR number when the webhook handled a pull_request event */
  prNumber?: number;
}

/**
 * Subset of the GitHub `pull_request` event payload we consume.
 * Reference: https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request
 */
export interface GitHubPullRequestPayload {
  action?: string;
  number?: number;
  pull_request?: {
    number?: number;
    state?: string;
    draft?: boolean;
    head?: {
      ref?: string;
      sha?: string;
      repo?: {
        clone_url?: string;
        html_url?: string;
        ssh_url?: string;
        full_name?: string;
        owner?: { login?: string };
      };
    };
    base?: {
      ref?: string;
      sha?: string;
      repo?: {
        clone_url?: string;
        html_url?: string;
        ssh_url?: string;
        full_name?: string;
        default_branch?: string;
        name?: string;
        owner?: { login?: string; name?: string };
      };
    };
  };
  repository?: GitHubPushPayload['repository'];
}
