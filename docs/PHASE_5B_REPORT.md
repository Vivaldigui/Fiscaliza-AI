# Relatório da Fase 5B — WhatsApp, notificações e alertas

**Data da entrega:** 2026-08-12
**Escopo:** inbound WhatsApp via n8n/UAZAPI com autenticação HMAC e
idempotência, sessão Redis, identidade E.164 com autorização determinística,
reutilização do pipeline de conversa/RAG da Fase 5A, notificação de autores
após `ResponseAnalysisCompleted`, alertas de prazo idempotentes, entrega por
n8n com callbacks de status, retries, painel operacional, auditoria e
workflows n8n importáveis — sem nova arquitetura de embeddings/RAG, sem análise
jurídica, sem envio de documentos reais e sem deploy automático.

## Gate inicial e preservação das fases anteriores

O gate confirmou o estado de `main` (`git fetch`; branch `main` em
`6fb1fb0`, Fase 5A mergeada pelo PR #5 — merge `93fc30f`), verificou que não há
PRs abertos e que `scripts/baixar_proposicoes_itanhandu.py` (não rastreado)
permanecia intocado. A Fase 5B foi implementada em
`codex/fase-5b-whatsapp-notificacoes` criada a partir do `main` atualizado,
**sem editar nenhuma migration anterior** (a nova é
`202608120100_phase5b_whatsapp_notifications`). Nenhum PDF real foi lido,
usado como fixture ou enviado a qualquer provider.

## Implementado

### Schema (migration incremental)

- `NotificationType` enum; `Notification` com `type`, `templateVersion`,
  `identityId`, `destinationPhone`, `analysisId`, `deadlineId` e
  `recipientId` opcional;
- `NotificationDeliveryAttempt` (histórico append-only de tentativas);
- `Conversation.whatsappIdentityId`;
- `InboundMessage.identityId/conversationId/conversationMessageId`;
- índices de consulta/auditoria para os novos campos.
- Validada por `prisma validate`, `db:generate`, `migrate deploy` em
  PostgreSQL limpo (8 migrations) e `migrate diff` vazio.

### `packages/shared`

- `normalizePhoneE164`, `maskPhone`, `phoneFingerprint`,
  `createHmacSignature`/`signaturePayload`/`safeSignatureEqual` (constant-time)
  e `whatsappSessionKey` — reutilizados por API e worker.

### `apps/api`

- `IntegrationsWhatsappModule`:
  - `POST /integrations/whatsapp/inbound` (HMAC + timestamp/replay + tamanho +
    rate limit por telefone); idempotência `(instance, messageId)` com
    `payloadHash`; mesmo ID com payload diferente → 409 + auditoria; número
    desconhecido/inativo/não verificado → resposta neutra e auditoria
    `WHATSAPP_IDENTITY_DENIED`, sem busca, RAG ou LLM;
  - `POST /integrations/whatsapp/delivery-callback` com validação de
    transições (DELIVERED terminal; sem regressão);
  - admin de identidades (listar com telefone mascarado, verificar, desativar)
    e `overview` do painel;
  - `WhatsappSessionService` (Redis, TTL configurável,
    `whatsapp:session:{instance}:{identityId}`);
  - `IntegrationSignatureGuard` com `rawBody` habilitado e limite de corpo.
- `NotificationsModule`: `GET /notifications` (filtros), `GET /notifications/:id`
  (com tentativas), `POST /notifications/:id/retry` e `/cancel`;
  `ADMIN`/`SECRETARIAT` operam, `AUDITOR` é read-only; payload integral e
  telefone completo nunca retornados.
- `environment.ts` valida as novas variáveis e **falha em produção** quando
  `WHATSAPP_ENABLED=true` sem `N8N_WEBHOOK_SECRET`/`N8N_WEBHOOK_BASE_URL`.

### `apps/worker`

- fila `notification-delivery` + `NotificationDeliveryPipeline`
  (`N8nWebhookDeliveryProvider` assinado, timeout, retries limitados, claim
  concorrente, `NotificationDeliveryAttempt` por tentativa, auditoria);
- fila `notification-factory` + `NotificationFactory`: consome
  `ResponseAnalysisCompleted` (somente `REQUEST_RESPONSE`/`INDICATION_RESPONSE`
  em `COMPLETED`, com contagem real de `ANSWERED`/`PARTIALLY_ANSWERED`/
  `NOT_ANSWERED`) e `DeadlineApproaching`/`DeadlineExpired`; idempotente por
  `idempotencyKey`; criação e outbox na mesma transação;
- fila `notification-reconciliation` (re-enfileira pendentes, reseta
  `PROCESSING` presos, finaliza `FAILED` com tentativas esgotadas);
- `WhatsappContextResolver`: seleção em linguagem natural
  (“requerimento 38/2026”, “indicação 12/2026”) **somente entre proposições
  autorizadas**, ambiguidade vira pergunta de esclarecimento, restauração da
  sessão Redis;
- `ConversationAnswerPipeline` reutilizado para WhatsApp: revalida identidade
  ativa/verificada e usuário ativo antes de qualquer RAG/LLM, aplica o resolver
  de contexto e, ao concluir resposta em canal WHATSAPP, cria a
  `Notification` de resposta (`whatsapp-reply:<messageId>`);
- `ai-pipeline`: emite o evento derivado `ResponseAnalysisCompleted` quando a
  análise de resposta termina `COMPLETED` (sem tocar em `AnalysisCompleted`);
- `OutboxDispatcher`: mapeia `NotificationCreated`/`NotificationRetryRequested`
  → entrega; `ResponseAnalysisCompleted` → factory; `DeadlineApproaching`/
  `DeadlineExpired` → factory.

### `apps/web`

- `/whatsapp`: identidades (telefone mascarado, instância, verificada/ativa,
  usuário vinculado, última atividade, respostas pendentes, ações de
  verificação/desativação);
- `/notificacoes`: tipo, destinatário mascarado, status, tentativas, data,
  erro sanitizado, `externalMessageId`, reenviar/cancelar (conforme RBAC) e
  filtros.

### n8n

- `whatsapp-inbound.workflow.example.json` (UAZAPI → backend assinado);
- `notification-delivery.workflow.example.json` (backend → n8n → UAZAPI →
  callback de status, com `idempotencyKey` e validação de assinatura);
- `response-analysis-notification` e `deadline-alert` como referências de
  filtro que delegam ao fluxo consolidado de entrega.
- Nenhum JSON contém credenciais; variáveis documentadas via `$env.*`.

## Testes

Nenhum teste exige SaaS externo; `FakeLLMProvider`/`FakeEmbeddingProvider`
cobrem IA e a entrega usa fakes explícitos de n8n (proibidos em produção pela
validação de configuração). Cobertura dos cenários obrigatórios:

| #   | Cenário                                    | Onde                                                                                   |
| --- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| 1   | inbound válido                             | api `whatsapp-inbound.service.spec.ts`                                                 |
| 2   | assinatura inválida                        | api `whatsapp-signature.guard.spec.ts`                                                 |
| 3   | timestamp expirado                         | api `whatsapp-signature.guard.spec.ts`                                                 |
| 4   | mensagem duplicada                         | api `whatsapp-inbound.service.spec.ts`                                                 |
| 5   | mesmo messageId com payload diferente      | api `whatsapp-inbound.service.spec.ts`                                                 |
| 6   | mesmo messageId em instâncias diferentes   | api `whatsapp-inbound.service.spec.ts`                                                 |
| 7   | telefone desconhecido sem LLM              | api `whatsapp-inbound.service.spec.ts`                                                 |
| 8   | identidade inativa                         | api `whatsapp-inbound.service.spec.ts` + worker `conversation-answer-pipeline.spec.ts` |
| 9   | identidade não verificada                  | api `whatsapp-inbound.service.spec.ts` + worker                                        |
| 10  | usuário sem acesso                         | worker `conversation-answer-pipeline.spec.ts`                                          |
| 11  | acesso revogado entre recebimento e worker | worker unit + `whatsapp-flow.integration-spec.ts`                                      |
| 12  | coautor autorizado                         | worker `whatsapp-flow.integration-spec.ts`                                             |
| 13  | seleção “Requerimento 38/2026”             | worker `whatsapp-context-resolver.spec.ts` + integração                                |
| 14  | contexto ambíguo                           | worker `whatsapp-context-resolver.spec.ts`                                             |
| 15  | sessão Redis expirada                      | worker `whatsapp-context-resolver.spec.ts`                                             |
| 16  | reutilização do ConversationAnswerPipeline | worker `whatsapp-flow.integration-spec.ts`                                             |
| 17  | fonte fora do escopo rejeitada             | `retrieval.integration-spec.ts` (Fase 5A, sem regressão)                               |
| 18  | AnalysisCompleted idempotente              | worker `notification-factory.spec.ts`                                                  |
| 19  | nenhuma notificação antes de COMPLETED     | worker `notification-factory.spec.ts`                                                  |
| 20  | NEEDS_HUMAN_REVIEW sem notificação         | worker `notification-factory.spec.ts`                                                  |
| 21  | contagem respondido/parcial/não            | worker `notification-factory.spec.ts`                                                  |
| 22  | DeadlineApproaching idempotente            | worker `notification-factory.spec.ts`                                                  |
| 23  | DeadlineExpired idempotente                | worker `notification-factory.spec.ts`                                                  |
| 24  | retry com backoff                          | worker `notification-delivery-pipeline.spec.ts`                                        |
| 25  | limite máximo de tentativas                | worker `notification-delivery-pipeline.spec.ts`                                        |
| 26  | callback inválido                          | api `whatsapp-callback.service.spec.ts`                                                |
| 27  | callback atrasado sem regressão            | api `whatsapp-callback.service.spec.ts`                                                |
| 28  | duas entregas concorrentes                 | worker unit + `notification-delivery.integration-spec.ts`                              |
| 29  | painel RBAC/IDOR                           | api `notifications.service.spec.ts` (metadados de roles)                               |

## Validação executada

| Verificação                              | Resultado                         |
| ---------------------------------------- | --------------------------------- |
| Prisma validate / generate               | passou                            |
| migrate deploy em PostgreSQL limpo       | 8 migrations                      |
| migrate diff (banco migrado → datamodel) | vazio                             |
| format check                             | passou                            |
| lint (`--max-warnings=0`)                | passou                            |
| typecheck (monorepo)                     | passou (11 tasks)                 |
| testes unitários                         | api 69 + worker 64 + ai/shared ok |
| integração worker (PostgreSQL/pgvector)  | 27 passaram                       |
| build monorepo                           | passou (7 pacotes)                |

A validação usou o container descartável `fiscaliza-5b-test-pg` (porta 5433),
nunca o banco de desenvolvimento do usuário.

## Limitações e decisões pendentes

1. **UAZAPI/n8n reais não validados neste ambiente** (sem credenciais): o
   contrato foi implementado contra fixtures sintéticas e os workflows de
   exemplo; **a integração externa real NÃO é declarada validada** e exige
   smoke test com a instalação real antes de produção.
2. Decidir institucionalmente a política de alertas de prazo (canais,
   antecedência, destinatários, tipos de proposição) — hoje configurável por
   variáveis e por `SystemSetting`.
3. Aprovar o tratamento LGPD do número no webhook para o n8n (necessário à
   entrega) e a visibilidade entre gabinetes.
4. `whatsapp.neutralReply` foi adicionado às configurações seed iniciais;
   validar o texto oficial.

## Conclusão

A Fase 5B fecha o caminho de WhatsApp sem duplicar a Fase 5A: o webhook HTTP é
assíncrono e persistente, a autorização é determinística e acontece antes de
qualquer busca, o `ConversationAnswerPipeline`/`AuthorizedRetriever` são
reutilizados tal como estão, e as notificações/alerta de prazo usam o mesmo
modelo idempotente de entrega com histórico de tentativas, retries limitados e
callbacks com validação de transição. Com a suíte verde e a migration limpa, a
Fase 5B pode ser revisada para o PR; a Fase 6 permanece fora de escopo.
