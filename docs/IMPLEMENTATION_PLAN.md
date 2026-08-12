# Fiscaliza AI — Plano de Implementação

## Estratégia

Entregas pequenas, migráveis e testáveis. Nenhuma fase depende de mocks silenciosos em produção. Integrações ausentes falham de forma explícita e recuperável. Ao fim de cada fase: lint, typecheck, testes, migration em banco limpo, revisão de segurança e atualização dos documentos.

## Fase 0 — Arquitetura e contratos (esta entrega)

**Status:** concluída em 2026-08-07.

- inventário do repositório;
- arquitetura, modelo de dados, pipeline de IA, WhatsApp e segurança;
- schema Prisma completo o suficiente para evitar remodelagem destrutiva;
- plano, riscos e decisões pendentes.

**Saída:** documentação aprovada e migration inicial revisável.

## Fase 1 — Fundação segura e executável (esta entrega)

**Status:** concluída em 2026-08-07. Typecheck, lint, testes, build, Prisma e inspeção visual passaram na entrega original. Na Fase 2, migration e health checks também foram revalidados contra a stack Docker real.

- pnpm/Turborepo TypeScript;
- Docker Compose com PostgreSQL/pgvector, Redis, MinIO, API e web;
- Prisma package, migration inicial e seed de papéis/configurações/admin condicionado a variável;
- NestJS com configuração validada, logs, Helmet, CORS, rate limit e Swagger;
- autenticação JWT + refresh rotativo, RBAC e escopo base;
- CRUD inicial de vereadores e leitura/alteração tipada de configurações;
- health de PostgreSQL, Redis e MinIO;
- Next.js com login, shell responsivo, dashboard operacional inicial e navegação das áreas planejadas;
- testes unitários de autorização/config e integração básica de health/auth quando infraestrutura estiver disponível.

**Critério de aceite:** stack sobe por Compose, migration/seed funcionam, admin faz login, rota protegida respeita papel, health reporta dependências e web não recebe segredos.

## Fase 2 — Ingestão documental

**Status:** implementada e validada em 2026-08-07. Detalhes, evidências, correções e limitações estão em `PHASE_2_REPORT.md`.

- upload multipart e watcher de `/data/inbox`;
- validação MIME/magic bytes, tamanho, SHA-256 e deduplicação;
- MinIO privado e URLs assinadas;
- BullMQ/outbox e estados de processamento;
- extração de PDF por página, densidade textual e OCR condicional;
- páginas, chunks sem embedding e painel de jobs/revisão;
- antivírus/quarentena configurável.

**Critério:** PDF fictício aparece com páginas corretas; duplicata não duplica bytes; falha é reprocessável.

**Resultado:** upload e watcher reais convergem para o mesmo serviço; MinIO privado, ClamAV, outbox/BullMQ, extração física por página, OCR seletivo, chunks sem vetor, URLs assinadas, RBAC, reprocessamento, painel, migration limpa, CI e health checks foram implementados. Nenhuma classificação, LLM, associação ou embedding foi antecipada.

## Fase 3 — Proposições, associação e prazos

**Status:** implementada e validada em 2026-08-07. Detalhes e evidências estão em `PHASE_3_REPORT.md`.

- CRUD completo de requerimentos/indicações, coautoria e vínculos de documentos existentes;
- classificação operacional e sugestões de metadados exclusivamente por regex;
- associação determinística com avaliação/candidatos, sinais explicáveis, threshold e margem;
- respostas 1:N, múltiplos documentos, associação manual, concorrência e histórico append-only;
- `DeadlineService` por tipo com snapshot, dias corridos/úteis, feriados, suspensão e prorrogações imutáveis;
- worker idempotente de `DUE_SOON`/`OVERDUE`, outbox e observabilidade;
- filtros, timeline e telas de proposições, respostas, associações, prazos e feriados;
- versionamento dos derivados documentais por `DocumentProcessingAttempt` para proteger evidências futuras.

**Critério:** associação ambígua nunca vincula; casos de calendário e extensão passam nos testes.

