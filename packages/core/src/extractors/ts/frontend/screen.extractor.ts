import type { SyntaxNode } from '../../../utils/ast-helpers';
import {
  findAll, toLocation, fieldText, getDecorators, decoratorName,
  extractStringValue, getDecoratorsByName,
} from '../../../utils/ast-helpers';
import { nodeId } from '../../../utils/id';
import type { ScreenNode, ComponentNode, FrontendEventNode, FrontendAction, TypedField } from '../../../types/topology';

export interface FrontendExtractionResult {
  screens: ScreenNode[];
  components: ComponentNode[];
  /** Maps screenId → component names used in JSX (for cross-file linking) */
  screenComponentRefs: Map<string, string[]>;
}

/**
 * Extrai screens, components e eventos de frontend de um arquivo TypeScript/TSX.
 * Detecta: React pages/components, React Native screens, Vue components
 */
export function extractFrontendNodes(
  rootNode: SyntaxNode,
  filePath: string,
): FrontendExtractionResult {
  const screens: ScreenNode[] = [];
  const components: ComponentNode[] = [];
  const screenComponentRefs = new Map<string, string[]>();

  const isPage = isPageFile(filePath);
  const isScreen = isScreenFile(filePath);

  // React: function/const components com JSX
  const functions = findAll(rootNode, 'function_declaration');
  const arrows = findAll(rootNode, 'variable_declarator').filter(n => {
    const value = n.childForFieldName('value');
    return value?.type === 'arrow_function';
  });

  const allComponents = [...functions, ...arrows];

  for (const node of allComponents) {
    const name = (node.type === 'function_declaration'
      ? fieldText(node, 'name')
      : node.childForFieldName('name')?.text) ?? '';

    // Componentes React começam com letra maiúscula
    if (!name || !/^[A-Z]/.test(name)) continue;

    const fnBody = node.type === 'function_declaration'
      ? node.childForFieldName('body')
      : node.childForFieldName('value');

    if (!fnBody) continue;

    // Verifica se o componente retorna JSX
    const hasJSX = containsJSX(fnBody);
    if (!hasJSX) continue;

    const loc = toLocation(node, filePath);
    const exported = isExported(node);

    // Extrai hooks e estado
    const hooks = extractHooks(fnBody);
    const stateFields = extractLocalState(fnBody);
    const queries = extractComponentQueries(fnBody, filePath);

    // Fix 2: Mapa de handler → trigger inferido a partir dos atributos JSX
    const jsxTriggerMap = buildJSXTriggerMap(fnBody);

    // Extrai eventos (handlers) usando o mapa de triggers
    const events = extractFrontendEvents(fnBody, filePath, name, jsxTriggerMap);

    const component: ComponentNode = {
      id: nodeId('component', filePath, loc.line, name),
      type: 'component',
      name,
      metadata: {
        kind: detectComponentKind(name, filePath),
        filePath,
        exported,
        props: extractProps(node),
        state: {
          local: stateFields,
          store: detectStoreUsage(fnBody),
        },
        hooks: hooks.length > 0 ? hooks : undefined,
        queries: queries.length > 0 ? queries : undefined,
      },
      children: [],
      events,
    };

    components.push(component);

    // Se for uma página/screen, cria também um ScreenNode
    if (isPage || isScreen || isNavigationPage(name, filePath)) {
      const route = inferRoute(filePath, name);

      // Fix 5: quais componentes customizados são usados no JSX desta screen
      const usedComponents = extractUsedComponentNames(fnBody);

      const screen: ScreenNode = {
        id: nodeId('screen', filePath, loc.line, name),
        type: 'screen',
        name,
        metadata: {
          kind: isScreen ? 'page' : 'page',
          route,
          framework: detectFramework(rootNode, filePath),
          filePath,
          authRequired: detectAuthRequired(fnBody),
          guards: detectGuards(fnBody),
          layout: detectLayout(fnBody),
        },
        components: [component],
        navigatesTo: extractNavigationTargets(fnBody),
      };

      screens.push(screen);
      if (usedComponents.length > 0) {
        screenComponentRefs.set(screen.id, usedComponents);
      }
    }
  }

  return { screens, components, screenComponentRefs };
}

// ── Fix 5: usedComponentNames ─────────────────────────────────────────────────

