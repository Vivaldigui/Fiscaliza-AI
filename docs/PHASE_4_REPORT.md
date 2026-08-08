# Relatório da Fase 4 — IA estruturada, evidências e revisão humana

**Data da entrega:** 2026-08-08
**Escopo:** extração estruturada de requerimentos/indicações, análise cumulativa de respostas item a item, validação determinística de evidências, resumo executivo, revisão humana append-only e registro de uso de IA — sem RAG geral, embeddings, chat genérico com PDF, WhatsApp ou notificações externas.

## Resultado

Um requerimento sintético de três itens (quantidade de veículos / valor de manutenção / empresas contratadas) é decomposto automaticamente, analisado item a item contra as respostas protocoladas e apresentado com status (`ANSWERED`/`PARTIALLY_ANSWERED`/`NOT_ANSWERED`), explicação, confiança e evidência apontando para a página exata. Uma resposta complementar gera uma nova análise cumulativa sem apagar a anterior. Nenhuma página ou trecho inventado pelo modelo é persistido. `AI_PROCESSING_ENABLED=false` por padrão impede qualquer chamada externa.

## Gate inicial e preservação das fases anteriores

A Fase 3 estava mergeada em `origin/main` via PR #2 (`fd13434`), não na branch de trabalho anterior como o enunciado presumia — a branch `agent/fase-3-proposicoes-prazos` só tinha sido mergeada remotamente. O gate confirmou isso (`git fetch` + `gh pr view`) antes de qualquer alteração, e a Fase 4 foi implementada em `agent/fase-4-ia-evidencias-revisao`, criada a partir do `main` atualizado.

Antes de codar, foram lidos integralmente: README, `ARCHITECTURE.md`, `DATA_MODEL.md`, `AI_PIPELINE.md`, `DOCUMENT_PIPELINE.md`, `ASSOCIATION_ENGINE.md`, `DEADLINE_POLICY.md`, `PHASE_3_REPORT.md`, `SECURITY.md`, `ADR-001`, `packages/database/prisma/schema.prisma` e todo `packages/ai/` (que já continha um scaffold inativo de prompts/schemas/`AnthropicProvider` preparado na Fase 3).

## Segurança de dados locais

`data/proposicoes-itanhandu/` (PDFs reais baixados por `scripts/baixar_proposicoes_itanhandu.py`, um script de coleta pública inspecionado e sem segredos) e `scripts/` já existiam como diretórios não rastreados no worktree. `data/proposicoes-itanhandu/` foi adicionado ao `.gitignore`; nenhum documento real foi lido, resumido, usado como fixture ou enviado a um provider de IA durante esta entrega. Nenhum diretório local foi apagado.

## Implementado

### Schema e migration

- `RequestedItem` ganhou `extractionAnalysisId` (aponta para a `Analysis` de extração que o produziu), `sourceDocumentPageId` (imutável, `DocumentPage`) e `active` (permite reextração não destrutiva);
- a unicidade de `(propositionId, sequence)` passou a ser um índice parcial sobre `active = true`, seguindo o mesmo padrão de índices parciais já usado na Fase 3;
- migration incremental `202608080100_phase4_ai_extraction_analysis`, sem editar migrations anteriores; inclui o seed determinístico de `analysis.confidence.normal`/`analysis.confidence.warning` via `ON CONFLICT DO NOTHING` (ausente das migrations anteriores, presente só no seed opcional — corrigido para não depender de seed em ambientes limpos);
- validada por: `prisma validate`, `prisma generate`, `prisma migrate deploy` em PostgreSQL limpo (5 migrations aplicadas), e `prisma migrate diff` contra o schema resultando em diff vazio.

`Analysis`, `AnalysisItem`, `AnalysisDocument`, `Evidence`, `AnalysisRevision` e `AIUsage` já existiam desde a Fase 3 (preparados para a Fase 4) e não precisaram de alteração de schema.

### `packages/ai`

- `evidenceSchema` evoluído de `documentId + pageNumber` para `documentPageId + pageNumber` — o contrato estruturado agora exige o identificador imutável, não apenas um número de página mutável;
- `requestExtractionSchema`, `indicationExtractionSchema`, `executiveSummarySchema` novos;
- `FakeLLMProvider`: dublê determinístico, em processo, para testes e CI — nunca usado em produção (rejeitado pela validação de ambiente do worker quando `NODE_ENV=production`);
- `createLLMProvider`: fábrica que escolhe `AnthropicProvider`/`FakeLLMProvider` a partir de configuração; nenhum domínio importa o SDK Anthropic;
- `StructuredOutputValidationError`: erro tipado carregando a saída bruta pré-validação, para repair/retry sem re-adivinhar o que falhou;
- `computeInputHash`: hash determinístico de cache/idempotência;
- `pipeline.ts`: motor puro de extração/análise/resumo — batching exaustivo por página, merge determinístico entre lotes, retry/repair limitado (`AiValidationExhaustedError` ao esgotar);
- prompts reforçados contra prompt injection, superinterpretação de indicação e chain-of-thought.

