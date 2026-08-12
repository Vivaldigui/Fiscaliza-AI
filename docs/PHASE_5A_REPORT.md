# Relatório da Fase 5A — RAG web autorizado com embeddings

**Data da entrega:** 2026-08-11
**Escopo:** abstração `EmbeddingProvider`, indexação incremental e versionada de embeddings em PostgreSQL/pgvector, retrieval autorizado (escopo SQL antes do ranking), conversa web com fontes validadas e clicáveis, e a suíte de segurança/testes correspondente — sem WhatsApp, sem envio externo por n8n, sem alertas de prazo e sem uso de documentos reais.
**Decisão de arquitetura:** `docs/adr/ADR-002-EMBEDDINGS.md`.

## Resultado

Um vereador acessa `/conversas`, cria uma conversa sobre uma proposição e pergunta em linguagem natural. Perguntas estruturadas (status, prazo, autoria, protocolo) são respondidas deterministicamente a partir do PostgreSQL, **sem chamada ao LLM**. Perguntas abertas passam por retrieval semântico que executa `ORDER BY c.embedding <=> $1 LIMIT $2` **somente** sobre o allowlist de documentos da proposição (anexos + respostas oficiais) — um chunk de outro processo, mesmo perfeitamente similar, nunca entra no contexto. As fontes citadas pelo modelo são validadas contra páginas reais; fonte inventada rebaixa a resposta para "sem evidência suficiente" e nunca persiste. Cada mensagem guarda provider/modelo/tokens/latência/versões, e cada operação de IA gera um `AIUsage` auditável.

## Gate inicial e preservação das fases anteriores

A Fase 4 foi mergeada em `origin/main` via PR #4 (`4ccc19e`), incluindo o `OpenAIProvider` (PR #4). O gate confirmou o estado de `main` (fetch + `gh pr view`), releu os documentos-chave (READ ME, `ARCHITECTURE.md`, `DATA_MODEL.md`, `AI_PIPELINE.md`, `IMPLEMENTATION_PLAN.md`, `PHASE_4_REPORT.md`, ADRs, `schema.prisma` e os módulos de IA já existentes) e preservou os arquivos locais não relacionados antes de qualquer alteração. A Fase 5A foi implementada em `agent/fase-5a-rag-web`, criada a partir do `main` atualizado, **sem editar nenhuma migration anterior** (as duas novas são `202608110100_phase5a_embeddings` e `202608110200_phase5a_conversations`).

## Segurança de dados locais

`data/proposicoes-itanhandu/` (ignorado pelo Git) e `scripts/` (baixador local de proposições públicas) permaneceram intocados e fora do commit. Nenhum documento real foi lido, resumido, indexado, usado como fixture ou enviado a qualquer provider. Todos os testes utilizam conteúdo sintético gerado no próprio teste. A política de "não enviar documentos reais durante desenvolvimento/testes" foi mantida integralmente: `EMBEDDINGS_ENABLED=false` (padrão) e `AI_PROCESSING_ENABLED=false` (padrão desde a Fase 4) tornam toda chamada externa opt-in.

## Implementado

### Schema e migrations

- **`202608110100_phase5a_embeddings`**: adiciona `embedding_provider`/`embedding_model`/`embedding_version`/`embedding_hash` em `document_chunks` e cria o índice HNSW de pgvector (`document_chunks_embedding_hnsw_idx`, operator class `vector_cosine_ops`) via SQL puro — o Prisma não gerencia o tipo `vector` nem índices HNSW; a coluna vetorial permanece `Unsupported` no schema.
- **`202608110200_phase5a_conversations`**: `conversations`/`conversation_messages` já existiam desde a Fase 1 como scaffold do WhatsApp futuro; esta migration **estende** `conversation_messages` com `status` (enum `PENDING/COMPLETED/FAILED` que dirige o polling web), `provider`, `model`, `answer_version`, `embedding_version`, `input_tokens`, `output_tokens`, `latency_ms`, `failure_reason` e `input_hash`, cria o índice único parcial `(conversation_id, role, input_hash)` (double-submit falha rápido) e liga `ai_usage.conversation_message_id` (ON DELETE SET NULL). A `AIUsage` passa a persistir provider/modelo/tokens/latência das respostas web independentemente das análises documentais.
- Nenhuma migration anterior foi modificada.

