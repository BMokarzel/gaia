#!/usr/bin/env node
import { Command } from 'commander';
import { resolve, isAbsolute } from 'path';
import { existsSync } from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import { analyzeRepository, writeTopology, buildSummary, enrichService } from '@topology/core';
import {
  createLogger, FileTransport, ConsoleTransport, CompositeTransport,
} from '@topology/core';

const program = new Command();

program
  .name('tree-cli')
  .description('AST-based code topology extractor — generates SystemTopology JSON from source code')
  .version('0.1.0');

program
  .command('analyze <repo-path>')
  .description('Analyze a repository and generate topology.json')
  .option('-o, --output <path>', 'Output file path (default: <repo>/topology.json)')
  .option('--no-pretty', 'Minify JSON output')
  .option('--include-raw', 'Include raw AST text in output (larger file)')
  .option('--include-tests', 'Include test files in analysis')
  .option('--no-frontend', 'Skip frontend file analysis')
  .option('--enrich', 'Enrich topology with LLM descriptions (requires ANTHROPIC_API_KEY)')
  .option('--verbose', 'Show detailed progress')
  .action(async (repoPathArg: string, options: {
    output?: string;
    pretty: boolean;
    includeRaw?: boolean;
    includeTests?: boolean;
    frontend: boolean;
    enrich?: boolean;
    verbose?: boolean;
  }) => {
    const repoPath = isAbsolute(repoPathArg)
      ? repoPathArg
      : resolve(process.cwd(), repoPathArg);

    if (!existsSync(repoPath)) {
      console.error(chalk.red(`Error: path not found: ${repoPath}`));
      process.exit(1);
    }

    const spinner = ora({ text: 'Starting analysis...', color: 'cyan' }).start();

    const logDir = resolve(repoPath, 'logs');
    const logger = createLogger('cli', [
      new CompositeTransport([
        new ConsoleTransport({ level: options.verbose ? 'debug' : 'warn', colorize: true }),
        new FileTransport({ dir: logDir, component: 'cli', projectRoot: repoPath }),
      ]),
    ]);

    const onProgress = (msg: string) => {
      spinner.text = msg;
      if (options.verbose) {
        spinner.stopAndPersist({ symbol: chalk.gray('›'), text: chalk.gray(msg) });
        spinner.start();
      }
    };

    try {
      const topology = await analyzeRepository(repoPath, {
        skipTests: !options.includeTests,
        includeFrontend: options.frontend,
        onProgress,
        logger,
      });

      if (options.enrich) {
        spinner.text = 'Enriching with LLM...';
        for (const service of topology.services) {
          await enrichService(service, topology.databases, {
            onProgress: (msg) => { spinner.text = msg; },
          });
        }
      }

      spinner.text = 'Writing output...';

      const outputPath = writeTopology(topology, repoPath, {
        outputPath: options.output,
        pretty: options.pretty,
        includeRaw: options.includeRaw,
      });

      spinner.succeed(chalk.green(`Topology written to: ${outputPath}`));
      console.log('');
      console.log(chalk.bold('── Summary ─────────────────────────────────'));
      console.log(buildSummary(topology));
      console.log(chalk.bold('────────────────────────────────────────────'));

      const errorDiags = topology.diagnostics.filter(d => d.level === 'error');
      const warnDiags = topology.diagnostics.filter(d => d.level === 'warning');

      if (errorDiags.length > 0) {
        console.log('');
        console.log(chalk.red(`${errorDiags.length} error(s):`));
        for (const d of errorDiags.slice(0, 10)) {
          console.log(chalk.red(`  ✗ ${d.message}`));
        }
        if (errorDiags.length > 10) {
          console.log(chalk.red(`  ... and ${errorDiags.length - 10} more`));
        }
      }

      if (warnDiags.length > 0 && options.verbose) {
        console.log('');
        console.log(chalk.yellow(`${warnDiags.length} warning(s):`));
        for (const d of warnDiags.slice(0, 5)) {
          console.log(chalk.yellow(`  ⚠ ${d.message}`));
        }
      }
    } catch (err) {
      const error = err as Error;
      logger.error('Analysis failed', error);
      spinner.fail(chalk.red(`Analysis failed: ${error.message}`));
      if (options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

program
  .command('enrich <topology-path>')
  .description('Enrich an existing topology.json with LLM descriptions (requires ANTHROPIC_API_KEY)')
  .option('--no-pretty', 'Minify JSON output')
  .option('--dry-run', 'Show what would be enriched without calling the API')
  .action(async (topologyPathArg: string, options: { pretty: boolean; dryRun?: boolean }) => {
    const topologyPath = isAbsolute(topologyPathArg)
      ? topologyPathArg
      : resolve(process.cwd(), topologyPathArg);

    if (!existsSync(topologyPath)) {
      console.error(chalk.red(`File not found: ${topologyPath}`));
      process.exit(1);
    }

    const raw = JSON.parse(require('fs').readFileSync(topologyPath, 'utf-8'));
    // Support both raw SystemTopology and StoredTopology (wrapped)
    const topology = raw.topology ?? raw;
    const spinner = ora({ text: 'Starting enrichment...', color: 'cyan' }).start();

    try {
      for (const service of topology.services) {
        await enrichService(service, topology.databases, {
          dryRun: options.dryRun,
          onProgress: (msg) => { spinner.text = msg; },
        });
      }

      if (!options.dryRun) {
        require('fs').writeFileSync(
          topologyPath,
          JSON.stringify(raw, null, options.pretty ? 2 : 0),
          'utf-8',
        );
        spinner.succeed(chalk.green(`Enriched topology written to: ${topologyPath}`));
      } else {
        spinner.succeed(chalk.yellow('Dry run complete — no files written'));
      }
    } catch (err) {
      spinner.fail(chalk.red(`Enrichment failed: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program
  .command('inspect <topology-path>')
  .description('Print a summary of an existing topology.json')
  .action((topologyPath: string) => {
    const resolved = isAbsolute(topologyPath)
      ? topologyPath
      : resolve(process.cwd(), topologyPath);

    if (!existsSync(resolved)) {
      console.error(chalk.red(`File not found: ${resolved}`));
      process.exit(1);
    }

    try {
      const topology = JSON.parse(require('fs').readFileSync(resolved, 'utf-8'));
      console.log(chalk.bold('── Topology Summary ─────────────────────────'));
      console.log(buildSummary(topology));
      console.log(chalk.bold('─────────────────────────────────────────────'));
    } catch (err) {
      console.error(chalk.red(`Failed to read topology: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program.parse(process.argv);