### `apps/worker`

- fila BullMQ `ai-processing`, `jobId` determinístico `analysis:{analysisId}:input:{inputHash}`, consumindo o evento outbox `AnalysisRequested`;
- `AiAnalysisPipeline`: orquestra extração (reaproveitando itens ativos existentes ou criando um novo conjunto versionado), análise cumulativa de todas as respostas na tentativa de processamento corrente de cada documento, validação de evidência, resumo executivo e persistência atômica;
- `evidence-validator.ts`: normalização Unicode/espaços e verificação de que o trecho citado realmente existe na página;
- `AI_PROCESSING_ENABLED=false` (padrão) faz o job falhar de forma clara e recuperável sem qualquer chamada externa;
- novas variáveis: `AI_PROCESSING_ENABLED`, `AI_REQUEST_TIMEOUT_MS`, `AI_MAX_RETRIES`, `AI_JOB_CONCURRENCY`, `AI_MAX_PAGES_PER_BATCH`, `AI_MAX_INPUT_CHARS`, `AI_QUEUE_ATTEMPTS`, `AI_QUEUE_BACKOFF_MS`, `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`.

### `apps/api`

- `AnalysesModule`: `POST/GET /propositions/:id/analyses`, `GET /analyses/:id`, `POST /analyses/:id/review`, `POST /analyses/:id/reanalyze`;
- `AnalysesService.create` calcula `inputHash` (documentos/tentativas das respostas + promptVersion + schemaVersion + provider + modelo) e reaproveita uma análise existente com o mesmo hash — impede análises idênticas simultâneas e implementa o cache sem exigir participação do worker;
- `AI_PROCESSING_ENABLED=false` faz a criação retornar `503` explícito, sem criar `Analysis` fantasma;
- revisão humana (`ADMIN`/`SECRETARIAT`) cria `AnalysisRevision` append-only; `AUDITOR` só lê.

### `apps/web`

- painel de análise na página da proposição: resumo executivo, contagem por status, itens lado a lado (pergunta à esquerda, status/explicação/confiança/evidências à direita), histórico de análises anteriores, ação "Executar análise"/"Analisar novamente", revisão manual inline;
- evidência clicável abre o PDF na página exata via a mesma URL assinada já usada pela tela de documentos (`#page=N`);
- status apresentado com ícone + texto, não apenas cor.

### Correção pontual solicitada

`deadline-calculator.ts#assertIsoDate` aceitava datas civis impossíveis (`2026-02-31` virava `2026-03-03` via `Date.parse` tolerante). Substituída por validação de calendário real (dias no mês, incluindo bissexto) sem alterar a política institucional. Teste de regressão adicionado (`deadline-calculator.spec.ts`).

## Testes

20 testes novos, nenhum dependente de API externa:

**`packages/ai/src/pipeline.test.ts`** (11, `node:test`, sem banco):
extração rejeita `sourceDocumentPageId` inventado; extração ignora prompt injection; extração esgota tentativas com JSON inválido; análise distingue `ANSWERED`/`PARTIALLY_ANSWERED`/`NOT_ANSWERED` com evidência correta por item; análise não persiste evidência fora do conjunto de páginas; análise consolida lotes grandes sem perder página; indicação não converte encaminhamento em `EXECUTION_REPORTED`; 4 testes de schema já existentes atualizados para `documentPageId`.

**`apps/worker/src/ai/evidence-validator.spec.ts`** (4, Jest, sem banco): aceita trecho real com reflow de espaço/quebra de linha; rejeita trecho inventado; aceita evidência visual sem trecho; normaliza acentuação/caixa.

**`apps/worker/src/ai/ai-pipeline.integration-spec.ts`** (7, Jest + PostgreSQL real): fixture crítica de três itens (completo/parcial/não respondido) com evidência na página correta; evidência com `documentPageId` inventado não persiste e o item vai para `NEEDS_HUMAN_REVIEW`; extração é reaproveitada (idempotência) entre duas análises da mesma versão documental; JSON inválido esgota tentativas e marca `Analysis` como `FAILED` sem persistir itens; resposta complementar gera nova análise cumulativa sem alterar a anterior; reprocessamento documental (nova `DocumentProcessingAttempt`) não altera a evidência da análise histórica; `AI_PROCESSING_ENABLED=false` bloqueia o processamento sem nenhuma chamada ao provider.

