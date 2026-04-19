export interface SourceFile {
    absolutePath: string;
    relativePath: string;
    extension: string;
    language: SupportedLanguage;
    content: string;
    sizeBytes: number;
}
export type SupportedLanguage = 'typescript' | 'javascript' | 'tsx' | 'jsx' | 'java' | 'kotlin' | 'python' | 'swift' | 'go' | 'rust' | 'csharp' | 'cpp' | 'c';
export interface WalkOptions {
    /** Ignorar arquivos de teste */
    skipTests?: boolean;
    /** Extensões específicas para incluir (undefined = todas suportadas) */
    extensions?: string[];
    /** Tamanho máximo de arquivo em bytes */
    maxFileSize?: number;
}
/**
 * Percorre recursivamente um diretório e retorna todos os arquivos fonte
 */
export declare function walkRepository(repoPath: string, options?: WalkOptions): SourceFile[];
/**
 * Detecta sub-serviços dentro de um monorepo.
 * Um sub-serviço é qualquer diretório com package.json, pom.xml, build.gradle,
 * pyproject.toml, go.mod, Cargo.toml, Package.swift, Dockerfile
 */
export interface ServiceBoundary {
    name: string;
    rootPath: string;
    manifestFile: string;
    manifestType: 'npm' | 'maven' | 'gradle' | 'python' | 'go' | 'cargo' | 'swift' | 'docker' | 'dotnet';
}
export declare function detectServiceBoundaries(repoPath: string): ServiceBoundary[];
//# sourceMappingURL=walker.d.ts.map