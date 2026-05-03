import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
import { WebhookService } from './webhook.service';
import type { GitHubPushPayload, GitHubPullRequestPayload, WebhookResult } from './dto/github-push.dto';

/**
 * Receives webhook deliveries from external sources (currently only GitHub push).
 *
 * The endpoint is mounted outside the topology resource because it isn't
 * authenticated via the same path; instead it verifies an HMAC signature on the raw body.
 */
@ApiTags('webhooks')
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly webhooks: WebhookService) {}

  @Post('github')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'GitHub push webhook',
    description:
      'Verifies X-Hub-Signature-256 (HMAC-SHA256, secret = GITHUB_WEBHOOK_SECRET) and triggers reanalyze ' +
      'for the matching topology. Returns 202 with the action taken.',
  })
  async github(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-event') event: string | undefined,
  ): Promise<WebhookResult> {
    const raw = req.rawBody;
    if (!raw) {
      throw new BadRequestException('Raw body unavailable — webhook signature cannot be verified');
    }
    if (!this.webhooks.verifyGitHubSignature(raw, signature)) {
      throw new UnauthorizedException('Invalid or missing signature');
    }

    // Acknowledge ping events without action (GitHub sends one when the hook is created)
    if (event === 'ping') {
      return { status: 'skipped', reason: 'ping event' };
    }

    if (event === 'push') {
      return this.webhooks.handleGitHubPush(req.body as GitHubPushPayload);
    }
    if (event === 'pull_request') {
      return this.webhooks.handleGitHubPullRequest(req.body as GitHubPullRequestPayload);
    }
    return { status: 'skipped', reason: `unsupported event: ${event ?? 'none'}` };
  }
}
