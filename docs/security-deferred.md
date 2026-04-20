# Segurança — Itens Diferidos (pré-produção)

Estes itens foram identificados na auditoria de segurança de 2026-04-20 e são
**necessários antes de expor a aplicação para usuários externos**. Enquanto o
projeto rodar apenas localmente, o risco é aceitável — mas devem ser implementados
antes de qualquer deploy público ou compartilhamento de acesso.

---

## CRÍTICO — Implementar antes de qualquer deploy

### C-1 · Nenhuma autenticação nos endpoints da API

**Risco:** Qualquer pessoa com acesso à rede pode chamar todos os endpoints sem
restrição: analisar repos, listar topologias salvas, deletar dados.

**Arquivos afetados:**
- `apps/api/src/main.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/modules/topology/topology.controller.ts`

**Implementação recomendada:**
1. Criar `apps/api/src/common/guards/api-key.guard.ts` com `@Injectable() implements CanActivate`
2. Comparar header `x-api-key` com `process.env.API_SECRET_KEY` usando `timingSafeEqual` (crypto)
3. Registrar como `APP_GUARD` global no `AppModule`
4. Criar decorator `@Public()` para endpoints que não requerem auth (ex: health check)
5. Adicionar `API_SECRET_KEY` ao `.env.example`

---

### C-2 · DTO `source` não é validado pelo NestJS ValidationPipe

**Risco:** O campo `source` em `AnalyzeRequestDto` é uma union type
(`LocalSourceDto | GitSourceDto`) sem `@ValidateNested()` + `@Type()`. O
ValidationPipe nunca valida os campos internos. Qualquer payload malformado
chega ao adapter sem validação.

**Arquivo:** `apps/api/src/modules/topology/dto/analyze-request.dto.ts:47-48`

**Implementação recomendada:**
```ts
@ValidateNested()
@Type(() => SourceDto, {
  discriminator: {
    property: 'kind',
    subTypes: [
      { value: LocalSourceDto, name: 'local' },
      { value: GitSourceDto,   name: 'git'   },
    ],
  },
  keepDiscriminatorProperty: true,
})
source!: LocalSourceDto | GitSourceDto;
```

---

### C-3 · `LocalDirectoryAdapter` permite analisar qualquer diretório do servidor

**Risco:** `POST /topologies/analyze` com `{"kind":"local","path":"/etc"}` analisa
todo o `/etc` do servidor e retorna o conteúdo como topologia JSON.

**Arquivo:** `apps/api/src/extraction/adapters/local-directory.adapter.ts:21`

**Implementação recomendada:**
1. Adicionar `LOCAL_REPOS_BASEDIR` ao `.env` (ex: `/data/repos`)
2. Verificar que `resolve(descriptor.path).startsWith(resolve(basedir))` antes de prosseguir
3. Lançar `ForbiddenException` se o path estiver fora do basedir

---

## ALTO — Implementar na primeira semana de produção

### H-1 · Nenhum rate limiting

**Risco:** `POST /topologies/analyze` dispara clone git + análise AST completa.
Sem rate limiting, qualquer IP pode saturar CPU/disco com requests paralelas.

**Arquivo:** `apps/api/src/app.module.ts`, `apps/api/src/main.ts`

**Implementação recomendada:**
```bash
pnpm add @nestjs/throttler --filter @topology/api
```
```ts
// app.module.ts
ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])

// topology.controller.ts — endpoint analyze
@Throttle({ default: { ttl: 60_000, limit: 5 } })
@Post('analyze')
```

---

### H-2 · Atualizar `@nestjs/core` e `@nestjs/common`

**Risco:** `@nestjs/core <=11.1.17` tem vulnerabilidade de "Improper Neutralization"
no runtime de produção da API.

**Arquivo:** `apps/api/package.json`

**Implementação:**
```bash
pnpm update @nestjs/core @nestjs/common @nestjs/platform-express --latest --filter @topology/api
```
Verificar changelog de breaking changes antes de atualizar (10.x → 11.x tem mudanças).

---

### H-3 · Vulnerabilidade `file-type` (DoS via decompression bomb)

**Risco:** `@nestjs/common` usa `file-type <=20.4.1` que tem infinite loop no parser
ASF e vulnerabilidade de DoS via ZIP bomb. Afeta o runtime da API.

**Arquivo:** `package.json` (root) — já tem entry em `pnpm.overrides` mas
`file-type` não foi incluída. Completar:
```json
"pnpm": {
  "overrides": {
    "file-type": ">=20.5.0"
  }
}
```

---

## MÉDIO — Implementar antes de expor para clientes externos

### M-1 · CORS ausente

**Arquivo:** `apps/api/src/main.ts`

**Implementação:**
```ts
app.enableCors({
  origin: process.env.CORS_ORIGINS?.split(',') ?? false,
  credentials: true,
});
```
Em `.env.example`: `CORS_ORIGINS=http://localhost:5173`

---

### M-2 · Nenhum header de segurança HTTP (ausência do `helmet`)

**Arquivo:** `apps/api/src/main.ts`, `apps/api/package.json`

**Implementação:**
```bash
pnpm add helmet --filter @topology/api
```
```ts
import helmet from 'helmet';
app.use(helmet());
```

---

### M-3 · Swagger docs expostos publicamente

**Arquivo:** `apps/api/src/main.ts:19`

**Implementação:**
```ts
if (process.env.SWAGGER_ENABLED === 'true') {
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
}
```
Em prod: `SWAGGER_ENABLED=false` (default)

---

### M-4 · `:id` nos endpoints sem validação de formato

**Risco:** IDs como `../../../` ou payloads SQL/NoSQL passam sem rejeição.

**Arquivo:** `apps/api/src/modules/topology/topology.controller.ts:33,39,46,52`

**Implementação:**
1. Criar `apps/api/src/common/pipes/parse-nanoid.pipe.ts`
2. Validar `/^[a-zA-Z0-9_-]{10,30}$/`
3. Aplicar em todos os `@Param('id')`

---

## BAIXO — Housekeeping

### L-1 · `webpack` SSRF e `tmp` arbitrary file write (build tools)

Apenas afetam o ambiente de build/dev, não o runtime. Podem ser corrigidos
atualizando `@nestjs/cli`:
```bash
pnpm update @nestjs/cli --latest --filter @topology/api
```

### L-2 · `eslint-plugin-security`

Adicionar ao pipeline de CI para detectar regressões em padrões inseguros
(dynamic require, insecure regex, etc.):
```bash
pnpm add -D eslint-plugin-security --filter @topology/core
```

---

## Testes de segurança pendentes

Quando os itens acima forem implementados, adicionar:

| Teste | Arquivo sugerido |
|---|---|
| Request sem `x-api-key` → 401 | `tests/security/api-auth.test.ts` |
| `url: "file:///etc"` → 400 | já coberto no `git.adapter.ts` — adicionar teste E2E |
| Body malformado em `source` → 400 | `tests/security/api-dto.test.ts` |
| 6ª request analyze em 1min → 429 | `tests/security/api-rate-limit.test.ts` |
| `path: "/etc"` fora do basedir → 403 | `tests/security/api-local-path.test.ts` |

---

*Auditoria gerada em 2026-04-20. Rever após cada atualização de dependências.*