### `packages/ai`

- `EmbeddingProvider` (interface `name`/`model`/`dimension`/`embed`) e `createEmbeddingProvider` (`openai` exige `apiKey`; `fake` para dev/CI); exports em `index.ts`.
- `OpenAIEmbeddingProvider` (SDK OpenAI, `text-embedding-3-small` configurável, `dimensions` opcional) e `FakeEmbeddingProvider` (dublê determinístico, vetores unitários seedados, `name = 'fake'`).
- `embeddings.ts`: `computeEmbeddingHash(content, provider, model, dimension, version)` e `embedInBatches(provider, contents, batchSize)`.
- Versões semânticas: `EMBEDDING_VERSION = 'phase5a-embedding-v1'`, `WEB_ANSWER_VERSION = 'phase5a-web-answer-v1'`, `WEB_STRUCTURED_VERSION = 'phase5a-web-structured-v1'`.
- `prompts/web-answer.v1.ts`: prompt do chat com regra anti-instrução-em-documento e exigência de fontes com `documentPageId`; `structured-answers` no worker resolve intenção estruturada por template (sem LLM).

### `apps/worker`

- `config.ts`: `EMBEDDINGS_ENABLED`, `EMBEDDINGS_PROVIDER` (`openai|fake`), `EMBEDDINGS_MODEL`, `EMBEDDINGS_DIMENSION`, `EMBEDDINGS_API_KEY`, `EMBEDDINGS_TIMEOUT_MS`, `EMBEDDINGS_BATCH_SIZE`, `EMBEDDINGS_QUEUE_ATTEMPTS/BACKOFF`, `EMBEDDINGS_WORKER_CONCURRENCY` e todo o bloco de conversa (`CHAT_ENABLED`, `CHAT_WORKER_CONCURRENCY`, `CONVERSATION_SESSION_TTL_SECONDS`, `CONVERSATION_RAG_TOP_K`, `CONVERSATION_MAX_CONTEXT_CHARS`, `CONVERSATION_ANSWER_MAX_RETRIES`, `CONVERSATION_QUEUE_ATTEMPTS/BACKOFF`);
- guards `superRefine`: `fake` rejeitado em `NODE_ENV=production` (LLM e embeddings), chave obrigatória para provider real, e `CHAT_ENABLED` exige `AI_PROCESSING_ENABLED` **e** `EMBEDDINGS_ENABLED` (fail-closed antes de qualquer leitura);
- fila `embeddings` + `EmbeddingsIndexer`: gated por `EMBEDDINGS_ENABLED`, ignora tentativa inexistente/antiga e documentos `NEEDS_REVIEW`, pula chunks cujo `embeddingHash` já corresponde ao provider/modelo/versão correntes (reindexação crash-safe), grava só os pendentes em transação e registra `AIUsage` (`operation='embedding'`, `inputHash` por job); backfill controlado em `apps/worker/scripts/backfill-embeddings.ts`;
- fila `conversation-answers` + `ConversationAnswerPipeline`: gated por `CHAT_ENABLED`, resolve intenção estruturada primeiro, RAG autorizado quando necessário, valida fontes (`documentPageId` real e no escopo), persiste `sources` (vazio → `JsonNull`) e rebaixa para `INSUFFICIENT_EVIDENCE_ANSWER` se o modelo citar fonte inventada; retries limitados no JSON estruturado (`CONVERSATION_ANSWER_MAX_RETRIES`); todo o corpo do `process()` roda dentro de um `try/catch` único, então qualquer falha de banco (inclusive na re-checagem de autorização) grava `FAILED` com `failure_reason` em vez de deixar a mensagem `PENDING` indefinidamente;
- `AuthorizedRetriever` (retrieval.ts): allowlist = documentos da proposição (vínculos O(N)) **+** documentos das respostas associadas; consulta SQL aplica `d.id IN (...::uuid)` antes de `ORDER BY c.embedding <=> $1::vector LIMIT $2`, `DISTINCT ON (page_id)`, apenas tentativa corrente (`pa.attempt = d.processing_attempt`, `pa.status='COMPLETED'`) e apenas a versão de embeddings corrente; `embedQuery` usa o mesmo `EmbeddingProvider` configurado;
- `outbox-dispatcher.ts`: `DocumentProcessed` → fila `embeddings` (somente `EMBEDDINGS_ENABLED` e tentativa `COMPLETED`); `ConversationAnswerRequested` → fila `conversation-answers` (somente `CHAT_ENABLED`); eventos fora de escopo são consumidos como no-op, sem vazar para o stream.

