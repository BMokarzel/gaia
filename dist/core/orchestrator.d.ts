import type { SystemTopology } from '../types/topology';
export interface AnalysisOptions {
    /** Ignora arquivos de teste */
    skipTests?: boolean;
    /** Inclui análise de frontend */
    includeFrontend?: boolean;
    /** Callback de progresso */
    onProgress?: (message: string) => void;
}
/**
 * Pipeline principal de análise de um repositório.
 * Produz um SystemTopology completo a partir de um path de repositório.
 */
export declare function analyzeRepository(repoPath: string, options?: AnalysisOptions): Promise<SystemTopology>;
//# sourceMappingURL=orchestrator.d.ts.map