function extractUsedComponentNames(body: SyntaxNode): string[] {
  const names = new Set<string>();
  const elements = [
    ...findAll(body, 'jsx_element'),
    ...findAll(body, 'jsx_self_closing_element'),
  ];
  for (const el of elements) {
    let tagName: string | undefined;
    if (el.type === 'jsx_element') {
      tagName = el.childForFieldName('open_tag')?.childForFieldName('name')?.text;
    } else {
      tagName = el.childForFieldName('name')?.text;
    }
    // Only custom components (uppercase first letter), not HTML tags
    if (tagName && /^[A-Z]/.test(tagName)) names.add(tagName);
  }
  return [...names];
}

// ── Fix 2: JSX trigger map ────────────────────────────────────────────────────

const JSX_ATTR_TO_TRIGGER: Record<string, FrontendEventNode['metadata']['trigger']> = {
  onClick: 'click',
  onPress: 'click',
  onSubmit: 'submit',
  onChange: 'change',
  onScroll: 'scroll',
  onFocus: 'focus',
  onBlur: 'blur',
  onMouseEnter: 'hover',
  onMouseLeave: 'hover',
  onMouseOver: 'hover',
  onKeyPress: 'keypress',
  onKeyDown: 'keypress',
  onKeyUp: 'keypress',
  onDragStart: 'drag',
  onDrop: 'drag',
  onTouchStart: 'swipe',
  onTouchEnd: 'swipe',
  onLongPress: 'longpress',
  onLoad: 'mount',
  onIntersection: 'intersection',
};

/**
 * Builds a map from handler function name → inferred trigger
 * by scanning JSX attributes in the component body.
 * e.g. onClick={handleSubmit} → Map { 'handleSubmit' → 'click' }
 */
function buildJSXTriggerMap(body: SyntaxNode): Map<string, FrontendEventNode['metadata']['trigger']> {
  const map = new Map<string, FrontendEventNode['metadata']['trigger']>();
  const attrs = findAll(body, 'jsx_attribute');

  for (const attr of attrs) {
    // tree-sitter: jsx_attribute_name is positional (no named field), use namedChildren[0]
    const attrName = attr.namedChildren[0]?.text ?? '';
    const trigger = JSX_ATTR_TO_TRIGGER[attrName];
    if (!trigger) continue;

    const handlerName = extractJSXHandlerRef(attr);
    if (handlerName && !map.has(handlerName)) {
      map.set(handlerName, trigger);
    }
  }

  return map;
}

function extractJSXHandlerRef(attr: SyntaxNode): string | null {
  // Value is a jsx_expression: {handleClick} or {() => handleClick(x)}
  const jsxExpr = attr.namedChildren.find(c => c.type === 'jsx_expression');
  if (!jsxExpr) return null;

  for (const child of jsxExpr.namedChildren) {
    if (child.type === 'identifier') return child.text;

    // () => handleFn() or () => handleFn(arg)
    if (child.type === 'arrow_function') {
      const arrowBody = child.childForFieldName('body');
      if (arrowBody) {
        const call = findAll(arrowBody, 'call_expression')[0];
        if (call) {
          const fn = call.childForFieldName('function');
          if (fn?.type === 'identifier') return fn.text;
          // this.handleFn → member_expression
          if (fn?.type === 'member_expression') {
            return fn.childForFieldName('property')?.text ?? null;
          }
        }
      }
    }
  }
  return null;
}

// ── Fix 4: URL template literal normalization ────────────────────────────────

/** Normalizes template literals and dynamic parts: ${x} → :param */
function normalizeUrl(url: string): string {
  return url
    .replace(/\$\{[^}]*\}/g, ':param')  // ${expr} → :param
    .replace(/\/\/+/g, '/');            // double slashes cleanup
}

// ── Existing helpers (with fixes) ─────────────────────────────────────────────

function containsJSX(node: SyntaxNode): boolean {
  return (
    findAll(node, 'jsx_element').length > 0 ||
    findAll(node, 'jsx_self_closing_element').length > 0 ||
    findAll(node, 'jsx_fragment').length > 0
  );
}

function extractHooks(body: SyntaxNode): string[] {
  const hooks = new Set<string>();
  const calls = findAll(body, 'call_expression');

  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;
    const name = fn.text;
    if (/^use[A-Z]/.test(name)) hooks.add(name);
  }

  return Array.from(hooks);
}

function extractLocalState(body: SyntaxNode): TypedField[] {
  const fields: TypedField[] = [];
  const calls = findAll(body, 'call_expression');

  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;

    if (fn.text !== 'useState' && fn.text !== 'useReducer') continue;

    const declarator = findParentDeclarator(call);
    if (!declarator) continue;

    const pattern = declarator.childForFieldName('name');
    if (!pattern) continue;

    if (pattern.type === 'array_pattern') {
      const firstElem = pattern.namedChildren[0];
      if (firstElem) {
        const typeArg = extractUseStateType(call);
        fields.push({
          name: firstElem.text,
          type: typeArg ?? 'unknown',
          required: true,
        });
      }
    }
  }

  return fields;
}