## Validação executada

| Verificação                                           | Resultado                                            |
| ----------------------------------------------------- | ---------------------------------------------------- |
| Prisma validate                                       | passou                                               |
| Prisma generate                                       | passou                                               |
| Prisma migrate deploy em PostgreSQL limpo             | 5 migrations aplicadas                               |
| Prisma migrate diff após migrations                   | vazio                                                |
| format check                                          | passou                                               |
| lint                                                  | passou (0 erros, 0 avisos)                           |
| typecheck (7 pacotes)                                 | passou                                               |
| testes unitários (`pnpm test`, todo o monorepo)       | 66 passaram, 0 falharam                              |
| testes de integração `@fiscaliza/api` (PostgreSQL)    | 2 passaram (Fase 3, sem regressão)                   |
| testes de integração `@fiscaliza/worker` (PostgreSQL) | 7 passaram (Fase 4)                                  |
| build monorepo (`pnpm build`, 7 pacotes)              | passou                                               |
| simulação completa do job `clean-migration` do CI     | passou (deploy + build + integração de API e worker) |

A simulação usou um PostgreSQL descartável (`pgvector/pgvector:pg16` em container efêmero, removido ao final), nunca o banco de desenvolvimento do usuário — o volume Docker local já em uso teve uma divergência de credencial entre `.env` e o banco persistido (mesma classe de problema já registrada no `PHASE_3_REPORT.md`), então a validação de migration/testes de integração foi feita isoladamente, sem tocar os dados existentes do usuário.

## CI

`.github/workflows/ci.yml` atualizado: o job `clean-migration` agora também builda `@fiscaliza/worker` e roda `pnpm --filter @fiscaliza/worker test:integration` depois dos testes de integração da API, na mesma sequência (deploy → generate → build → testes). Nenhuma chave de API real é usada; `FakeLLMProvider` cobre 100% dos testes automatizados.

## Teste real do provider

`LLM_API_KEY` não estava disponível neste ambiente (`.env` local tem o campo vazio). **Nenhum smoke test contra a Anthropic real foi executado.** A integração runtime (`AnthropicProvider`, `createLLMProvider`, wiring do worker) está implementada e coberta por `pnpm --filter @fiscaliza/ai typecheck`/`build`, mas a validação de ponta a ponta com uma chave real fica pendente e deve ser executada manualmente, com documento sintético, antes de qualquer uso em produção.

## Observabilidade

`AiAnalysisPipeline` registra logs estruturados por etapa (`analysisId`, `jobId`, status, contagem de itens) via `StructuredLogger`, sem nunca logar conteúdo de página, prompt completo ou chain-of-thought. `AIUsage` registra provider, modelo, operação, tokens, latência e `promptVersion`/`analysisVersion` por chamada; `estimatedCost` fica `null` (nenhuma tabela de preço foi configurada ou inventada).

## Limites deliberados

- nenhum embedding, RAG, chat genérico ou WhatsApp foi implementado;
- resumo executivo é gerado a partir dos itens/evidências já validados, nunca do PDF bruto;
- a aplicação nunca afirma fraude, crime, improbidade ou descumprimento legal — apenas fatos documentais rastreáveis;
- `RESPONSE_RECEIVED`/`RESPONDED` continuam distintos; o `Deadline` nunca é alterado pela análise semântica;
- documentos reais da Câmara não foram usados em nenhum teste, fixture ou chamada de IA.

## Pendências e decisões institucionais

Não são falhas de implementação, mas precisam de definição antes da operação oficial:

1. validar com credencial real da Anthropic antes de qualquer uso em produção (nenhum smoke test externo foi executado nesta entrega);
2. aprovar a política de retenção de texto histórico de análises (o banco cresce a cada reextração/reanálise, por desenho — ver ADR-001);
3. decidir se/quando liberar a visibilidade de análise para `COUNCILOR` (hoje restrita a `ADMIN`/`SECRETARIAT`/`AUDITOR`, mesma política já adotada na Fase 3);
4. aprovar contrato e tratamento de dados do provider LLM antes de processar documentos reais da Câmara.

## Conclusão

A camada semântica está estruturada, versionada, auditável e testada com fixtures sintéticas e um provider determinístico. Nenhuma página ou trecho inventado sobrevive à validação; nenhuma análise histórica é alterada por reprocessamento ou reanálise; a IA nunca é a fonte da verdade. A Fase 5 poderá consumir `Analysis`/`AnalysisItem`/`Evidence` estruturados para RAG, chat e WhatsApp sem recriar a lógica de fiscalização aqui construída.
