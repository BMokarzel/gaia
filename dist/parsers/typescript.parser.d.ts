import type { LanguageParser, ParseResult } from './base';
import type { SourceFile } from '../core/walker';
import type { AnalysisContext } from '../types/topology';
export declare class TypeScriptParser implements LanguageParser {
    readonly supportedExtensions: string[];
    private parser;
    private tsLang;
    private tsxLang;
    private jsLang;
    private initParser;
    supports(file: SourceFile): boolean;
    parse(file: SourceFile, context: AnalysisContext): ParseResult;
}
//# sourceMappingURL=typescript.parser.d.ts.map