# Plano: Extração Universal de Fluxo a partir do AST

> Objetivo: transformar qualquer arquivo de código-fonte em um grafo de
> elementos interligados que, a partir de qualquer ponto de entrada,
> possa ser percorrido para produzir uma árvore de fluxo completa —
> da assinatura do método até o último `return` ou `throw`.

---

## 0. Diferenciação: o que o Gaia faz hoje vs o que este plano propõe

> Análise baseada no código real de `/Desktop/gaia/src/`.

### 0.1 O que o Gaia é hoje

O Gaia é um **visualizador de topologia pré-computada**. Ele não extrai
nada do código-fonte. Recebe um `SystemTopology` JSON (produzido pelo
`tree-cli`) e renderiza SVG interativo em três níveis de navegação:

```
EcosystemView   → D3 force graph de serviços
ServiceView     → endpoints + databases + brokers do serviço
EndpointView    → fluxo esquerda→direita de um endpoint
```

O dado de entrada relevante para o fluxo é o `EndpointNode`:

```typescript
// topology.ts — o que o Gaia recebe hoje
interface EndpointNode extends BaseCodeNode {
  children: CodeNode[]; // árvore já montada pelo CLI
}

type CodeNodeType =
  | "endpoint"
  | "function"
  | "call"
  | "event"
  | "dbProcess"
  | "process"
  | "flowControl"
  | "return"
  | "throw"
  | "data"
  | "log"
  | "telemetry";
```

### 0.2 O que o EndpointView renderiza hoje

O `endpointLayout.ts` e `EndpointView.tsx` percorrem `endpoint.children`
recursivamente e tratam apenas 5 tipos de nó:

| CodeNodeType       | O que o Gaia renderiza                                              |
| ------------------ | ------------------------------------------------------------------- |
| `function`         | Píula nomeada + região visual + percorre seus filhos                |
| `flowControl`      | Diamante de condição + fan vertical de branches                     |
| `dbProcess`        | Nó lateral com operação SQL                                         |
| `return`           | Terminal verde (2xx) ou vermelho (4xx/5xx)                          |
| `throw`            | Terminal vermelho com código HTTP ou classe                         |
| **qualquer outro** | **`default: return { lastNode: prev }` — silenciosamente ignorado** |

### 0.3 Lacunas concretas — o que o Gaia não faz

**Lacuna 1 — A cadeia de chamadas para no handler**

O Gaia mostra `endpoint → UsersService.createUser → flowControl → return`.
Quando o handler chama `this.usersService.create(dto)`, isso vira um nó
`call` com `metadata.callee = "this.usersService.create"`. O Gaia renderiza
o `call` apenas se aparecer como filho direto — e mesmo assim o trata
como terminal. **Nunca entra dentro de `UsersService.create`.**

```
Gaia hoje:
  POST /users → createUser() → [call: this.usersService.create] → return 201

Este plano:
  POST /users → createUser()
                  └─ calls → UsersService.create(dto)
                               ├─ calls → validateInput(dto)
                               │            ├─ if (!dto.name) → throw 400
                               │            └─ if (!dto.email) → throw 400
                               ├─ calls → UserRepository.save(entity)  [DB:INSERT]
                               └─ return UserResponseDto
```

**Lacuna 2 — `resolvedTo` existe no tipo mas não é preenchido**

`CallNode.metadata.resolvedTo?: string` está definido em `topology.ts`
mas os extractors atuais não fazem resolução de DI. O campo chega sempre
`undefined`. O Gaia não tem como navegar de uma chamada para a
implementação porque essa ligação não existe nos dados.

**Lacuna 3 — Assignments, declarations e awaits são descartados**

`CodeNodeType` não tem `assign`, `variable`, `await`. Na extração atual,
`const user = await this.repo.findOne(id)` não gera nenhum nó filho —
a operação de banco de dados só aparece se o extractor de Prisma/TypeORM
a detectar explicitamente. Código intermediário invisível = fluxo com
lacunas.

**Lacuna 4 — `flowControl.branches` aplaina a estrutura**

```typescript
// Como o extrator atual representa um if/else:
{
  type: "flowControl",
  metadata: {
    kind: "if",
    condition: "!user",
    branches: [
      { label: "then", children: [throwNode] },
      { label: "else", children: [returnNode] }
    ]
  }
}
```

O `branches` é uma lista plana — `if` dentro de `else` dentro de `catch`
vira um array de arrays sem profundidade real. Este plano mantém a
hierarquia como `branch → branch_then → branch_else` com
`branch_else.children` podendo conter novos `branch`, preservando
aninhamento real.

**Lacuna 5 — Sem graph queries**

O Gaia renderiza o que recebe. Não é possível perguntar ao sistema:

- "Quais endpoints podem lançar `NotFoundException`?"
- "Quais funções não são chamadas por ninguém?" (dead code)
- "Existe ciclo de chamadas entre `ServiceA` e `ServiceB`?"
- "Qual o caminho máximo de chamadas a partir deste endpoint?"

O `ElementGraph` deste plano responde a todas essas perguntas como
travessias sobre índices já construídos.

**Lacuna 6 — Injeção de dependência não é modelada**

O Gaia não sabe que `private usersService: UsersService` no construtor
de `UsersController` é a classe `UsersService`. `ServiceDependency[]`
captura dependências declaradas manualmente ou inferidas por heurística,
não pelo grafo real de injeção. O `DIResolver` deste plano lê os
`required_parameter` do constructor e constrói o mapa de injeção
diretamente do AST.

### 0.4 Tabela de diferenças

| Dimensão                        | Gaia hoje                         | Este plano                                       |
| ------------------------------- | --------------------------------- | ------------------------------------------------ |
| **Origem dos dados**            | JSON pré-computado pelo CLI       | Construído do AST em tempo de análise            |
| **Profundidade de chamada**     | 1 nível (handler direto)          | Recursivo, segue calls entre serviços            |
| **Resolução `this.x.method()`** | Não existe                        | DIResolver + CallResolver                        |
| **Tipos de nó cobertos**        | 5 de 12 definidos                 | Todos — incluindo assign, await, variable        |
| **Estrutura if/else**           | Lista plana de branches           | Hierarquia real: branch → then/else aninhados    |
| **Modelo de dados**             | Árvore de `CodeNode[]` (children) | Grafo de `Element` + `Edge` com índices          |
| **FlowTree**                    | Gerado no render do React         | Computado pelo `FlowTreeBuilder`, separado da UI |
| **Detecção de ciclos**          | Não existe                        | Algoritmo no `FlowTreeBuilder`                   |
| **Dead code**                   | Não existe                        | Query em `incoming edges` no grafo               |
| **Querability**                 | Zero — só renderiza               | Graph traversal via `queries.ts`                 |
| **DI modelada**                 | Não                               | `DIResolver` — constructor → class               |

### 0.5 O que o Gaia pode aproveitar deste plano

O Gaia **não precisa mudar sua camada de renderização**. O `EndpointView`
e o `buildExpandedFlow` continuam funcionando — apenas o dado de entrada
muda de `EndpointNode.children: CodeNode[]` para `FlowTree`, que tem
estrutura equivalente mas com profundidade real e sem lacunas.

