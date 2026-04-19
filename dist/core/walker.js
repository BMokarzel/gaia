"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.walkRepository = walkRepository;
exports.detectServiceBoundaries = detectServiceBoundaries;
const fs_1 = require("fs");
const path_1 = require("path");
const EXT_TO_LANGUAGE = {
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.jsx': 'jsx',
    '.java': 'java',
    '.kt': 'kotlin',
    '.kts': 'kotlin',
    '.py': 'python',
    '.swift': 'swift',
    '.go': 'go',
    '.rs': 'rust',
    '.cs': 'csharp',
    '.cpp': 'cpp',
    '.cxx': 'cpp',
    '.cc': 'cpp',
    '.c': 'c',
    '.h': 'c',
    '.hpp': 'cpp',
};
/** Diretórios a ignorar sempre */
const IGNORE_DIRS = new Set([
    'node_modules', '.git', '.svn', '.hg',
    'dist', 'build', 'out', 'target', 'bin', 'obj',
    '__pycache__', '.pytest_cache', '.mypy_cache',
    '.next', '.nuxt', '.output', '.cache',
    'coverage', '.nyc_output',
    'vendor', 'Pods',
    '.gradle', '.idea', '.vscode',
    'DerivedData', '.build',
]);
/** Arquivos a ignorar */
const IGNORE_FILES = new Set([
    '.d.ts', // TypeScript declarations
    '.min.js', // Minified
    '.bundle.js',
    '.test.ts', '.spec.ts', '.test.js', '.spec.js',
    '.test.py', '_test.go',
]);
/** Tamanho máximo de arquivo (5MB) */
const MAX_FILE_SIZE = 5 * 1024 * 1024;
/**
 * Percorre recursivamente um diretório e retorna todos os arquivos fonte
 */
function walkRepository(repoPath, options = {}) {
    const { skipTests = true, extensions, maxFileSize = MAX_FILE_SIZE, } = options;
    const files = [];
    const allowedExts = extensions
        ? new Set(extensions)
        : new Set(Object.keys(EXT_TO_LANGUAGE));
    function walk(dir) {
        let entries;
        try {
            entries = (0, fs_1.readdirSync)(dir);
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (entry.startsWith('.') && IGNORE_DIRS.has(entry))
                continue;
            if (IGNORE_DIRS.has(entry))
                continue;
            const fullPath = (0, path_1.join)(dir, entry);
            let stat;
            try {
                stat = (0, fs_1.statSync)(fullPath);
            }
            catch {
                continue;
            }
            if (stat.isDirectory()) {
                walk(fullPath);
                continue;
            }
            if (!stat.isFile())
                continue;
            if (stat.size > maxFileSize)
                continue;
            if (stat.size === 0)
                continue;
            const ext = (0, path_1.extname)(entry).toLowerCase();
            if (!allowedExts.has(ext))
                continue;
            // Ignora arquivos de declaração TypeScript
            if (entry.endsWith('.d.ts'))
                continue;
            // Ignora arquivos gerados/minificados
            if (entry.endsWith('.min.js') || entry.endsWith('.bundle.js'))
                continue;
            // Ignora testes se skipTests=true
            if (skipTests && isTestFile(entry, fullPath))
                continue;
            const language = EXT_TO_LANGUAGE[ext];
            if (!language)
                continue;
            let content;
            try {
                content = (0, fs_1.readFileSync)(fullPath, 'utf-8');
            }
            catch {
                continue;
            }
            files.push({
                absolutePath: fullPath,
                relativePath: (0, path_1.relative)(repoPath, fullPath).replace(/\\/g, '/'),
                extension: ext,
                language,
                content,
                sizeBytes: stat.size,
            });
        }
    }
    walk(repoPath);
    return files;
}
function isTestFile(filename, fullPath) {
    const lower = filename.toLowerCase();
    // Extensões de teste
    if (lower.includes('.test.') || lower.includes('.spec.'))
        return true;
    if (lower.endsWith('_test.go') || lower.endsWith('_test.py'))
        return true;
    if (lower.startsWith('test_'))
        return true;
    // Diretórios de teste
    const normalized = fullPath.replace(/\\/g, '/');
    if (normalized.includes('/test/') || normalized.includes('/tests/'))
        return true;
    if (normalized.includes('/spec/') || normalized.includes('/specs/'))
        return true;
    if (normalized.includes('/__tests__/'))
        return true;
    if (normalized.includes('/e2e/'))
        return true;
    return false;
}
const MANIFEST_FILES = [
    ['package.json', 'npm'],
    ['pom.xml', 'maven'],
    ['build.gradle', 'gradle'],
    ['build.gradle.kts', 'gradle'],
    ['pyproject.toml', 'python'],
    ['setup.py', 'python'],
    ['requirements.txt', 'python'],
    ['go.mod', 'go'],
    ['Cargo.toml', 'cargo'],
    ['Package.swift', 'swift'],
    ['*.csproj', 'dotnet'],
    ['*.fsproj', 'dotnet'],
];
function detectServiceBoundaries(repoPath) {
    const boundaries = [];
    const found = new Set();
    function walk(dir, depth) {
        if (depth > 6)
            return;
        let entries;
        try {
            entries = (0, fs_1.readdirSync)(dir);
        }
        catch {
            return;
        }
        // Ignora diretórios comuns
        const dirName = (0, path_1.basename)(dir);
        if (IGNORE_DIRS.has(dirName))
            return;
        for (const [manifest, type] of MANIFEST_FILES) {
            const isGlob = manifest.startsWith('*');
            const hasManifest = isGlob
                ? entries.some(e => e.endsWith(manifest.slice(1)))
                : entries.includes(manifest);
            if (hasManifest && !found.has(dir)) {
                found.add(dir);
                const manifestFile = isGlob
                    ? entries.find(e => e.endsWith(manifest.slice(1))) ?? manifest
                    : manifest;
                boundaries.push({
                    name: (0, path_1.basename)(dir),
                    rootPath: dir,
                    manifestFile,
                    manifestType: type,
                });
                break;
            }
        }
        for (const entry of entries) {
            if (IGNORE_DIRS.has(entry))
                continue;
            const full = (0, path_1.join)(dir, entry);
            try {
                if ((0, fs_1.statSync)(full).isDirectory()) {
                    walk(full, depth + 1);
                }
            }
            catch {
                continue;
            }
        }
    }
    walk(repoPath, 0);
    // Se não encontrou nenhum manifesto, trata o repo inteiro como um serviço
    if (boundaries.length === 0) {
        boundaries.push({
            name: (0, path_1.basename)(repoPath),
            rootPath: repoPath,
            manifestFile: '',
            manifestType: 'docker',
        });
    }
    return boundaries;
}
//# sourceMappingURL=walker.js.map