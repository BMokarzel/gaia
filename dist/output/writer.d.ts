import type { SystemTopology } from '../types/topology';
export interface WriteOptions {
    /** Caminho do arquivo de saída. Default: <repoPath>/topology.json */
    outputPath?: string;
    /** Indenta o JSON para leitura humana */
    pretty?: boolean;
    /** Inclui o campo 'raw' dos nós (pode tornar o arquivo muito grande) */
    includeRaw?: boolean;
}
/**
 * Serializa e escreve o SystemTopology em um arquivo JSON.
 */
export declare function writeTopology(topology: SystemTopology, repoPath: string, options?: WriteOptions): string;
/**
 * Gera um resumo das estatísticas da topologia para exibição no terminal.
 */
export declare function buildSummary(topology: SystemTopology): string;
//# sourceMappingURL=writer.d.ts.map