```
Hoje:   CLI → topology.json → Gaia lê CodeNode[] → renderiza
Futuro: CLI → ElementGraph → FlowTree → Gaia lê FlowNode[] → renderiza
```

A `FlowNode` do plano é intencionalmente compatível com o que o
`buildExpandedFlow` já espera: um nó com tipo, label e filhos. A diferença
é que os filhos agora incluem a chain completa e não param no primeiro
`call_site` não resolvido.

---

## 1. Princípios de design

| Princípio                                  | Descrição                                                                                                                                |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Graph-first**                            | Tudo vira nó e aresta. A árvore de fluxo é uma _view_ computada do grafo, não uma estrutura separada.                                    |
| **Extração antes de resolução**            | A fase 1 extrai elementos brutos sem tentar resolver referências. A fase 2 resolve. Isso permite processar arquivos em qualquer ordem.   |
| **IDs determinísticos**                    | Cada elemento tem ID baseado em `filepath + linha + coluna`. O mesmo código sempre produz o mesmo ID — permite cache e diff incremental. |
| **Agnóstico de linguagem**                 | Os `ElementKind` e `EdgeKind` representam conceitos universais (branch, call, loop) — não construções específicas de TypeScript ou Java. |
| **Granularidade máxima**                   | Cada `if`, cada `call`, cada `return` vira um elemento. Nada é colapsado na extração — o colapso acontece na visualização.               |
| **Referências não-resolvidas são válidas** | Um `call_site` pode existir sem `resolvedTo`. O grafo é útil mesmo parcialmente resolvido.                                               |

---

## 2. Modelo de dados central

### 2.1 Element

A unidade atômica. Todo artefato de código vira um `Element`.

```typescript
interface Element {
  // Identidade
  id: string; // hash(filePath + ":" + startLine + ":" + startCol)
  kind: ElementKind;

  // Localização
  location: {
    file: string; // path relativo ao root do serviço
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
  };

  // Conteúdo semântico
  name?: string; // nome legível (método, variável, classe...)
  signature?: string; // assinatura completa como string
  text?: string; // texto-fonte (apenas para nós folha, ex: literal)

  // Metadados opcionais por kind
  meta: ElementMeta;
}
```

### 2.2 ElementKind — taxonomia completa

```
ESTRUTURAIS        — definem o esqueleto do código
  module           arquivo fonte completo
  class            declaração de classe
  interface        interface TypeScript / Java / Go interface
  type_alias       type X = ...
  enum             enum declaration

COMPORTAMENTAIS    — unidades executáveis
  method           método de instância ou estático
  function         função livre (fora de classe)
  constructor      construtor de classe
  getter           accessor get
  setter           accessor set
  arrow_function   arrow function atribuída a variável

CONTROLE DE FLUXO  — ramificações e iterações dentro de um comportamental
  branch           if/else if/switch — o condicional completo
  branch_then      bloco then de um branch
  branch_else      bloco else de um branch
  loop             for / for-of / while / do-while
  loop_body        corpo de um loop
  try_block        bloco try
  catch_block      bloco catch (inclui parâmetro de erro)
  finally_block    bloco finally

STATEMENTS         — ações atômicas dentro de um bloco
  call_site        invocação de função ou método   ex: this.service.find(id)
  return_site      return statement                ex: return user
  throw_site       throw statement                 ex: throw new NotFoundException()
  assign_site      atribuição ou declaração        ex: const user = await ...
  await_site       await isolado (sem assign)      ex: await this.repo.flush()

DECLARAÇÕES        — nomes introduzidos no escopo
  parameter        parâmetro de função/método
  field            propriedade de classe (public_field_definition)
  variable         variável local (lexical_declaration)
  import_binding   símbolo importado de outro módulo

REFERÊNCIAS        — apontam para outros elementos sem conter lógica
  type_ref         referência a um tipo em anotação
  decorator_ref    referência ao decorator aplicado (@Injectable, @Get...)
```

### 2.3 ElementMeta — metadados por kind

```typescript
type ElementMeta =
  | ModuleMeta
  | ClassMeta
  | BehavioralMeta // method, function, constructor, getter, setter, arrow
  | BranchMeta
  | LoopMeta
  | CatchMeta
  | CallSiteMeta
  | ReturnSiteMeta
  | ThrowSiteMeta
  | AssignSiteMeta
  | ParameterMeta
  | FieldMeta
  | VariableMeta
  | ImportBindingMeta
  | TypeRefMeta
  | DecoratorRefMeta;

interface ModuleMeta {
  language: string; // 'typescript' | 'java' | 'go' | ...
  exports: string[]; // nomes exportados
}

interface ClassMeta {
  isAbstract: boolean;
  decorators: string[]; // nomes dos decorators  ex: ['Controller', 'Injectable']
  controllerPath?: string; // extraído de @Controller('/users')
  extendsName?: string; // nome da classe pai (não resolvido ainda)
  implementsNames: string[]; // nomes das interfaces
}

interface BehavioralMeta {
  visibility: "public" | "private" | "protected";
  isAsync: boolean;
  isStatic: boolean;
  decorators: string[]; // ex: ['Get', 'Post', 'UseGuards']
  httpMethod?: string; // extraído de decorator: 'GET' | 'POST' | ...
  httpPath?: string; // extraído de @Get('/path')
  returnTypeName?: string; // nome do tipo de retorno (não resolvido)
  paramCount: number;
}

interface BranchMeta {
  conditionText: string; // texto da condição  ex: "!user || !user.active"
  hasElse: boolean;
  branchIndex: number; // posição dentro do pai (0=primeiro if, 1=else if...)
}

interface LoopMeta {
  loopKind: "for-of" | "for-in" | "for" | "while" | "do-while";
  iterableText?: string; // ex: "users" em "for (const u of users)"
  variableText?: string; // ex: "u"
}

interface CatchMeta {
  errorParamName?: string; // ex: "e" em catch(e)
  errorTypeName?: string; // ex: "NotFoundException"
}

interface CallSiteMeta {
  calleeText: string; // texto exato  ex: "this.userService.create"
  argsText: string[]; // argumentos como strings
  isAwaited: boolean;
  isChained: boolean; // faz parte de a().b().c()
  // preenchido na fase de resolução:
  resolvedElementId?: string; // id do method/function chamado
  resolvedClassName?: string; // nome da classe dona do método
  isExternal?: boolean; // true se não foi possível resolver no codebase
}

interface ReturnSiteMeta {
  valueText?: string; // texto do valor retornado
  isVoid: boolean;
}

interface ThrowSiteMeta {
  exceptionText: string; // ex: "new NotFoundException('user not found')"
  exceptionClassName?: string; // ex: "NotFoundException"
  messageText?: string; // ex: "user not found"
}

interface AssignSiteMeta {
  targetText: string; // variável sendo atribuída
  valueText: string; // expressão do lado direito
  isConst: boolean;
  isAwait: boolean;
}

interface ParameterMeta {
  typeName?: string; // ex: "CreateUserDto"
  isOptional: boolean;
  hasDefault: boolean;
  defaultText?: string;
  decorators: string[]; // ex: ['Body', 'Param', 'Query']
  // preenchido na fase de resolução:
  injectedClassId?: string; // para parâmetros de construtor: id da classe injetada
}

interface FieldMeta {
  typeName?: string;
  visibility: "public" | "private" | "protected";
  isReadonly: boolean;
  isStatic: boolean;
  decorators: string[];
}

interface VariableMeta {
  typeName?: string;
  isConst: boolean;
  scopeElementId: string; // id do method/function que a declara
}

interface ImportBindingMeta {
  originalName: string; // nome no módulo de origem
  localName: string; // nome usado localmente (pode ser alias)
  sourceModule: string; // caminho do módulo  ex: './users.service'
  // preenchido na fase de resolução:
  resolvedModuleId?: string; // id do module element
  resolvedElementId?: string; // id do element exportado
}

interface TypeRefMeta {
  typeName: string;
  typeArgs: string[]; // ex: ["User"] em Promise<User>
  // preenchido na fase de resolução:
  resolvedElementId?: string;
}

interface DecoratorRefMeta {
  decoratorName: string; // ex: "Injectable"
  args: string[]; // argumentos crus como strings
  appliedToId: string; // id do element decorado
}
```

