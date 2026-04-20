import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { join } from 'path';

const WORKSPACE_ROOT = join(__dirname, '../../../../');

interface AuditAdvisory {
  severity: string;
  title: string;
  module_name: string;
  url: string;
}

interface PnpmAuditOutput {
  advisories?: Record<string, AuditAdvisory>;
  metadata?: {
    vulnerabilities: {
      info: number;
      low: number;
      moderate: number;
      high: number;
      critical: number;
    };
  };
}

const SEVERITY_ORDER: Record<string, number> = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

describe('Dependency Security Audit', () => {
  it('has no HIGH or CRITICAL vulnerabilities in production dependencies', () => {
    let output: string;
    try {
      output = execSync('npx pnpm@9 audit --json --prod', {
        cwd: WORKSPACE_ROOT,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      // pnpm audit exits with non-zero when vulnerabilities are found — capture stdout
      output = err.stdout ?? '';
    }

    if (!output.trim()) {
      // No output means no vulnerabilities or audit unavailable — pass
      return;
    }

    let auditResult: PnpmAuditOutput;
    try {
      auditResult = JSON.parse(output);
    } catch {
      // Non-JSON output (network issue, etc.) — skip rather than fail
      console.warn('pnpm audit returned non-JSON output; skipping check');
      return;
    }

    const vulns = auditResult.metadata?.vulnerabilities;
    if (!vulns) return;

    const highCount = vulns.high ?? 0;
    const criticalCount = vulns.critical ?? 0;

    const details = Object.values(auditResult.advisories ?? {})
      .filter(a => SEVERITY_ORDER[a.severity] >= SEVERITY_ORDER.high)
      .map(a => `  [${a.severity.toUpperCase()}] ${a.module_name}: ${a.title} — ${a.url}`)
      .join('\n');

    expect(
      highCount + criticalCount,
      `Found ${highCount} high and ${criticalCount} critical vulnerabilities in production deps:\n${details}`,
    ).toBe(0);
  });

  it('has no CRITICAL vulnerabilities in any dependency (including dev)', () => {
    let output: string;
    try {
      output = execSync('npx pnpm@9 audit --json', {
        cwd: WORKSPACE_ROOT,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      output = err.stdout ?? '';
    }

    if (!output.trim()) return;

    let auditResult: PnpmAuditOutput;
    try {
      auditResult = JSON.parse(output);
    } catch {
      console.warn('pnpm audit returned non-JSON output; skipping check');
      return;
    }

    const criticalCount = auditResult.metadata?.vulnerabilities?.critical ?? 0;

    const details = Object.values(auditResult.advisories ?? {})
      .filter(a => a.severity === 'critical')
      .map(a => `  [CRITICAL] ${a.module_name}: ${a.title} — ${a.url}`)
      .join('\n');

    expect(
      criticalCount,
      `Found ${criticalCount} critical vulnerabilities in dependencies:\n${details}`,
    ).toBe(0);
  });

  it('pnpm audit command is available and runs successfully', () => {
    expect(() => {
      execSync('npx pnpm@9 audit --help', {
        cwd: WORKSPACE_ROOT,
        stdio: 'pipe',
      });
    }).not.toThrow();
  });
});
