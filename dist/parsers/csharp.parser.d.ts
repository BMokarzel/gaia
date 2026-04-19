import type { LanguageParser, ParseResult } from './base';
import type { SourceFile } from '../core/walker';
import type { AnalysisContext } from '../types/topology';
export declare class CSharpParser implements LanguageParser {
    readonly supportedExtensions: string[];
    private parser;
    private lang;
    private init;
    supports(file: SourceFile): boolean;
    parse(file: SourceFile, context: AnalysisContext): ParseResult;
}
//# sourceMappingURL=csharp.parser.d.ts.map