### 2.4 Edge

```typescript
interface Edge {
  id: string; // hash(from + kind + to)
  from: string; // Element.id
  to: string; // Element.id
  kind: EdgeKind;
  meta?: EdgeMeta;
}

type EdgeKind =
  // Estrutura
  | "contains" // pai → filho direto (module→class, class→method, method→branch...)
  // Comportamento
  | "calls" // call_site → method/function
  | "branches_to" // branch → branch_then / branch_else
  | "loop_iterates" // loop → loop_body
  | "try_handles" // try_block → catch_block / finally_block
  // Dependências
  | "imports" // module → module
  | "injects" // constructor parameter → class (DI)
  | "extends" // class/interface → class/interface
  | "implements" // class → interface
  // Tipos
  | "returns_type" // method/function → type_ref
  | "throws_type" // throw_site → type_ref
  | "typed_as" // parameter/field/variable → type_ref
  // Dados
  | "reads" // call_site/assign_site → field/variable
  | "writes"; // assign_site → field/variable

interface EdgeMeta {
  conditionText?: string; // para branches_to: o texto da condição
  label?: string; // rótulo legível para visualização
}
```

### 2.5 ElementGraph — o grafo completo

```typescript
interface ElementGraph {
  // Dados
  elements: Map<string, Element>;
  edges: Map<string, Edge>;

  // Índices (construídos automaticamente)
  byKind: Map<ElementKind, Set<string>>;
  byFile: Map<string, Set<string>>; // file → element ids no arquivo
  childrenOf: Map<string, string[]>; // parentId → [childId...]  (edge 'contains')
  parentOf: Map<string, string>; // childId → parentId
  outgoing: Map<string, Edge[]>; // elementId → edges que saem dele
  incoming: Map<string, Edge[]>; // elementId → edges que chegam nele
}
```

---

## 3. Pipeline de construção

```
┌─────────────────────────────────────────────────────────┐
│  Entrada: arquivo(s) de código-fonte                    │
└────────────────────┬────────────────────────────────────┘
                     │
          ┌──────────▼──────────┐
          │   FASE 1            │
          │   ASTWalker         │  tree-sitter → Elements + Edge(contains)
          │                     │  sem resolução de referências
          └──────────┬──────────┘
                     │  ElementGraph parcial (sem edges de calls/imports/injects)
          ┌──────────▼──────────┐
          │   FASE 2            │
          │   ReferenceResolver │  resolve calls, imports, DI, tipos
          │                     │  preenche meta.resolvedElementId
          └──────────┬──────────┘
                     │  ElementGraph completo
          ┌──────────▼──────────┐
          │   FASE 3            │
          │   FlowTreeBuilder   │  dado um element de entrada,
          │                     │  monta FlowTree por travessia do grafo
          └──────────┬──────────┘
                     │
          ┌──────────▼──────────┐
          │   Saída             │  FlowTree + ElementGraph
          └─────────────────────┘
```

---

## 4. Fase 1 — ASTWalker

### 4.1 Responsabilidade

Percorre o AST do tree-sitter e emite um `Element` para cada nó relevante,
mais uma `Edge(contains)` para cada relação pai→filho.

Não faz nenhuma resolução — referências ficam como texto cru nos `meta`.

### 4.2 Algoritmo

```
walkFile(filePath, astRoot):
  moduleEl = createElement('module', astRoot, { language, exports })
  graph.add(moduleEl)

  para cada nó filho do astRoot:
    dispatch(nó, parentId = moduleEl.id)

dispatch(node, parentId):
  kind = mapASTNodeToElementKind(node)
  se kind == null: iterar filhos recursivamente sem criar element

  el = createElement(kind, node)
  graph.add(el)
  graph.addEdge(contains, parentId → el.id)

  filhos = getRelevantChildren(node)
  para cada filho em filhos:
    dispatch(filho, parentId = el.id)
```

### 4.3 Mapeamento AST node → ElementKind

| AST node type                                | ElementKind      | Condição adicional                                     |
| -------------------------------------------- | ---------------- | ------------------------------------------------------ |
| `program`                                    | `module`         | —                                                      |
| `class_declaration`                          | `class`          | —                                                      |
| `interface_declaration`                      | `interface`      | —                                                      |
| `method_definition`                          | `method`         | sem decorator `get`/`set`                              |
| `method_definition`                          | `getter`         | tem child `get`                                        |
| `method_definition`                          | `setter`         | tem child `set`                                        |
| `method_definition`                          | `constructor`    | name === 'constructor'                                 |
| `function_declaration`                       | `function`       | —                                                      |
| `lexical_declaration` com arrow RHS          | `arrow_function` | RHS é `arrow_function` node                            |
| `if_statement`                               | `branch`         | —                                                      |
| `statement_block` filho de `branch` then     | `branch_then`    | —                                                      |
| `statement_block` filho de `branch` else     | `branch_else`    | —                                                      |
| `for_in_statement`                           | `loop`           | —                                                      |
| `try_statement` > `statement_block`          | `try_block`      | —                                                      |
| `catch_clause`                               | `catch_block`    | —                                                      |
| `statement_block` filho de `finally`         | `finally_block`  | —                                                      |
| `call_expression` como statement             | `call_site`      | pai é `expression_statement` ou `await_expression`     |
| `call_expression` como valor de assign       | `call_site`      | pai é `variable_declarator` ou `assignment_expression` |
| `return_statement`                           | `return_site`    | —                                                      |
| `throw_statement`                            | `throw_site`     | —                                                      |
| `lexical_declaration` (não arrow)            | `assign_site`    | —                                                      |
| `assignment_expression` como statement       | `assign_site`    | —                                                      |
| `required_parameter`                         | `parameter`      | —                                                      |
| `public_field_definition`                    | `field`          | —                                                      |
| `import_specifier` / `import_clause` default | `import_binding` | —                                                      |
| `decorator`                                  | `decorator_ref`  | —                                                      |
| `type_annotation`                            | `type_ref`       | —                                                      |

### 4.4 Nós ignorados na extração de elements