### `apps/api`

- `ConversationsModule`: `GET /conversations` (lista + sessão ativa), `POST /conversations` (cria, vínculo opcional a proposição, sessão Redis), `GET /conversations/:id`, `POST /conversations/:id/messages` (cria `USER` + `ASSISTANT PENDING` com `inputHash` compartilhado + evento outbox `ConversationAnswerRequested`) e `POST /conversations/:id/sources/:documentId/download` (URL assinada do PDF na página exata, autorizada);
- `app.module.ts` registra o módulo; `environment.ts` ganhou `CONVERSATION_SESSION_TTL_SECONDS` (já tinha `LLM_PROVIDER ['anthropic','openai','fake']`).

### `apps/web`

- tela `/conversas`: lista de conversas, criação com proposição opcional, chat com mensagens e status, polling de resposta, fontes das respostas como links clicáveis (assinadas) e staleness do `ASSISTANT PENDING`; `app-shell.tsx` ganhou o item de navegação; `middleware.ts` protege a rota.

### Bugs reais corrigidos pelos testes

1. **`uuid = text` (Código do PostgreSQL 42883)** no `AuthorizedRetriever`: `Prisma.join(ids)` serializa o array como text contra a coluna `d.id uuid`. Corrigido em `retrieval.ts` com `Prisma.sql`${id}::uuid`` por item. É a classe de bug que só um teste de integração com banco real expõe — unit tests não pegariam.
2. **Serialização de vetor do Prisma**: um array JS inteiro de floats pode ser serializado como `bigint[]`/misto e falhar o cast `::vector` (42846 / "Conversion failed"). As fixtures de integração usam agora vetores uniformemente fracionários (como os providers reais emitem); o comportamento em produção é seguro.
3. **`DocumentChunk` sem `MessageRole` em fixture**: import inapropriado do enum corrigido durante o lint.

### Revisão ampla de segurança/robustez (pós-entrega)

1. **Falha de banco deixava a mensagem `PENDING` para sempre**: a re-checagem de autorização (e as leituras iniciais de mensagem) rodavam **fora** do `try/catch` do `ConversationAnswerPipeline.process()`; se o banco falhasse nesse ponto, nenhum `fail()` era chamado e a mensagem permanecia `PENDING` mesmo após os retries do BullMQ se esgotarem. Corrigido movendo todo o corpo do `process()` para dentro do mesmo `try/catch` — qualquer erro de banco grava `FAILED` com `failure_reason`. Teste unitário novo cobre o caminho de rejeição (`banco indisponível` → `FAILED`).
2. **Providers de LLM sem timeout de requisição**: `AnthropicProvider`/`OpenAIProvider` construíam o SDK sem `timeout`, enquanto `OpenAIEmbeddingProvider` já respeitava `EMBEDDINGS_TIMEOUT_MS`; uma chamada travada seguraria a thread do worker muito além do `lockDuration` do BullMQ. `createLLMProvider` e os dois providers agora aceitam `timeoutMs`, alimentado por `AI_REQUEST_TIMEOUT_MS` em `main.ts` (paridade com embeddings).