**Resultado:** fluxo operacional completo disponível sem Swagger; migration incremental validada sobre a Fase 2 e em banco limpo; nenhuma chamada a LLM, embedding, RAG ou notificação externa foi adicionada.

## Fase 4 — IA estruturada e revisão

**Status:** implementada e validada em 2026-08-08 com fixtures sintéticas e `FakeLLMProvider`. Detalhes em `PHASE_4_REPORT.md`.

- `LLMProvider`, `AnthropicProvider` e `FakeLLMProvider` sem acoplamento de domínio (`createLLMProvider`);
- prompts e schemas Zod versionados; evidência evoluída para `documentPageId` imutável;
- decomposição distinta de requerimento/indicação, com `RequestedItem` versionado (`extractionAnalysisId`, `sourceDocumentPageId`, `active`);
- análise cumulativa item a item por lote de páginas, merge determinístico entre lotes, evidência validada e resumo executivo derivado dos itens;
- repair/retry controlado (`AI_MAX_RETRIES`), cache por `inputHash` único e `AIUsage` por chamada;
- fila `ai-processing` assíncrona, `AI_PROCESSING_ENABLED` fail closed;
- revisão humana append-only (`AnalysisRevision`) e tela dedicada na proposição;
- fixture crítica completo/parcial/não respondido, complementação cumulativa, versionamento entre tentativas, evidência/trecho inventados, prompt injection, indicação e JSON inválido — todos cobertos por teste automatizado.

**Critério:** nenhum JSON/evidência inválido persiste; fixture crítica mantém três estados; alteração humana preserva original. Todos atendidos e testados (ver `PHASE_4_REPORT.md`).

## Fase 5A — RAG web autorizado (implementada)

**Status:** implementada e validada em 2026-08-11 com PostgreSQL/pgvector real e fixtures sintéticas. Detalhes em `PHASE_5A_REPORT.md` e decisão de arquitetura em `adr/ADR-002-EMBEDDINGS.md`.

- `EmbeddingProvider` (`createEmbeddingProvider`) separado do provider de chat, com `EMBEDDINGS_*` próprias e `fake` rejeitado em produção;
- indexação incremental e idempotente (provider/modelo/versão/hash por chunk), restrita à tentativa corrente, com backfill controlado e índice HNSW de pgvector;
- consultas estruturadas resolvidas no PostgreSQL antes do RAG; filtro de autorização aplicado no SQL antes do `ORDER BY`/`LIMIT` — nunca "busca global e filtra em memória";
- conversa web e sessão Redis; respostas com fontes validadas e URL assinada da página exata; `ConversationMessage` persistindo provider/modelo/tokens/latência/versões; `AIUsage` por operação;
- fila `conversation-answers` consumindo `ConversationAnswerRequested`; `DocumentProcessed` alimenta a fila `embeddings` somente com `EMBEDDINGS_ENABLED=true`.

**Critério atendido:** o vereador consulta apenas os documentos autorizados da proposição (anexos + respostas); um chunk mais similar de documento não autorizado nunca entra no resultado; pergunta sem fonte suficiente recebe resposta explícita de insuficiência.

## Fase 5B — WhatsApp e notificações (pendente)

- inbound UAZAPI via n8n com idempotência e identidade E.164;
- `ResponseAnalysisCompleted` → `Notification` → workflow n8n;
- retries/status de entrega e alertas de prazo;
- workflows e payloads de exemplo importáveis.

**Critério:** mensagem duplicada não duplica resposta; notificação só sai após análise.

## Fase 6 — Endurecimento e operação piloto

- observabilidade, OpenTelemetry/error tracking, métricas de filas/IA;
- retenção, classificação e mascaramento inicial;
- backups/restauração, antivírus, scans e testes de carga/segurança;
- acessibilidade, treinamento, runbooks e piloto com dados controlados;
- políticas de custo, reprocessamento e revisão de falsos positivos.

**Critério:** checklist de produção aprovado por TI, jurídico/LGPD e usuários da Secretaria.

## Backlog pós-MVP