Nós que são puramente sintáticos e não viram `Element` próprio
(mas seus filhos ainda são processados):

```
statement_block (exceto os casos especiais acima)
formal_parameters
arguments
class_body
class_heritage
import_statement (o element relevante é import_binding)
export_statement (o element relevante é o que está sendo exportado)
parenthesized_expression
type_arguments
named_imports
```

---

## 5. Fase 2 — ReferenceResolver

Recebe o `ElementGraph` da fase 1 e adiciona as edges de referência,
preenchendo também os campos `resolvedElementId` nos metas.

### 5.1 Import Resolver

```
Para cada element de kind 'import_binding':
  meta.sourceModule → resolve para caminho absoluto
  buscar module element com aquele filePath
  se encontrado:
    addEdge(imports, this.module → found.module)
    buscar exported element com meta.originalName
    se encontrado:
      meta.resolvedElementId = found.id
      addEdge(imports, import_binding → found.element)
```

### 5.2 DI Resolver (injeção de dependência)

```
Para cada element de kind 'constructor':
  para cada parameter filho:
    se parameter.meta.typeName existe:
      buscar class/interface element com aquele nome
      se encontrado:
        meta.injectedClassId = found.id
        addEdge(injects, parameter → found.class)

  construir mapa de injeção para a classe pai:
    injectionMap[className][fieldName] = resolvedClassId
    (ex: injectionMap['UsersController']['usersService'] = 'id:UsersService')
```

### 5.3 Call Resolver

```
Para cada element de kind 'call_site':
  calleeText = meta.calleeText   // ex: "this.userService.create"

  CASO 1 — this.x.method():
    extrair receiver ('userService') e methodName ('create')
    buscar injectionMap[parentClass][receiver] → resolvedClassId
    buscar method element com nome=methodName e parentId=resolvedClassId
    se encontrado:
      meta.resolvedElementId = found.id
      meta.resolvedClassName = found.parentClass.name
      addEdge(calls, call_site → found.method)

  CASO 2 — método local (sem this):
    buscar function/method com aquele nome no mesmo módulo
    se encontrado: addEdge(calls, call_site → found)

  CASO 3 — import direto:
    buscar import_binding com localName = calleeText
    se resolvedElementId existe: addEdge(calls, call_site → resolved)

  se não resolvido:
    meta.isExternal = true
    (aresta não é criada — referência fica pendente)
```

### 5.4 Type Resolver

```
Para cada element de kind 'type_ref':
  buscar class/interface/type_alias com meta.typeName
  se encontrado:
    meta.resolvedElementId = found.id
    addEdge(typed_as | returns_type | throws_type, origem → found)
```

### 5.5 Structural Edges

```
Para cada class element:
  se meta.extendsName:
    resolver → addEdge(extends, class → parentClass)
  para cada name em meta.implementsNames:
    resolver → addEdge(implements, class → interface)
```

---

## 6. Fase 3 — FlowTreeBuilder

### 6.1 Estrutura do FlowTree

```typescript
interface FlowTree {
  root: FlowNode;
  stats: {
    totalNodes: number;
    maxDepth: number;
    unresolvedCalls: number;
    detectedCycles: string[][]; // cada ciclo como lista de ids
  };
}

interface FlowNode {
  elementId: string;
  element: Element; // referência para leitura fácil
  label: string; // texto legível para display
  edgeKind: EdgeKind; // como chegamos aqui (null na raiz)
  edgeMeta?: EdgeMeta;
  children: FlowNode[];
}
```

### 6.2 Algoritmo de construção

```
buildFlowTree(entryElementId, graph, options):
  visited = Set<string>()        // para detecção de ciclos
  cycles = []

  buildNode(elementId, parentEdgeKind, parentEdgeMeta, depth):
    se depth > options.maxDepth: return leaf("MAX_DEPTH")
    se elementId em visited:
      cycles.push(currentPath)
      return leaf("CYCLE → " + elementId)

    visited.add(elementId)
    element = graph.elements.get(elementId)
    node = FlowNode { elementId, element, label: labelFor(element) }

    // 1. Expandir filhos estruturais (contains) — fluxo interno
    structuralChildren = graph.childrenOf(elementId)
      .filter(childId => isFlowRelevant(graph.elements.get(childId)))
      .sorted por linha de código

    para cada childId em structuralChildren:
      childElement = graph.elements.get(childId)
      edgeMeta = getEdgeMeta(elementId, childId)
      node.children.push(
        buildNode(childId, 'contains', edgeMeta, depth + 1)
      )

    // 2. Para call_site: expandir a função chamada (se resolvida)
    se element.kind === 'call_site' && element.meta.resolvedElementId:
      resolvedId = element.meta.resolvedElementId
      callEdgeMeta = { label: element.meta.calleeText }
      node.children.push(
        buildNode(resolvedId, 'calls', callEdgeMeta, depth + 1)
      )

    // 3. Para branch: conectar then/else explicitamente
    se element.kind === 'branch':
      thenId = findChild(elementId, 'branch_then')
      elseId = findChild(elementId, 'branch_else')
      node.children = [
        buildNode(thenId,  'branches_to', { label: element.meta.conditionText }),
        elseId ? buildNode(elseId, 'branches_to', { label: 'else' }) : null
      ].filter(Boolean)

    visited.delete(elementId)    // permite que o mesmo element apareça em branches distintos
    return node

  return FlowTree {
    root: buildNode(entryElementId, null, null, 0),
    stats: computeStats(...)
  }
```

### 6.3 isFlowRelevant — filtro de granularidade

```typescript
function isFlowRelevant(element: Element): boolean {
  const FLOW_KINDS: ElementKind[] = [
    "method",
    "function",
    "constructor",
    "arrow_function",
    "branch",
    "branch_then",
    "branch_else",
    "loop",
    "loop_body",
    "try_block",
    "catch_block",
    "finally_block",
    "call_site",
    "return_site",
    "throw_site",
    "assign_site",
  ];
  return FLOW_KINDS.includes(element.kind);
}
```

### 6.4 labelFor — texto legível para cada nó

```
'module'           → filename
'class'            → "class ClassName"
'method'           → "methodName(param1: Type, param2: Type): ReturnType"
'function'         → "function name(params): ReturnType"
'constructor'      → "constructor(params)"
'branch'           → "if (conditionText)"
'branch_then'      → "then"
'branch_else'      → "else"
'loop'             → "for (variable of iterable)"
'try_block'        → "try"
'catch_block'      → "catch (errorParam)"
'finally_block'    → "finally"
'call_site'        → "calleeText(args...)"  [awaited] se isAwaited
'return_site'      → "return valueText"
'throw_site'       → "throw ExceptionClass(message)"
'assign_site'      → "const/let target = valueText"
```

---

## 7. Representação visual da FlowTree

Exemplo de saída para `UsersController.createUser`:

```
method createUser(dto: CreateUserDto): Promise<UserResponseDto>  [POST /users]
  │
  ├─ [assign]   const user = await this.usersService.create(dto)
  │               └─ calls → method UsersService.create(dto: CreateUserDto)
  │                            │
  │                            ├─ [call]   await this.validateInput(dto)
  │                            │             └─ calls → method UsersService.validateInput(dto)
  │                            │                          │
  │                            │                          ├─ if (!dto.name || !dto.email)
  │                            │                          │    └─ then
  │                            │                          │         └─ throw BadRequestException('campos obrigatórios')
  │                            │                          │
  │                            │                          └─ if (dto.password.length < 8)
  │                            │                               └─ then
  │                            │                                    └─ throw BadRequestException('senha fraca')
  │                            │
  │                            ├─ [assign]  const entity = new User(dto)
  │                            │
  │                            ├─ [call]    await this.userRepo.save(entity)   [DB:INSERT users]
  │                            │
  │                            └─ [return]  new UserResponseDto(entity)
  │
  └─ [return]   user
```

---

## 8. Queries úteis sobre o ElementGraph

Com o grafo completo, qualquer análise é uma travessia:

```typescript
// Todos os entry points (endpoints HTTP)
graph.byKind.get('method')
  .filter(id => graph.elements.get(id).meta.httpMethod != null)

// Quem chama um método específico (call graph inverso)
graph.incoming.get(methodId)
  .filter(e => e.kind === 'calls')
  .map(e => e.from)

// Todos os throw_site acessíveis a partir de um endpoint
fluxo profundo: bfs/dfs no FlowTree filtrando kind === 'throw_site'

// Dead code: métodos sem incoming 'calls' e que não são entry points
graph.byKind.get('method')
  .filter(id => graph.incoming.get(id).filter(e => e.kind === 'calls').length === 0)
  .filter(id => !isEntryPoint(id))

// Ciclos de dependência entre classes
detectar ciclos nas edges 'injects' + 'calls'

// Profundidade máxima de chamada de um endpoint
bfs no grafo de calls, medir distância máxima
```

---

## 9. Arquitetura desacoplada — pacote autônomo + projeções

> **Princípio inegociável:** o `ElementGraph` é o **artefato primário** do sistema.
> Ele não conhece `CodeNode`, não conhece `SystemTopology`, não conhece o Gaia.
> Quem quiser consumir o grafo (a topologia atual, o Gaia, queries de CI, um
> futuro plugin de IDE) o faz através de **projeções** que dependem do grafo —
> nunca o contrário.

### 9.1 Dois pacotes, fronteira de import enforçada

```
┌──────────────────────────────────────────────────────────────────┐
│  packages/code-graph/  (NOVO — pacote autônomo, zero dependência │
│                          do resto do monorepo)                   │
│                                                                  │
│  src/                                                            │
│    element.ts            Element, ElementKind, ElementMeta       │
│    edge.ts               Edge, EdgeKind, EdgeMeta                │
│    ids.ts                makeElementId, makeEdgeId               │
│    graph.ts              ElementGraph + índices                  │
│    serializer.ts         ElementGraph ↔ JSON (formato versionado)│
│    labels.ts             labelFor(element) por kind              │
│    queries.ts            callersOf, deadCode, cycles, ...        │
│                                                                  │
│    walkers/                                                      │
│      ast-walker.ts       interface ASTWalker                     │
│      ts-ast-walker.ts    TypeScript/JS                           │
│      java-ast-walker.ts  Java/Kotlin (Fase C)                    │
│      python-ast-walker.ts                                        │
│      go-ast-walker.ts                                            │
│                                                                  │
│    resolvers/                                                    │
│      import-resolver.ts  resolve import_binding                  │
│      di-resolver.ts      constructor parameter → class           │
│      call-resolver.ts    call_site → method/function             │
│      type-resolver.ts    type_ref → class/interface              │
│      structural-resolver.ts  extends/implements                  │
│                                                                  │
│    flow/                                                         │
│      flow-tree.ts        FlowTree, FlowNode, FlowOptions         │
│      flow-tree-builder.ts                                        │
│      cycle-detector.ts                                           │
│                                                                  │
│    builder.ts            buildGraph(files, options) → orquestra  │
│                          walkers + resolvers, retorna ElementGraph│
│                                                                  │
│  schema/                                                         │
│    element-graph.schema.json   contrato versionado p/ consumers  │
│                                externos (não-TS)                 │
│                                                                  │
│  package.json            "name": "@topology/code-graph"          │
│                          "dependencies": { tree-sitter-*, ... }  │
│                          NÃO depende de @topology/core           │
└──────────────────────────────────────────────────────────────────┘
                              │
                              │ (consumidores ↓)
                              │
┌─────────────────────────────▼────────────────────────────────────┐
│  packages/core/   (EXISTE — passa a importar @topology/code-graph│
│                    como dependência; nada do graph vive aqui)    │
│                                                                  │
│  src/                                                            │
│    core/orchestrator.ts   (EXISTE — agora também invoca o        │
│                            buildGraph e passa para projeções)    │
│    parsers/**             (EXISTE — ganha hook que retorna AST   │
│                            root para alimentar o walker)         │
│    extractors/**          (EXISTE — segue gerando CodeNode)      │
│    builders/**            (EXISTE — service.builder consome a    │
│                            projeção, não o grafo direto)         │
│    types/topology.ts      (EXISTE — sem campo `flowGraph`. O     │
│                            grafo NÃO mora dentro da topologia.)  │
│                                                                  │
│    projections/           (NOVO — adapters do grafo p/ consumers)│
│      topology-projection.ts  ElementGraph + endpointId →         │
│                              CodeNode[] aninhados                │
│                              (substitui EndpointNode.children)   │
│      stats-projection.ts     ElementGraph → diagnostics/métricas │
│                              que entram no SystemTopology        │
│                                                                  │
│  package.json            "dependencies": { "@topology/code-graph"│
│                          ... }                                   │
└──────────────────────────────────────────────────────────────────┘
                              │
                              │
┌─────────────────────────────▼────────────────────────────────────┐
│  apps/cli/   (EXISTE — passa a expor 3 comandos distintos)       │
│                                                                  │
│  src/cli.ts                                                      │
│    tree-cli graph    <repo>            → graph.json (puro)       │
│    tree-cli analyze  <repo>            → topology.json (usa graph│
│                                          + projeção topology)    │
│    tree-cli query    <graph.json> ...  → resultado de queries    │
└──────────────────────────────────────────────────────────────────┘
```

### 9.2 Regras de fronteira (enforçadas por lint)

| Pacote                 | Pode importar de                                                                               | NÃO pode importar de                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `@topology/code-graph` | tree-sitter-\*, std lib, hash util                                                             | `@topology/core`, `apps/*`, `topology.ts`, `CodeNode` |
| `@topology/core`       | `@topology/code-graph`, próprios módulos                                                       | `apps/*`                                              |
| `apps/cli`             | ambos                                                                                          | —                                                     |
| `apps/web` (Gaia)      | apenas tipos serializados (`graph.json`, `topology.json`) — opcional, hoje só consome topology | `@topology/code-graph` em runtime                     |

Configurar com `eslint-plugin-import` (`no-restricted-paths`) ou `dependency-cruiser`. Qualquer PR que viole a regra é bloqueado no CI.

### 9.3 Onde o Gaia entra

