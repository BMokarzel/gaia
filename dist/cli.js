#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const path_1 = require("path");
const fs_1 = require("fs");
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const orchestrator_1 = require("./core/orchestrator");
const writer_1 = require("./output/writer");
const program = new commander_1.Command();
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
    .action(async (repoPathArg, options) => {
    const repoPath = (0, path_1.isAbsolute)(repoPathArg)
        ? repoPathArg
        : (0, path_1.resolve)(process.cwd(), repoPathArg);
    if (!(0, fs_1.existsSync)(repoPath)) {
        console.error(chalk_1.default.red(`Error: path not found: ${repoPath}`));
        process.exit(1);
    }
    const spinner = (0, ora_1.default)({ text: 'Starting analysis...', color: 'cyan' }).start();
    const onProgress = (msg) => {
        spinner.text = msg;
        if (options.verbose) {
            spinner.stopAndPersist({ symbol: chalk_1.default.gray('›'), text: chalk_1.default.gray(msg) });
            spinner.start();
        }
    };
    try {
        const topology = await (0, orchestrator_1.analyzeRepository)(repoPath, {
            skipTests: !options.includeTests,
            includeFrontend: options.frontend,
            onProgress,
        });
        spinner.text = 'Writing output...';
        const outputPath = (0, writer_1.writeTopology)(topology, repoPath, {
            outputPath: options.output,
            pretty: options.pretty,
            includeRaw: options.includeRaw,
        });
        spinner.succeed(chalk_1.default.green(`Topology written to: ${outputPath}`));
        console.log('');
        console.log(chalk_1.default.bold('── Summary ─────────────────────────────────'));
        console.log((0, writer_1.buildSummary)(topology));
        console.log(chalk_1.default.bold('────────────────────────────────────────────'));
        const errorDiags = topology.diagnostics.filter(d => d.level === 'error');
        const warnDiags = topology.diagnostics.filter(d => d.level === 'warning');
        if (errorDiags.length > 0) {
            console.log('');
            console.log(chalk_1.default.red(`${errorDiags.length} error(s):`));
            for (const d of errorDiags.slice(0, 10)) {
                console.log(chalk_1.default.red(`  ✗ ${d.message}`));
            }
            if (errorDiags.length > 10) {
                console.log(chalk_1.default.red(`  ... and ${errorDiags.length - 10} more`));
            }
        }
        if (warnDiags.length > 0 && options.verbose) {
            console.log('');
            console.log(chalk_1.default.yellow(`${warnDiags.length} warning(s):`));
            for (const d of warnDiags.slice(0, 5)) {
                console.log(chalk_1.default.yellow(`  ⚠ ${d.message}`));
            }
        }
    }
    catch (err) {
        spinner.fail(chalk_1.default.red(`Analysis failed: ${err.message}`));
        if (options.verbose) {
            console.error(err.stack);
        }
        process.exit(1);
    }
});
program
    .command('inspect <topology-path>')
    .description('Print a summary of an existing topology.json')
    .action((topologyPath) => {
    const resolved = (0, path_1.isAbsolute)(topologyPath)
        ? topologyPath
        : (0, path_1.resolve)(process.cwd(), topologyPath);
    if (!(0, fs_1.existsSync)(resolved)) {
        console.error(chalk_1.default.red(`File not found: ${resolved}`));
        process.exit(1);
    }
    try {
        const topology = JSON.parse(require('fs').readFileSync(resolved, 'utf-8'));
        console.log(chalk_1.default.bold('── Topology Summary ─────────────────────────'));
        console.log((0, writer_1.buildSummary)(topology));
        console.log(chalk_1.default.bold('─────────────────────────────────────────────'));
    }
    catch (err) {
        console.error(chalk_1.default.red(`Failed to read topology: ${err.message}`));
        process.exit(1);
    }
});
program.parse(process.argv);
//# sourceMappingURL=cli.js.map