## Testes

132 testes novos/atualizados, todos com fixtures sintéticas, nenhum dependente de API externa:

- **`packages/ai` (39, `node:test`)**: `embeddings.test.ts` (hash com separador NUL — sem colisão de concatenação —, batching, versionamento), `fake-embedding.provider.test.ts`, `openai-embedding.provider.test.ts` e `openai.provider.test.ts` (stub do client, sem rede), fábricas e schemas existentes atualizados.
- **`apps/worker` unit (34, Jest)**: `embeddings-indexer.spec.ts` (desabilitado = sem leitura; tentativa ausente/antiga; `NEEDS_REVIEW` fail-closed; idempotência por hash; grava só pendentes e registra `AIUsage`), `conversation-answer-pipeline.spec.ts` (injeção adversária não altera a verdade do banco; injeção pura retorna `null`; deny-by-default sem proposição e sem chamada ao LLM; `CHAT_ENABLED=false` não lê a mensagem e marca `FAILED`; acesso revogado → `FAILED` sem chamada a providers; falha de banco na leitura → `FAILED`), `config.spec.ts` (fake aceito em dev; fake rejeitado em produção para LLM e embeddings; chave obrigatória para provider real; `CHAT_ENABLED` exige IA + embeddings) e demais suítes atualizadas para o novo `WorkerConfig`.
- **`apps/worker` integração (20, Jest + PostgreSQL/pgvector real)**: `retrieval.integration-spec.ts` (6) — **não retorna chunk fora do escopo autorizado mesmo quando ele é o mais similar (mandatório)**; allowlist só com documentos vinculados à proposição (inclui respostas oficiais, exclui demais); filtra para a tentativa corrente; ignora versão de embeddings antiga; allowlist vazio → nenhuma busca; **ordena páginas por relevância semântica, não por UUID (mandatório)**; `conversation-pipeline.integration-spec.ts` (7) — pipeline completo: estruturado sem LLM, RAG com fonte validada, fonte inventada → insuficiência, sem proposição → determinística sem LLM, `CHAT_ENABLED=false` → `FAILED`, duplicação ignorada, **acesso revogado após o envio → `FAILED` sem envio de conteúdo a provider (mandatório)**; `ai-pipeline.integration-spec.ts` (7, Fase 4) sem regressão.
- **`apps/api` (39, Jest)**: `conversations.service.spec.ts` novo + suítes das Fases 1–4 sem regressão.

## Validação executada

| Verificação                                           | Resultado                                                               |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| Prisma validate                                       | passou                                                                  |
| Prisma generate                                       | passou                                                                  |
| Prisma migrate deploy em PostgreSQL limpo             | 7 migrations aplicadas                                                  |
| Prisma migrate diff (banco migrado → datamodel)       | "No difference detected"                                                |
| format check (`prettier --check .`)                   | passou (todos os arquivos)                                              |
| lint (`--max-warnings=0`)                             | passou (0 erros, 0 avisos)                                              |
| typecheck (monorepo)                                  | passou (11 tasks)                                                       |
| testes unitários (`pnpm test`, monorepo)              | 112 passaram, 0 falharam (ai 39 + worker 34 + api 39)                   |
| testes de integração `@fiscaliza/worker` (PostgreSQL) | 20 passaram (retrieval 6 + conversa 7 + IA 7, sem regressão)            |
| build monorepo (`pnpm build`)                         | passou (7 pacotes)                                                      |
| simulação do job `clean-migration` do CI              | passou (deploy em PG limpo + diff vazio + build + integração de worker) |