**Em lugar nenhum do código-fonte deste plano.** O Gaia continua lendo
`topology.json` exatamente como hoje. O que muda para ele é apenas o
_conteúdo_ dos `EndpointNode.children` — agora produzido pela
`topology-projection` em vez do nesting heurístico atual. Schema
inalterado, render inalterado.

Se um dia o Gaia quiser consumir o `graph.json` direto (para queries,
dead code, navegação inversa), isso é um **plano à parte** — escreve uma
nova projeção (ou consome o JSON Schema diretamente) sem precisar tocar
em `code-graph`.

### 9.4 Pipeline desacoplado

```
┌─────────────────────────────────────────────────────────────────┐
│  apps/cli                                                       │
│                                                                 │
│  CASO 1: tree-cli graph <repo>                                  │
│    walkRepository → SourceFile[]                                │
│         │                                                       │
│         ▼                                                       │
│    @topology/code-graph buildGraph(files):                      │
│      ASTWalker por linguagem → Elements + Edge(contains)        │
│      Resolvers (import, DI, call, type, structural)             │
│      → ElementGraph                                             │
│         │                                                       │
│         ▼                                                       │
│    serializer.toJSON(graph) → graph.json                        │
│    (FIM. Topology não é tocada.)                                │
│                                                                 │
│  CASO 2: tree-cli analyze <repo>                                │
│    walkRepository → SourceFile[]                                │
│         │                                                       │
│         ├─► extractors → CodeNode[]      (EXISTE)               │
│         │                                                       │
│         └─► @topology/code-graph buildGraph → ElementGraph      │
│                                                                 │
│    SystemTopology builder:                                      │
│      para cada endpoint:                                        │
│        children = topology-projection(graph, endpoint.id)       │
│      diagnostics += stats-projection(graph)                     │
│    → topology.json                                              │
│                                                                 │
│  CASO 3: tree-cli query <graph.json> <query-name> [args]        │
│    deserialize(graph.json) → ElementGraph                       │
│    queries[name](graph, args) → JSON                            │
└─────────────────────────────────────────────────────────────────┘
```

### 9.5 Schema externo como contrato

`packages/code-graph/schema/element-graph.schema.json` é o **contrato
público** do artefato. Versionado com `graphSchemaVersion: "1.0.0"`,
publicado independente do package npm. Consumidores externos validam
contra o schema sem precisar importar TypeScript.

Mudanças de schema seguem semver:

- Patch: novos campos opcionais em `meta`
- Minor: novos `ElementKind`/`EdgeKind` (consumers podem ignorar desconhecidos)
- Major: remoção/renomeação de campos existentes

---

## 10. Diferenças em relação ao sistema atual

| Aspecto                      | Sistema atual                      | Este plano                                         |
| ---------------------------- | ---------------------------------- | -------------------------------------------------- |
| Modelo de saída              | `CodeNode[]` tipados por framework | `ElementGraph` universal                           |
| Granularidade                | Endpoint, função, DB call          | Toda declaração, branch, loop, return, throw       |
| Estrutura interna de funções | Não extraída                       | Totalmente mapeada em `LogicNode`                  |
| Resolução de chamadas        | Não existe                         | `CallResolver` com fallback gracioso               |
| Injeção de dependência       | Não modelada                       | `DIResolver` constrói mapa de injeção              |
| Travessia de fluxo           | Não existe                         | `FlowTreeBuilder` recursivo com detecção de ciclos |
| Dead code                    | Não detectado                      | Query trivial no grafo                             |
| Suporte multi-linguagem      | Por parser separado                | ASTWalker por linguagem, modelo unificado          |
| Incremental / cache          | Não existe                         | IDs determinísticos permitem diff                  |

---

## 11. Plano de implementação desacoplado — três fases

> A ordem é **estrita**: Fase A constrói o grafo como pacote autônomo, sem
> nenhum consumidor sabendo dele. Só depois a Fase B escreve as projeções
> que ligam o grafo aos consumidores existentes (topology.json, e por
> tabela o Gaia). A Fase C estende para outras linguagens.
>
> Em qualquer momento entre fases, parar a implementação produz um sistema
> coerente: A sozinha já entrega `tree-cli graph` + `tree-cli query` úteis
> mesmo sem topology atualizada; B sozinha entrega o `topology.json` mais
> rico para o Gaia; C apenas amplia cobertura linguística.

### Princípio de aceite por Fase

| Fase | Termina quando                                                                                                                                                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | `tree-cli graph <repo>` produz `graph.json` que valida contra o JSON Schema, contém todos os `ElementKind` da §2.2 quando o código os contém, e `tree-cli query` responde dead-code/cycles/callers. **Topology e Gaia ainda intocados.** |
| B    | `tree-cli analyze` continua produzindo `topology.json` no mesmo schema, mas com `EndpointNode.children` profundo (chain expandida via projeção). Gaia renderiza sem mudança de código.                                                   |
| C    | Walkers Java/Python/Go geram `Element`s equivalentes para fixtures dessas linguagens.                                                                                                                                                    |

---

---

## FASE A — Pacote `@topology/code-graph` autônomo (zero acoplamento)

> **Premissa:** durante toda a Fase A, **nada** no resto do monorepo
> (`packages/core`, `apps/web`) é tocado. O pacote vive isolado, é testado
> isolado, e produz `graph.json` independente do `topology.json`. Isso
> obriga o desacoplamento por construção.

### A.0 — Bootstrap do pacote

| Ação                                                                                                                                                                               | Caminho                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Criar workspace `packages/code-graph/` no monorepo (pnpm)                                                                                                                          | `packages/code-graph/package.json` (NOVO)                          |
| `package.json` declara `"name": "@topology/code-graph"`, dependências apenas em `tree-sitter*`                                                                                     | `packages/code-graph/package.json`                                 |
| `tsconfig.json` com `composite: true` e sem path aliases que refiram a outros packages                                                                                             | `packages/code-graph/tsconfig.json`                                |
| Configurar `dependency-cruiser` ou `eslint-plugin-import/no-restricted-paths` no root para proibir import de `@topology/core`, `apps/*`, qualquer arquivo `topology.ts`/`CodeNode` | raiz do monorepo (`.dependency-cruiser.cjs` ou `eslint.config.js`) |
| CI gate: regra de import roda em todo PR                                                                                                                                           | `.github/workflows/*.yml` ou pipeline equivalente                  |

**Aceite:** `pnpm -F @topology/code-graph build` passa, e a regra de lint
falha se alguém tentar `import * from '@topology/core'` dentro do pacote.

---

### A.1 — Núcleo: tipos, IDs, grafo, serialização

| Tarefa                                                                                          | Arquivo (em `packages/code-graph/src/`) | Referência no plano |
| ----------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------- |
| `Element`, `ElementKind`, `ElementMeta` (todas as variantes)                                    | `element.ts`                            | §2.1–2.3            |
| `Edge`, `EdgeKind`, `EdgeMeta`                                                                  | `edge.ts`                               | §2.4                |
| `makeElementId(file, line, col)` (sha1 truncado), `makeEdgeId(from, kind, to)`                  | `ids.ts`                                | §1                  |
| `ElementGraph` + índices (`byKind`, `byFile`, `childrenOf`, `parentOf`, `outgoing`, `incoming`) | `graph.ts`                              | §2.5                |
| Serializer/deserializer JSON com `graphSchemaVersion`                                           | `serializer.ts`                         | —                   |
| `labelFor(element)` por `ElementKind`                                                           | `labels.ts`                             | §6.4                |

