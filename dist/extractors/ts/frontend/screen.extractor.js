"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractFrontendNodes = extractFrontendNodes;
const ast_helpers_1 = require("../../../utils/ast-helpers");
const id_1 = require("../../../utils/id");
/**
 * Extrai screens, components e eventos de frontend de um arquivo TypeScript/TSX.
 * Detecta: React pages/components, React Native screens, Vue components
 */
function extractFrontendNodes(rootNode, filePath) {
    const screens = [];
    const components = [];
    const isPage = isPageFile(filePath);
    const isScreen = isScreenFile(filePath);
    // React: function/const components com JSX
    const functions = (0, ast_helpers_1.findAll)(rootNode, 'function_declaration');
    const arrows = (0, ast_helpers_1.findAll)(rootNode, 'variable_declarator').filter(n => {
        const value = n.childForFieldName('value');
        return value?.type === 'arrow_function';
    });
    const allComponents = [...functions, ...arrows];
    for (const node of allComponents) {
        const name = (node.type === 'function_declaration'
            ? (0, ast_helpers_1.fieldText)(node, 'name')
            : node.childForFieldName('name')?.text) ?? '';
        // Componentes React começam com letra maiúscula
        if (!name || !/^[A-Z]/.test(name))
            continue;
        const fnBody = node.type === 'function_declaration'
            ? node.childForFieldName('body')
            : node.childForFieldName('value');
        if (!fnBody)
            continue;
        // Verifica se o componente retorna JSX
        const hasJSX = containsJSX(fnBody);
        if (!hasJSX)
            continue;
        const loc = (0, ast_helpers_1.toLocation)(node, filePath);
        const exported = isExported(node);
        // Extrai hooks e estado
        const hooks = extractHooks(fnBody);
        const stateFields = extractLocalState(fnBody);
        const queries = extractComponentQueries(fnBody, filePath);
        // Extrai eventos (handlers)
        const events = extractFrontendEvents(fnBody, filePath, name);
        const component = {
            id: (0, id_1.nodeId)('component', filePath, loc.line, name),
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
            screens.push({
                id: (0, id_1.nodeId)('screen', filePath, loc.line, name),
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
            });
        }
    }
    return { screens, components };
}
function containsJSX(node) {
    return ((0, ast_helpers_1.findAll)(node, 'jsx_element').length > 0 ||
        (0, ast_helpers_1.findAll)(node, 'jsx_self_closing_element').length > 0 ||
        (0, ast_helpers_1.findAll)(node, 'jsx_fragment').length > 0);
}
function extractHooks(body) {
    const hooks = new Set();
    const calls = (0, ast_helpers_1.findAll)(body, 'call_expression');
    for (const call of calls) {
        const fn = call.childForFieldName('function');
        if (!fn)
            continue;
        const name = fn.text;
        if (/^use[A-Z]/.test(name))
            hooks.add(name);
    }
    return Array.from(hooks);
}
function extractLocalState(body) {
    const fields = [];
    const calls = (0, ast_helpers_1.findAll)(body, 'call_expression');
    for (const call of calls) {
        const fn = call.childForFieldName('function');
        if (!fn)
            continue;
        if (fn.text !== 'useState' && fn.text !== 'useReducer')
            continue;
        const parent = call.parent;
        if (!parent)
            continue;
        // const [value, setValue] = useState(...)
        const declarator = findParentDeclarator(call);
        if (!declarator)
            continue;
        const pattern = declarator.childForFieldName('name');
        if (!pattern)
            continue;
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
function extractComponentQueries(body, filePath) {
    const queries = [];
    const calls = (0, ast_helpers_1.findAll)(body, 'call_expression');
    const queryHooks = ['useQuery', 'useSWR', 'useInfiniteQuery', 'useMutation', 'useLazyQuery'];
    for (const call of calls) {
        const fn = call.childForFieldName('function');
        if (!fn)
            continue;
        const hookName = fn.text.split('.').pop() ?? '';
        if (!queryHooks.includes(hookName))
            continue;
        const args = call.childForFieldName('arguments');
        if (!args)
            continue;
        // Extrai URL do call (segundo argumento geralmente é uma função fetch)
        const argsText = args.text;
        const urlMatch = argsText.match(/['"`]([^'"`]*\/[^'"`]*)['"`]/);
        const url = urlMatch ? urlMatch[1] : '';
        const methodMatch = argsText.match(/method\s*:\s*['"`]([A-Z]+)['"`]/);
        const method = methodMatch ? methodMatch[1] : 'GET';
        if (url) {
            queries.push({
                hookOrMethod: hookName,
                method,
                path: url,
            });
        }
    }
    return queries;
}
function extractFrontendEvents(body, filePath, componentName) {
    const events = [];
    // Detecta handlers: const handleClick = () => {}, function handleSubmit() {}
    const allVars = (0, ast_helpers_1.findAll)(body, 'variable_declarator');
    for (const varNode of allVars) {
        const name = varNode.childForFieldName('name')?.text ?? '';
        if (!/^handle[A-Z]|^on[A-Z]/.test(name))
            continue;
        const value = varNode.childForFieldName('value');
        if (!value)
            continue;
        const loc = (0, ast_helpers_1.toLocation)(varNode, filePath);
        const trigger = inferEventTrigger(name);
        const actions = extractEventActions(value, filePath);
        events.push({
            id: (0, id_1.nodeId)('frontend_event', filePath, loc.line, `${componentName}.${name}`),
            type: 'frontend_event',
            name,
            metadata: { trigger, actions },
            location: loc,
        });
    }
    return events;
}
function extractEventActions(handlerBody, filePath) {
    const actions = [];
    const calls = (0, ast_helpers_1.findAll)(handlerBody, 'call_expression');
    for (const call of calls) {
        const fn = call.childForFieldName('function');
        if (!fn)
            continue;
        const fnText = fn.text;
        // API calls: fetch, axios.get/post, api.get/post
        if (fnText === 'fetch' || /axios\.(get|post|put|patch|delete)/i.test(fnText)
            || /api\.(get|post|put|patch|delete)/i.test(fnText)) {
            const args = call.childForFieldName('arguments');
            const urlArg = args?.namedChildren[0];
            const url = urlArg ? ((0, ast_helpers_1.extractStringValue)(urlArg) ?? urlArg.text) : '/api/unknown';
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
            const screen = screenArg ? ((0, ast_helpers_1.extractStringValue)(screenArg) ?? screenArg.text) : 'unknown';
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
            const eventName = eventArg ? ((0, ast_helpers_1.extractStringValue)(eventArg) ?? 'unknown') : 'unknown';
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
function extractProps(node) {
    const params = node.childForFieldName('parameters');
    if (!params)
        return [];
    const firstParam = params.namedChildren[0];
    if (!firstParam)
        return [];
    const typeAnnotation = firstParam.childForFieldName('type');
    if (!typeAnnotation)
        return [];
    // Extrai campos do tipo: { name: string; age: number }
    const fields = [];
    const members = (0, ast_helpers_1.findAll)(typeAnnotation, 'property_signature');
    for (const member of members) {
        const propName = member.childForFieldName('name')?.text ?? '';
        const propType = member.childForFieldName('type')?.text?.replace(/^:\s*/, '') ?? 'unknown';
        const optional = member.text.includes('?');
        fields.push({ name: propName, type: propType, required: !optional });
    }
    return fields;
}
function detectComponentKind(name, filePath) {
    if (/Form/i.test(name))
        return 'form';
    if (/List|Table|Grid/i.test(name))
        return 'list';
    if (/Modal|Dialog|Drawer/i.test(name))
        return 'modal';
    if (/Button|Btn/i.test(name))
        return 'button';
    if (/Chart|Graph|Plot/i.test(name))
        return 'chart';
    if (/Nav|Menu|Sidebar|Header|Footer/i.test(name))
        return 'navigation';
    if (/Input|Field|Select|Checkbox/i.test(name))
        return 'input';
    if (/Layout|Wrapper/i.test(name))
        return 'layout';
    if (filePath.includes('/pages/') || filePath.includes('/screens/'))
        return 'page_component';
    return 'widget';
}
function detectFramework(rootNode, filePath) {
    if (filePath.endsWith('.tsx') || filePath.endsWith('.jsx'))
        return 'react';
    const imports = (0, ast_helpers_1.findAll)(rootNode, 'import_declaration');
    for (const imp of imports) {
        const source = imp.childForFieldName('source')?.text ?? '';
        if (source.includes('react-native'))
            return 'react-native';
        if (source.includes('react'))
            return 'react';
        if (source.includes('vue'))
            return 'vue';
        if (source.includes('@angular'))
            return 'angular';
        if (source.includes('svelte'))
            return 'svelte';
    }
    return 'react';
}
function detectStoreUsage(body) {
    const calls = (0, ast_helpers_1.findAll)(body, 'call_expression');
    for (const call of calls) {
        const fn = call.childForFieldName('function');
        if (!fn)
            continue;
        const text = fn.text;
        if (/useSelector|useStore/i.test(text))
            return 'redux';
        if (/useAtom/i.test(text))
            return 'jotai';
        if (/useRecoilState/i.test(text))
            return 'recoil';
        if (/use.*Store$/i.test(text))
            return 'zustand';
    }
    return undefined;
}
function detectAuthRequired(body) {
    const text = body.text;
    return /useAuth|AuthGuard|PrivateRoute|RequireAuth|isAuthenticated|authCheck/i.test(text);
}
function detectGuards(body) {
    const guards = [];
    const calls = (0, ast_helpers_1.findAll)(body, 'call_expression');
    for (const call of calls) {
        const fn = call.childForFieldName('function');
        if (!fn)
            continue;
        if (/Guard|Protect/i.test(fn.text))
            guards.push(fn.text);
    }
    return guards.length > 0 ? guards : undefined;
}
function detectLayout(body) {
    const jsxElements = (0, ast_helpers_1.findAll)(body, 'jsx_element');
    for (const el of jsxElements) {
        const openTag = el.childForFieldName('open_tag');
        const tagName = openTag?.childForFieldName('name')?.text ?? '';
        if (/Layout|Template|Wrapper/i.test(tagName))
            return tagName;
    }
    return undefined;
}
function extractNavigationTargets(body) {
    const targets = [];
    const calls = (0, ast_helpers_1.findAll)(body, 'call_expression');
    for (const call of calls) {
        const fn = call.childForFieldName('function');
        if (!fn)
            continue;
        if (!/navigate|push|replace/i.test(fn.text))
            continue;
        const args = call.childForFieldName('arguments');
        const firstArg = args?.namedChildren[0];
        if (firstArg) {
            const val = (0, ast_helpers_1.extractStringValue)(firstArg);
            if (val)
                targets.push(val);
        }
    }
    return [...new Set(targets)];
}
function inferRoute(filePath, componentName) {
    // /pages/users/[id].tsx → /users/:id
    // /screens/Profile.tsx → /profile
    const match = filePath.match(/(?:pages|screens|views)\/(.+)\.[jt]sx?$/);
    if (match) {
        return '/' + match[1]
            .replace(/\[([^\]]+)\]/g, ':$1')
            .replace(/index$/, '')
            .replace(/\/$/, '');
    }
    return '/' + componentName.replace(/Page|Screen|View/, '').toLowerCase();
}
function inferEventTrigger(name) {
    if (/click|press/i.test(name))
        return 'click';
    if (/submit/i.test(name))
        return 'submit';
    if (/change/i.test(name))
        return 'change';
    if (/scroll/i.test(name))
        return 'scroll';
    if (/hover/i.test(name))
        return 'hover';
    if (/focus/i.test(name))
        return 'focus';
    if (/blur/i.test(name))
        return 'blur';
    if (/mount/i.test(name))
        return 'mount';
    if (/unmount/i.test(name))
        return 'unmount';
    return 'custom';
}
function isPageFile(filePath) {
    return /\/pages\/|\/views\/|\/routes\//i.test(filePath);
}
function isScreenFile(filePath) {
    return /\/screens\/|\/screen\//i.test(filePath);
}
function isNavigationPage(name, filePath) {
    return /Page|Screen|View$/i.test(name) || isPageFile(filePath) || isScreenFile(filePath);
}
function isExported(node) {
    const parent = node.parent;
    if (!parent)
        return false;
    return parent.type === 'export_statement' ||
        (parent.parent?.type === 'export_statement');
}
function findParentDeclarator(node) {
    let current = node.parent;
    while (current) {
        if (current.type === 'variable_declarator')
            return current;
        current = current.parent;
    }
    return null;
}
function extractUseStateType(call) {
    // useState<Type>() → Type
    const typeArgs = call.childForFieldName('type_arguments');
    if (typeArgs)
        return typeArgs.text.replace(/[<>]/g, '');
    // Infere do valor inicial
    const args = call.childForFieldName('arguments');
    const firstArg = args?.namedChildren[0];
    if (!firstArg)
        return null;
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
//# sourceMappingURL=screen.extractor.js.map