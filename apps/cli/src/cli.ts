#!/usr/bin/env node
import { Command } from 'commander';
import { resolve, isAbsolute } from 'path';
import { existsSync } from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import { analyzeRepository, writeTopology, buildSummary } from '@topology/core';

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
  .option('--verbose', 'Show detailed progress')
  .action(async (repoPathArg: string, options: {
    output?: string;
    pretty: boolean;
    includeRaw?: boolean;
    includeTests?: boolean;
    frontend: boolean;
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
      });

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
      spinner.fail(chalk.red(`Analysis failed: ${(err as Error).message}`));
      if (options.verbose) {
        console.error((err as Error).stack);
      }
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