// Fix 3: useQuery with queryFn support — search all nested call_expressions
function extractComponentQueries(body: SyntaxNode, filePath: string) {
  const queries: ComponentNode['metadata']['queries'] = [];
  const calls = findAll(body, 'call_expression');

  const queryHooks = ['useQuery', 'useSWR', 'useInfiniteQuery', 'useMutation', 'useLazyQuery'];

  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;

    const hookName = fn.text.split('.').pop() ?? '';
    if (!queryHooks.includes(hookName)) continue;

    const args = call.childForFieldName('arguments');
    if (!args) continue;

    let url = '';
    let method = 'GET';

    // Strategy A: direct string URL as first positional arg (useSWR('/api/things'))
    const firstArg = args.namedChildren[0];
    if (firstArg) {
      const directUrl = extractStringValue(firstArg);
      if (directUrl && directUrl.includes('/')) {
        url = normalizeUrl(directUrl);
      }
    }

    // Strategy B: look inside all nested axios/fetch call_expressions
    // (covers queryFn: () => axios.get(`/api/...`))
    if (!url) {
      const nestedCalls = findAll(args, 'call_expression');
      for (const nested of nestedCalls) {
        const nestedFn = nested.childForFieldName('function');
        if (!nestedFn) continue;
        const fnText = nestedFn.text;

        const axiosMethodMatch = /axios\.(get|post|put|patch|delete)/i.exec(fnText);
        if (axiosMethodMatch) {
          method = axiosMethodMatch[1].toUpperCase();
          const nestedArgs = nested.childForFieldName('arguments');
          const urlArg = nestedArgs?.namedChildren[0];
          if (urlArg) {
            const raw = extractStringValue(urlArg) ?? urlArg.text.replace(/^`|`$/g, '');
            if (raw.includes('/')) { url = normalizeUrl(raw); break; }
          }
        }

        if (fnText === 'fetch') {
          const nestedArgs = nested.childForFieldName('arguments');
          const urlArg = nestedArgs?.namedChildren[0];
          if (urlArg) {
            const raw = extractStringValue(urlArg) ?? urlArg.text.replace(/^`|`$/g, '');
            if (raw.includes('/')) { url = normalizeUrl(raw); break; }
          }
        }
      }
    }

    // Strategy C: explicit method field in object arg
    const argsText = args.text;
    const methodMatch = argsText.match(/method\s*:\s*['"`]([A-Z]+)['"`]/);
    if (methodMatch) method = methodMatch[1];

    if (url) {
      queries.push({ hookOrMethod: hookName, method, path: url });
    }
  }

  return queries;
}

function extractFrontendEvents(
  body: SyntaxNode,
  filePath: string,
  componentName: string,
  jsxTriggerMap: Map<string, FrontendEventNode['metadata']['trigger']>,
): FrontendEventNode[] {
  const events: FrontendEventNode[] = [];

  // Detecta handlers: const handleClick = () => {}, function handleSubmit() {}
  const allVars = findAll(body, 'variable_declarator');

  for (const varNode of allVars) {
    const name = varNode.childForFieldName('name')?.text ?? '';
    if (!/^handle[A-Z]|^on[A-Z]/.test(name)) continue;

    const value = varNode.childForFieldName('value');
    if (!value) continue;

    const loc = toLocation(varNode, filePath);

    // Fix 2: use JSX-based trigger if found, else fall back to name inference
    const trigger = jsxTriggerMap.get(name) ?? inferEventTrigger(name);

    const actions = extractEventActions(value, filePath);

    events.push({
      id: nodeId('frontend_event', filePath, loc.line, `${componentName}.${name}`),
      type: 'frontend_event',
      name,
      metadata: { trigger, actions },
      location: loc,
    });
  }

  return events;
}

function extractEventActions(handlerBody: SyntaxNode, filePath: string): FrontendAction[] {
  const actions: FrontendAction[] = [];

  const calls = findAll(handlerBody, 'call_expression');

  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;
    const fnText = fn.text;

    // API calls: fetch, axios.get/post, api.get/post
    if (fnText === 'fetch' || /axios\.(get|post|put|patch|delete)/i.test(fnText)
        || /api\.(get|post|put|patch|delete)/i.test(fnText)) {
      const args = call.childForFieldName('arguments');
      const urlArg = args?.namedChildren[0];
      const rawUrl = urlArg ? (extractStringValue(urlArg) ?? urlArg.text) : '/api/unknown';
      // Fix 4: normalize template literals in URLs
      const url = normalizeUrl(rawUrl);
      const methodMatch = fnText.match(/\.(get|post|put|patch|delete)/i);
      const method = methodMatch ? methodMatch[1].toUpperCase() : 'GET';

      actions.push({ kind: 'api_call', endpointId: '', method, path: url });
      continue;
    }

    // Navigation: navigate('/path'), router.push('/path'), history.push
    if (fnText === 'navigate' || /router\.(push|replace|navigate)/i.test(fnText)
        || /navigation\.(navigate|push|replace)/i.test(fnText)) {
      const args = call.childForFieldName('arguments');
      const screenArg = args?.namedChildren[0];
      const rawScreen = screenArg ? (extractStringValue(screenArg) ?? screenArg.text) : 'unknown';
      // Fix 4: normalize template literals in navigation targets
      const screen = normalizeUrl(rawScreen);
      actions.push({ kind: 'navigate', targetScreenId: screen });
      continue;
    }

    // State updates: setState, dispatch, setXxx
    if (/^set[A-Z]/.test(fnText) || fnText === 'dispatch') {
      actions.push({ kind: 'state_update', field: fnText });
      continue;
    }

    // Analytics: analytics.track, posthog.capture, mixpanel.track
    if (/analytics|posthog|mixpanel|amplitude|segment/i.test(fnText)) {
      const args = call.childForFieldName('arguments');
      const eventArg = args?.namedChildren[0];
      const eventName = eventArg ? (extractStringValue(eventArg) ?? 'unknown') : 'unknown';
      actions.push({ kind: 'analytics', provider: fnText.split('.')[0], eventName });
      continue;
    }

    // Toast/modal side effects
    if (/toast|modal|alert|notification|snack/i.test(fnText)) {
      actions.push({ kind: 'side_effect', description: `${fnText}(...)` });
    }
  }

  return actions;
}