A validação usou o container PostgreSQL descartável `fiscaliza-5a-test-pg` (porta 5433, credenciais `ci-only`) — nunca o banco de desenvolvimento do usuário; o banco de integração existente foi preservado e um banco limpo `fiscaliza_clean` foi criado/descartado apenas para o teste de deployment.

## CI

`.github/workflows/ci.yml` já rodava `--filter @fiscaliza/worker test:integration` depois da API; com a Fase 5A, esse job passa a executar também as specs de retrieval/conversa em PostgreSQL real. Nenhuma chave real de LLM ou embeddings é usada; `FakeLLMProvider`/`FakeEmbeddingProvider` cobrem 100% dos testes automatizados, e o guard de configuração valida que `fake` nunca fica ativo em produção.

## Teste real do provider

Assim como na Fase 4, nenhuma chave real de `EMBEDDINGS_API_KEY` estava disponível neste ambiente. **Nenhum smoke test com o `OpenAIEmbeddingProvider` real foi executado.** A integração runtime está implementada, tipada e buildada, mas a validação de ponta a end com uma chave real (índice um documento sintético e consulta via chat) fica pendente e deve ser executada manualmente antes de qualquer uso em produção, junto com o smoke do `OpenAIProvider` de chat já registrado na Fase 4.

## Observabilidade

Logs estruturados por etapa (`documentId`, `attempt`, `jobId`, `messageId`, `stage: embeddings|conversation`) via `StructuredLogger`, sem conteúdo de página, prompt completo ou chain-of-thought. `AIUsage` guarda provider/modelo/operação (`web-answer`, `embedding`, ...), tokens, latência e `inputHash`; `ConversationMessage` persistente guarda `provider`, `model`, `answerVersion`, `embeddingVersion`, tokens, latência e `failureReason` por resposta.

## Limites deliberados

- nenhum WhatsApp (inbound, sessão ou envio) foi implementado; `InboundMessage` permanece como scaffold da Fase 5B;
- nenhuma notificação externa por n8n, alerta de prazo ou `ResponseAnalysisCompleted → Notification` foi acionado;
- o chat web só responde com evidência válida da proposição em contexto; pergunta fora de contexto ou sem fonte suficiente recebe resposta explícita de insuficiência determinística;
- a indexação é por tentativa corrente e versão de embeddings; não há reindexação global automática (há `backfill-embeddings.ts` para repor faltantes de forma controlada);
- nenhuma conclusão jurídica é afirmada; apenas fatos documentais rastreáveis a página e trecho;
- documentos reais da Câmara não foram usados em nenhum teste, fixture ou chamada de IA.

## Pendências e decisões institucionais

1. smoke test com `EMBEDDINGS_API_KEY` real (+ `LLM_API_KEY` real, pendente desde a Fase 4) antes de produção;
2. decidir se/quantos pontos de contexto semânticos (top-k, metadata filtering) serão expostos e se haverá mascaramento de PII nos chunks — decisão registrada no `ADR-002-EMBEDDINGS.md`;
3. política de visibilidade do chat para `COUNCILOR` (`/conversas` exige autenticação; o allowlist já é por proposição);
4. definição institucional de quando documentos reais podem ser enviados a providers externos (LGPD), já prevista como padrão fail-closed.

## Conclusão

A Fase 5A fecha o primeiro caminho real de RAG do sistema de forma que a **autorização antecede a busca**: o SQL nunca vê chunks fora do allowlist da proposição, e as fontes só sobrevivem à validação contra páginas reais. A indexação é incremental, idempotente e versionada — reprocessar não altera evidência histórica — e as filas/eventos se integram à infraestrutura existente de outbox/BullMQ. Com a Fase 5A concluída, a Fase 5B (WhatsApp, notificações e alertas) pode consumir as `Conversation`/`ConversationMessage`, o retrieval autorizado e os `AIUsage` já persistidos sem recriar mecanismo de busca nem regra de escopo.