**Aceite:** testes unitários (`vitest`) cobrem add/get/index/serialize. O
mesmo grafo serializado e re-deserializado preserva todos os índices.

---

### A.2 — JSON Schema externo

| Tarefa                                                                                                  | Arquivo                                                |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Gerar `element-graph.schema.json` a partir dos tipos TS (via `ts-json-schema-generator` ou manualmente) | `packages/code-graph/schema/element-graph.schema.json` |
| Validador `validateGraphJSON(json)` exposto no pacote                                                   | `packages/code-graph/src/schema-validator.ts`          |
| Versionar `graphSchemaVersion: "1.0.0"` no schema e no serializer                                       | ambos                                                  |

**Aceite:** `validateGraphJSON(serialize(g))` retorna ok para qualquer grafo construído pelo pacote.

---

### A.3 — `ASTWalker` interface + `TsAstWalker`

> **Critério inegociável de cobertura de nós** (atende ao requisito do
> usuário: _"primeiro pensar em todos os possíveis nós para compor o
> fluxo do código"_). A Fase A1 só termina quando **cada** `ElementKind`
> da §2.2 que TypeScript suporta tem extração testada.

| Tarefa                                                                                                 | Arquivo                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface `ASTWalker { walk(file, root, ctx): ElementBatch }`                                          | `walkers/ast-walker.ts`                                                                                                                                                                |
| `TsAstWalker` implementando o mapeamento §4.3 inteiro                                                  | `walkers/ts-ast-walker.ts`                                                                                                                                                             |
| Adapter mínimo para invocar `tree-sitter-typescript` (parsing isolado, não depende de `packages/core`) | `walkers/ts-parser-adapter.ts`                                                                                                                                                         |
| **Fixtures por `ElementKind`** — uma função `.ts` curta exercendo cada kind                            | `tests/fixtures/kinds/{module,class,method,branch,loop,call_site,return_site,throw_site,assign_site,await_site,parameter,field,variable,import_binding,type_ref,decorator_ref,...}.ts` |
| Teste por kind: `it('extrai branch_then aninhado em branch_else', ...)`                                | `tests/walkers/ts-ast-walker.spec.ts`                                                                                                                                                  |
| Snapshot do grafo de `sample-api` (apenas `contains`, sem resolvers)                                   | `tests/snapshots/sample-api.contains.json`                                                                                                                                             |

**Aceite:** `pnpm -F @topology/code-graph test` cobre 100% dos `ElementKind`
da §2.2 que existem em TS. Cada kind tem um teste verde isolado.

---

### A.4 — Resolvers (5 deles, ordem fixa)

| Ordem | Resolver                               | Arquivo                            | Referência |
| ----- | -------------------------------------- | ---------------------------------- | ---------- |
| 1     | Imports                                | `resolvers/import-resolver.ts`     | §5.1       |
| 2     | DI (constructor param → class)         | `resolvers/di-resolver.ts`         | §5.2       |
| 3     | Calls (this.x.method / local / import) | `resolvers/call-resolver.ts`       | §5.3       |
| 4     | Types (type_ref → declaração)          | `resolvers/type-resolver.ts`       | §5.4       |
| 5     | Estruturais (extends/implements)       | `resolvers/structural-resolver.ts` | §5.5       |

A ordem importa: DI precisa de classes resolvidas; Call precisa do
mapa de DI; Type pode ir paralelo; Structural depende de tipos.

**Aceite:** sobre o grafo do `sample-api`,
`graph.outgoing.get(controllerMethodId).filter(e => e.kind === 'calls')`
retorna a aresta resolvida para `UsersService.create`, não fica vazia.

---

### A.5 — `FlowTreeBuilder` e queries

| Tarefa                                                                                               | Arquivo                     |
| ---------------------------------------------------------------------------------------------------- | --------------------------- |
| Tipos `FlowTree`, `FlowNode`, `FlowOptions`, `FlowStats`                                             | `flow/flow-tree.ts`         |
| `buildFlowTree(entryId, graph, options)` com detecção de ciclos                                      | `flow/flow-tree-builder.ts` |
| `cycle-detector.ts` reutilizável                                                                     | `flow/cycle-detector.ts`    |
| Queries: `callersOf`, `calleesOf`, `deadCode`, `throwSitesReachableFrom`, `depthFromEntry`, `cycles` | `queries.ts`                |
| `buildGraph(files, options)` — função única que orquestra walkers + resolvers                        | `builder.ts`                |

**Aceite:** dado o grafo do `sample-api`, `buildFlowTree(endpointId)`
produz `FlowTree` com a chain profunda demonstrada na §7. As queries
listadas retornam resultados não-triviais.

---

### A.6 — CLI mínima própria do pacote

> **O pacote tem CLI próprio** — não passa por `apps/cli`. Isso prova
> autonomia e dá ao desenvolvedor uma ferramenta utilizável antes mesmo
> da projeção topology existir.

| Comando                                                                                   | Implementação                                             |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `code-graph extract <repo> [--out graph.json]`                                            | `packages/code-graph/src/cli/extract.ts` (bin do package) |
| `code-graph query <graph.json> <query> [args]` (callers/dead-code/cycles/depth/flow-tree) | `packages/code-graph/src/cli/query.ts`                    |
| `code-graph validate <graph.json>` (valida contra schema)                                 | `packages/code-graph/src/cli/validate.ts`                 |

`package.json`:

```json
"bin": { "code-graph": "./dist/cli/index.js" }
```

**Aceite final da Fase A:**

```bash
pnpm -F @topology/code-graph exec code-graph extract C:/Users/User/Desktop/sample-api -o graph.json
pnpm -F @topology/code-graph exec code-graph validate graph.json   # OK
pnpm -F @topology/code-graph exec code-graph query graph.json dead-code
pnpm -F @topology/code-graph exec code-graph query graph.json flow-tree --entry "<endpointId>"
```

Tudo funciona **sem que `packages/core` ou `apps/web` saibam que `code-graph` existe**.

---

## FASE B — Projeções dentro de `packages/core`

> Só começa depois da Fase A estar verde no CI. Aqui o `core` passa a
> declarar `@topology/code-graph` como dependência e escreve as projeções
> que ligam o grafo ao `topology.json` que o Gaia já consome.

### B.1 — Adicionar `code-graph` como dependência

| Ação                                                      | Arquivo                      |
| --------------------------------------------------------- | ---------------------------- |
| `dependencies: { "@topology/code-graph": "workspace:*" }` | `packages/core/package.json` |

---

### B.2 — `topology-projection`: grafo → `EndpointNode.children`

| Tarefa                                                                                                                                                                                                                                                                                                           | Arquivo                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Função `projectEndpointFlow(graph, endpointElementId): CodeNode[]` que mapeia FlowTree → CodeNode                                                                                                                                                                                                                | `packages/core/src/projections/topology-projection.ts` (NOVO) |
| Mapeamento explícito por kind: `method/function/constructor → "function"`, `branch/loop/try → "flowControl"`, `call_site → "call"` (com `metadata.resolvedTo`), `return_site → "return"`, `throw_site → "throw"`, `assign_site → "data"` (kind `variable`/`constant`), `await_site` colapsa no `call_site` filho | mesmo arquivo                                                 |
| Mapa `elementId → CodeNode.id` para que `metadata.resolvedTo` continue válido na projeção                                                                                                                                                                                                                        | mesmo arquivo                                                 |

**Aceite:** dado o grafo de `sample-api` e o `endpointId` de `POST /users`,
`projectEndpointFlow(...)` produz `CodeNode[]` que valida contra o tipo
`CodeNode` existente em `topology.ts`.

---

### B.3 — Integração no orchestrator

| Tarefa                                                                                                                                         | Arquivo                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Estender `LanguageParser` com `walkAst?(file, ctx): ElementBatch \| null` opcional                                                             | `packages/core/src/parsers/base.ts:15-30`               |
| `TypeScriptParser` implementa `walkAst` reusando `tree.rootNode` que já cria                                                                   | `packages/core/src/parsers/typescript.parser.ts:63-170` |
| Em `analyzeService`, acumular `ElementBatch` por arquivo num grafo do serviço                                                                  | `packages/core/src/core/orchestrator.ts:191-280`        |
| Em `analyzeRepository`, após o loop de serviços, rodar resolvers do `@topology/code-graph` sobre o grafo unificado                             | `packages/core/src/core/orchestrator.ts:53-189`         |
| Em `linkEndpointHandlers`, substituir `endpoint.children` por `projectEndpointFlow(graph, endpoint.elementId)` quando o grafo cobre o endpoint | `packages/core/src/builders/service.builder.ts:78-100`  |
| Fallback gracioso: se projeção falhar para um endpoint, manter os `children` antigos                                                           | mesmo arquivo                                           |

**Aceite:** `topology.json` para `sample-api` mostra a chain profunda no
endpoint `POST /users` (mesmo desenho da §7), validado contra os fixtures
existentes em `tests/fixtures/*/gold-output.json` (atualizados para a nova
profundidade).

---

### B.4 — `stats-projection`: métricas no diagnostics

| Tarefa                                                                                                 | Arquivo                                                    |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `projectGraphStats(graph): Diagnostic[]` — emite warnings de dead code, ciclos, profundidade excessiva | `packages/core/src/projections/stats-projection.ts` (NOVO) |
| Append em `topology.diagnostics` no fim de `analyzeRepository`                                         | `packages/core/src/core/orchestrator.ts`                   |

---

### B.5 — Comandos novos no CLI

| Comando                                                                                | Implementação                           |
| -------------------------------------------------------------------------------------- | --------------------------------------- |
| `tree-cli graph <repo>` (NOVO) — só roda buildGraph + escreve graph.json               | `apps/cli/src/cli.ts` (novo subcomando) |
| `tree-cli analyze <repo>` (EXISTENTE) — agora usa graph + projeção topology            | `apps/cli/src/cli.ts:20-127`            |
| `tree-cli query <graph.json> <query> [args]` (NOVO) — wrapper sobre `code-graph query` | `apps/cli/src/cli.ts`                   |
| `tree-cli inspect <topology.json>` (EXISTENTE) — sem mudança                           | `apps/cli/src/cli.ts:173+`              |

**Aceite final da Fase B:** o Gaia carrega `topology.json` produzido
pelo novo `analyze` e renderiza o `EndpointView` de `POST /users` com a
chain profunda — **sem nenhuma mudança no código do Gaia**.

---

## FASE C — Outras linguagens

> Mesma interface `ASTWalker`, walkers separados. Não toca em projeções,
> resolvers (recebem language adapter), nem CLI.

| Linguagem   | Arquivo (em `packages/code-graph/src/walkers/`) | Tree-sitter root nodes principais                                                               |
| ----------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Java/Kotlin | `java-ast-walker.ts`                            | `class_declaration`, `method_declaration`, `if_statement`, `try_statement`, `method_invocation` |
| Python      | `python-ast-walker.ts`                          | `class_definition`, `function_definition`, `if_statement`, `call`, `try_statement`              |
| Go          | `go-ast-walker.ts`                              | `function_declaration`, `method_declaration`, `if_statement`, `call_expression`                 |

Resolvers ganham `LanguageAdapter` com diferenças de notação (`self.x`
em Python, `this.x` em TS, receiver em Go). Adapter é resolvido por
`element.location.file` extension + módulo registrado.

**Aceite por linguagem:** fixtures equivalentes ao `sample-api` em
`tests/fixtures/{java,python,go}/` produzem grafos com cobertura de
`ElementKind` análoga ao TS.

---

### 11.1 Resumo de novos artefatos vs. arquivos existentes

| Status                     | Caminho                                                                                                                                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EXISTE — sem mudança       | `packages/core/src/extractors/**/*`, `core/walker.ts`, `analysis/service-merger.ts`, `output/writer.ts`, `builders/edge.builder.ts`, `apps/web/**`                                                                                                                                 |
| EXISTE — pequena extensão  | `packages/core/src/parsers/base.ts` (interface `walkAst?`), `parsers/typescript.parser.ts` (impl `walkAst`), `core/orchestrator.ts` (chama `buildGraph` + resolvers), `builders/service.builder.ts` (consome projeção), `apps/cli/src/cli.ts` (novos subcomandos `graph`, `query`) |
| NOVO — pacote autônomo     | `packages/code-graph/` inteiro (src/, schema/, tests/, package.json, tsconfig.json, bin)                                                                                                                                                                                           |
| NOVO — projeções no `core` | `packages/core/src/projections/topology-projection.ts`, `projections/stats-projection.ts`                                                                                                                                                                                          |
| NOVO — gates de fronteira  | `.dependency-cruiser.cjs` ou regra `no-restricted-paths` no eslint root                                                                                                                                                                                                            |

### 11.2 MVP demonstrável (caminho mais curto)

Se o objetivo for **provar a chain profunda em um único endpoint** o mais
rápido possível, sem comprometer o desacoplamento:

1. Fase A.0–A.3 limitadas ao essencial: pacote criado, `Element/Edge/Graph`
   prontos, `TsAstWalker` cobrindo apenas `module/class/method/constructor/
branch/call_site/return_site/throw_site/assign_site` (esquece await/loop/
   try por ora).
2. Fase A.4: apenas `di-resolver` + `call-resolver` (deixa import/type/structural).
3. Fase A.5: `flow-tree-builder` + `labels`.
4. Fase A.6: só o comando `code-graph extract`. Pula `query` e `validate`.
5. Fase B.2 + B.3 mínimas: projeção que cobre só os kinds da etapa 1, e
   patch em `service.builder.ts` que usa a projeção apenas para o endpoint
   `POST /users` (`if endpoint.path === '/users' && endpoint.method === 'POST'`).
6. Comparar visualmente no Gaia: antes vs depois.

A regra de fronteira de import (A.0) **deve** estar ativa desde o início,
mesmo no MVP — é ela que garante que o desacoplamento não regrida quando
a implementação acelerar.