function extractProps(node: SyntaxNode): TypedField[] {
  const params = node.childForFieldName('parameters');
  if (!params) return [];

  const firstParam = params.namedChildren[0];
  if (!firstParam) return [];

  const typeAnnotation = firstParam.childForFieldName('type');
  if (!typeAnnotation) return [];

  // Extrai campos do tipo: { name: string; age: number }
  const fields: TypedField[] = [];
  const members = findAll(typeAnnotation, 'property_signature');

  for (const member of members) {
    const propName = member.childForFieldName('name')?.text ?? '';
    const propType = member.childForFieldName('type')?.text?.replace(/^:\s*/, '') ?? 'unknown';
    const optional = member.text.includes('?');
    fields.push({ name: propName, type: propType, required: !optional });
  }

  return fields;
}

function detectComponentKind(name: string, filePath: string): ComponentNode['metadata']['kind'] {
  if (/Form/i.test(name)) return 'form';
  if (/List|Table|Grid/i.test(name)) return 'list';
  if (/Modal|Dialog|Drawer/i.test(name)) return 'modal';
  if (/Button|Btn/i.test(name)) return 'button';
  if (/Chart|Graph|Plot/i.test(name)) return 'chart';
  if (/Nav|Menu|Sidebar|Header|Footer/i.test(name)) return 'navigation';
  if (/Input|Field|Select|Checkbox/i.test(name)) return 'input';
  if (/Layout|Wrapper/i.test(name)) return 'layout';
  if (filePath.includes('/pages/') || filePath.includes('/screens/')) return 'page_component';
  return 'widget';
}

function detectFramework(rootNode: SyntaxNode, filePath: string): ScreenNode['metadata']['framework'] {
  if (filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) return 'react';
  const imports = findAll(rootNode, 'import_declaration');
  for (const imp of imports) {
    const source = imp.childForFieldName('source')?.text ?? '';
    if (source.includes('react-native')) return 'react-native';
    if (source.includes('react')) return 'react';
    if (source.includes('vue')) return 'vue';
    if (source.includes('@angular')) return 'angular';
    if (source.includes('svelte')) return 'svelte';
  }
  return 'react';
}

