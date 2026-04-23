import Parser from 'tree-sitter';
import type { LanguageParser, ParseResult } from './base';
import { emptyResult } from './base';
import type { SourceFile } from '../core/walker';
import type { AnalysisContext } from '../types/topology';
import { extractSpringEndpoints } from '../extractors/java/endpoint/spring.extractor';
import { extractJPAOperations } from '../extractors/java/db/jpa.extractor';
import { extractJavaFunctions } from '../extractors/java/function.extractor';
import { extractJavaFlowControl } from '../extractors/java/flow.extractor';
import { extractJavaLogs } from '../extractors/java/log.extractor';
import { extractJavaCalls } from '../extractors/java/call.extractor';
import { extractJavaEvents } from '../extractors/java/event.extractor';
import { extractJavaHttpClients, extractFeignClients } from '../extractors/java/http-client.extractor';
import { extractJavaDataNodes } from '../extractors/java/data.extractor';
import { serviceId as computeServiceId } from '../utils/id';

interface FileCapabilities {
  hasSpringWeb: boolean;
  hasSpringAnnotation: boolean;
  hasJPA: boolean;
  hasHttpClient: boolean;
  hasLogging: boolean;
  hasMessaging: boolean;
}

function scanFileCapabilities(root: any): FileCapabilities {
  // Collect all import declaration texts — fast, shallow scan
  const imports: string[] = [];
  for (const child of root.namedChildren ?? []) {
    if (child.type === 'import_declaration') {
      imports.push(child.text ?? '');
    }
  }
  const src = imports.join('\n');

  return {
    hasSpringWeb: src.includes('springframework.web') || src.includes('springframework.web.bind'),
    hasSpringAnnotation: src.includes('springframework') || hasSpringAnnotationInSource(root),
    hasJPA: src.includes('jakarta.persistence') || src.includes('javax.persistence') || src.includes('springframework.data') || hasJPAInSource(root),
    hasHttpClient:
      src.includes('RestTemplate') || src.includes('WebClient') || src.includes('RestClient') ||
      src.includes('java.net.http') || src.includes('openfeign') || src.includes('HttpClient'),
    hasLogging:
      src.includes('slf4j') || src.includes('log4j') || src.includes('java.util.logging') ||
      src.includes('org.apache.logging'),
    hasMessaging:
      src.includes('kafka') || src.includes('rabbitmq') || src.includes('amqp') ||
      src.includes('spring.jms') || src.includes('amazonaws.sqs'),
  };
}

function hasSpringAnnotationInSource(root: any): boolean {
  // Quick check: does the file text contain common Spring class annotations?
  const text = root.text ?? '';
  return /@(RestController|Controller|Service|Repository|Component|SpringBootApplication|Configuration|Bean)\b/.test(text);
}

function hasJPAInSource(root: any): boolean {
  // Catches fully qualified JpaRepository/CrudRepository usages (no import needed)
  const text = root.text ?? '';
  return /\b(JpaRepository|CrudRepository|PagingAndSortingRepository|JpaSpecificationExecutor)\b/.test(text) ||
    /\b@(Entity|Table|Column|Id|GeneratedValue|MappedSuperclass|OneToMany|ManyToOne|ManyToMany|OneToOne)\b/.test(text);
}

function loadLanguage(name: string): unknown {
  try {
    const mod = require(name);
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

export class JavaParser implements LanguageParser {
  readonly supportedExtensions = ['.java'];

  private parser: Parser | null = null;
  private lang: unknown = null;

  private init(): Parser | null {
    if (this.parser) return this.parser;
    this.lang = loadLanguage('tree-sitter-java');
    if (!this.lang) return null;
    this.parser = new Parser();
    return this.parser;
  }

  supports(file: SourceFile): boolean {
    return file.extension === '.java';
  }

  parse(file: SourceFile, context: AnalysisContext): ParseResult {
    const parser = this.init();
    if (!parser || !this.lang) return emptyResult();

    try {
      parser.setLanguage(this.lang as any);
      const tree = parser.parse(file.content);
      const root = tree.rootNode;
      const path = file.relativePath;
      const serviceId = computeServiceId(context.repoPath);

      // Pass 0: fast import scan — O(imports), determines which extractors to run
      const caps = scanFileCapabilities(root);

      const codeNodes: any[] = [];
      const databases: any[] = [];
      const brokers: any[] = [];

      // Spring endpoints (only if Spring Web annotations present)
      if (caps.hasSpringWeb || caps.hasSpringAnnotation) {
        const springResult = extractSpringEndpoints(root as any, path);
        codeNodes.push(...springResult.endpoints, ...springResult.functions);
      }

      // JPA / database operations
      if (caps.hasJPA) {
        const jpaResult = extractJPAOperations(root as any, path);
        codeNodes.push(...jpaResult.dbNodes);
        if (jpaResult.database.tables.length > 0) {
          databases.push(jpaResult.database);
        }
      }

      // HTTP client calls (ExternalCallNodes) — extractJavaHttpClients includes Feign detection
      if (caps.hasHttpClient || caps.hasSpringAnnotation) {
        codeNodes.push(...extractJavaHttpClients(root as any, path));
      } else {
        // Always run Feign detection even without explicit HTTP client imports
        codeNodes.push(...extractFeignClients(root as any, path));
      }

      // Core extractors — always run
      codeNodes.push(...extractJavaFunctions(root as any, path));
      codeNodes.push(...extractJavaDataNodes(root as any, path));
      codeNodes.push(...extractJavaFlowControl(root as any, path));
      codeNodes.push(...extractJavaCalls(root as any, path));

      // Logging (only if SLF4J/Log4j/JUL present)
      if (caps.hasLogging) {
        codeNodes.push(...extractJavaLogs(root as any, path));
      }

      // Events / messaging
      if (caps.hasMessaging) {
        const eventResult = extractJavaEvents(root as any, path, serviceId);
        codeNodes.push(...eventResult.eventNodes);
        brokers.push(...eventResult.brokers);
      }

      return { codeNodes, databases, brokers };
    } catch (err) {
      context.diagnostics.push({
        level: 'error',
        message: `Java parser error in ${file.relativePath}: ${(err as Error).message}`,
        location: { file: file.relativePath, line: 1, column: 0 },
      });
      return emptyResult();
    }
  }
}