- minuta de complementação com revisão humana obrigatória;
- consultas multi-documento avançadas;
- comparação histórica neutra com fontes;
- SSO/MFA, classificação automatizada assistida e políticas de retenção completas;
- alta disponibilidade e storage/LLM alternativos.

## Riscos técnicos

| Risco                               | Impacto                             | Mitigação                                                                     |
| ----------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------- |
| PDFs digitalizados/ruins            | itens e evidências incorretos       | OCR por página, confiança, revisão e original visível                         |
| Numeração ambígua                   | resposta ligada à proposição errada | chave composta, múltiplos sinais, threshold+margem, revisão                   |
| Alucinação de página/valor          | perda de confiança institucional    | validação contra `DocumentPage`, evidência obrigatória                        |
| Vazamento por RAG/URL               | incidente LGPD                      | escopo SQL, deny-by-default, URL curta e testes IDOR                          |
| Mudança de modelo/provider          | regressão/custo                     | provider abstrato, prompt/schema versionados, golden tests e cache versionado |
| Regra de prazo municipal específica | prazo incorreto                     | configuração/snapshot, suíte de calendário e aprovação jurídica               |
| UAZAPI/n8n indisponível             | mensagens perdidas/duplicadas       | fila, outbox, idempotência, callbacks e reconciliação                         |
| pgvector com dimensão variável      | reindexação complexa                | provider de embedding separado e versão do índice                             |
| Dados sensíveis em SaaS LLM         | risco contratual/LGPD               | minimização, aprovação do operador e opção futura on-premise                  |
| Seed/bootstrap inseguro             | tomada de conta                     | senha obrigatória via segredo, troca e auditoria                              |

## Decisões que precisam de validação da Câmara

As decisões abaixo não bloqueiam a fundação; defaults conservadores serão usados até aprovação:

1. Validar institucionalmente os defaults versionados de contagem (`EXCLUDE_START_DATE`, ajuste para `NEXT_BUSINESS_DAY`) e o efeito formal da suspensão.
2. Calendário de feriados: municipal/estadual/nacional e expediente excepcional.
3. Confirmar se `INDICATION` possui prazo formal; a arquitetura já usa política independente por tipo, mas o default inicial é igual ao de requerimento.
4. Origem/unidade na chave quando houver numeração duplicada entre legislaturas/setores.
5. Política de visibilidade entre vereadores, assessores, Secretaria e Auditoria.
6. Classificação, retenção, base legal e possibilidade de enviar conteúdo ao provider LLM escolhido.
7. UAZAPI: formato/assinatura real do webhook, limites, instâncias e garantia de idempotência no envio.
8. Confirmar se Tesseract local atende a qualidade/volume de produção e escolher provider/dimensão de embedding antes da Fase 5.
9. Canal de alerta, antecedência e destinatários de cada tipo de prazo.
10. Infraestrutura alvo, domínio, TLS, backup, RPO/RTO e secret manager.

## Decisões técnicas de baixo risco adotadas

- pnpm workspaces/Turborepo;
- UTC no banco e timezone IANA no cálculo;
- access JWT curto + refresh opaco rotativo;
- Argon2id;
- outbox transacional;
- bucket privado e URLs assinadas;
- Problem Details e IDs de correlação;
- configuração tipada persistida em JSON com versão/auditoria;
- testes fictícios sem dados pessoais reais.
- worker documental separado da API;
- uma fila documental tipada por tentativa, com outbox e job ID determinístico;
- ClamAV via `DocumentSecurityScanner` e Tesseract/Poppler via `OcrProvider` substituível;
- chunks confinados à página e `embedding = NULL` durante toda a Fase 2.
- derivados imutáveis por `DocumentProcessingAttempt`, conforme ADR-001;
- coautoria N:N com exatamente um autor principal;
- associação determinística com pesos normalizados e decisão conjunta por threshold+margem;
- `Deadline.configurationSnapshot` com política e calendário aplicável;
- pedido de prorrogação separado da alteração efetiva do vencimento;
- versões otimistas e constraints parciais para operações concorrentes.