function detectStoreUsage(body: SyntaxNode): string | undefined {
  const calls = findAll(body, 'call_expression');
  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;
    const text = fn.text;
    if (/useSelector|useStore/i.test(text)) return 'redux';
    if (/useAtom/i.test(text)) return 'jotai';
    if (/useRecoilState/i.test(text)) return 'recoil';
    if (/use.*Store$/i.test(text)) return 'zustand';
  }
  return undefined;
}

function detectAuthRequired(body: SyntaxNode): boolean {
  const text = body.text;
  return /useAuth|AuthGuard|PrivateRoute|RequireAuth|isAuthenticated|authCheck/i.test(text);
}

function detectGuards(body: SyntaxNode): string[] | undefined {
  const guards: string[] = [];
  const calls = findAll(body, 'call_expression');
  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;
    if (/Guard|Protect/i.test(fn.text)) guards.push(fn.text);
  }
  return guards.length > 0 ? guards : undefined;
}

function detectLayout(body: SyntaxNode): string | undefined {
  const jsxElements = findAll(body, 'jsx_element');
  for (const el of jsxElements) {
    const openTag = el.childForFieldName('open_tag');
    const tagName = openTag?.childForFieldName('name')?.text ?? '';
    if (/Layout|Template|Wrapper/i.test(tagName)) return tagName;
  }
  return undefined;
}

function extractNavigationTargets(body: SyntaxNode): string[] {
  const targets: string[] = [];
  const calls = findAll(body, 'call_expression');
  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;
    if (!/navigate|push|replace/i.test(fn.text)) continue;

    const args = call.childForFieldName('arguments');
    const firstArg = args?.namedChildren[0];
    if (firstArg) {
      const val = extractStringValue(firstArg) ?? firstArg.text;
      // Fix 4: normalize template literals
      targets.push(normalizeUrl(val));
    }
  }
  return [...new Set(targets)];
}

// Fix 1: lowercase + strip Page/Screen/View suffix from file-path-based route
function inferRoute(filePath: string, componentName: string): string {
  const match = filePath.match(/(?:pages|screens|views)\/(.+)\.[jt]sx?$/);
  if (match) {
    return '/' + match[1]
      .replace(/\[([^\]]+)\]/g, ':$1')      // Next.js [id] → :id
      .replace(/index$/, '')
      .replace(/\/$/, '')
      .toLowerCase()
      .replace(/(page|screen|view)$/, '');   // strip suffix (cartpage → cart)
  }
  return '/' + componentName.replace(/Page|Screen|View/g, '').toLowerCase();
}

function inferEventTrigger(name: string): FrontendEventNode['metadata']['trigger'] {
  if (/click|press/i.test(name)) return 'click';
  if (/submit/i.test(name)) return 'submit';
  if (/change/i.test(name)) return 'change';
  if (/scroll/i.test(name)) return 'scroll';
  if (/hover/i.test(name)) return 'hover';
  if (/focus/i.test(name)) return 'focus';
  if (/blur/i.test(name)) return 'blur';
  if (/mount/i.test(name)) return 'mount';
  if (/unmount/i.test(name)) return 'unmount';
  return 'custom';
}

function isPageFile(filePath: string): boolean {
  return /\/pages\/|\/views\/|\/routes\//i.test(filePath);
}

function isScreenFile(filePath: string): boolean {
  return /\/screens\/|\/screen\//i.test(filePath);
}

function isNavigationPage(name: string, filePath: string): boolean {
  return /Page|Screen|View$/i.test(name) || isPageFile(filePath) || isScreenFile(filePath);
}

function isExported(node: SyntaxNode): boolean {
  const parent = node.parent;
  if (!parent) return false;
  return parent.type === 'export_statement' ||
    (parent.parent?.type === 'export_statement');
}

function findParentDeclarator(node: SyntaxNode): SyntaxNode | null {
  let current = node.parent;
  while (current) {
    if (current.type === 'variable_declarator') return current;
    current = current.parent;
  }
  return null;
}

function extractUseStateType(call: SyntaxNode): string | null {
  // useState<Type>() → Type
  const typeArgs = call.childForFieldName('type_arguments');
  if (typeArgs) return typeArgs.text.replace(/[<>]/g, '');

  // Infere do valor inicial
  const args = call.childForFieldName('arguments');
  const firstArg = args?.namedChildren[0];
  if (!firstArg) return null;

  switch (firstArg.type) {
    case 'true':
    case 'false':
      return 'boolean';
    case 'number':
      return 'number';
    case 'string':
      return 'string';
    case 'null':
      return 'null';
    case 'array':
      return 'array';
    case 'object':
      return 'object';
    default:
      return null;
  }
}
