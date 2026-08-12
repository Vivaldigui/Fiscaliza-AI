# Fiscaliza AI

Aplicação interna, estruturada e auditável para acompanhar requerimentos, indicações, respostas, evidências e prazos de uma Câmara Municipal. Esta entrega implementa as **Fases 4 (IA estruturada, evidências e revisão humana)** e **5A (RAG web autorizado com embeddings)** sobre a camada legislativa determinística das Fases 1–3.

## O que já está implementado

- monorepo TypeScript com NestJS, Next.js, Prisma e contratos compartilhados;
- schema completo de domínio, migration inicial e seed seguro;
- login, access JWT curto, refresh rotativo, cookies HttpOnly, RBAC e auditoria;
- usuários, vereadores, identidades WhatsApp administrativas e configurações versionadas;
- health checks para PostgreSQL, Redis e MinIO;
- dashboard responsivo e acessível com navegação do MVP;
- PostgreSQL/pgvector, Redis, MinIO, API e web via Docker Compose;
- worker BullMQ independente, outbox transacional e watcher de `/data/inbox`;
- upload PDF autenticado, SHA-256 em streaming, deduplicação e quarentena no MinIO privado;
- ClamAV, extração PDF página a página, avaliação de qualidade, OCR condicional e chunks sem embeddings;
- consulta operacional, texto por página, download assinado, revisão e reprocessamento;
- requerimentos e indicações com coautoria, documento principal e anexos sem duplicar o arquivo físico;
- respostas 1:N, complementares e retificações, cada uma com múltiplos documentos;
- caixa operacional para classificar documentos já processados e sugestões determinísticas de tipo/número/ano;
- associação resposta ↔ proposição por sinais explicáveis, threshold e margem, com revisão manual e histórico;
- políticas de prazo separadas por tipo, snapshot de configuração, dias corridos/úteis e feriados;
- pedidos e concessões de prorrogação separados, suspensões, retomadas e concorrência otimista;
- worker com varredura idempotente de prazos e eventos outbox para vencimento/aproximação;
- telas operacionais de proposições, respostas, associações, prazos, feriados, timeline e dashboard;
- abstração `LLMProvider` com `AnthropicProvider`, `OpenAIProvider` (GPT) e `FakeLLMProvider` (dublê determinístico para desenvolvimento/CI), escolhidos por `createLLMProvider`;
- extração estruturada de requerimentos/indicações em itens verificáveis, com origem imutável (`DocumentPage`) e versionamento não destrutivo (`RequestedItem.active`);
- análise cumulativa de respostas item a item, por lote de páginas, com validação determinística de evidência (`documentPageId` + trecho real) e resumo executivo derivado dos itens;
- `AI_PROCESSING_ENABLED=false` por padrão (fail closed): nenhuma chamada externa ocorre sem ativação operacional explícita;
- fila `ai-processing` assíncrona, cache por `inputHash`, `AIUsage` e revisão humana append-only (`AnalysisRevision`);
- tela de análise na proposição: itens, evidências, confiança, histórico e revisão manual;
- contratos e exemplos inativos de workflows n8n;
- abstração `EmbeddingProvider` (`createEmbeddingProvider`) independente do provider de chat, com `OpenAIEmbeddingProvider` e `FakeEmbeddingProvider` (dublê determinístico para dev/CI, rejeitado em produção);
- indexação de embeddings incremental, idempotente e versionada (provider/modelo/versão/hash), restrita à tentativa de processamento corrente de cada documento — reprocessar nunca altera evidência histórica; backfill controlado e índice HNSW de pgvector;
- retrieval autorizado: perguntas estruturadas resolvidas no PostgreSQL antes de qualquer RAG; o conjunto de documentos autorizados da proposição (anexos + respostas oficiais) é aplicado no SQL antes do vetor `ORDER BY`/`LIMIT` — nunca há "busca global e filtro em memória";
- conversa web (`` `/conversas` ``) com fontes clicáveis (URL assinada do PDF na página exata), resposta explícita "sem evidência suficiente", persistência por mensagem de provider/modelo/tokens/latência/versões e sessão Redis temporária.

Embeddings, RAG autorizado e a conversa web foram implementados na **Fase 5A**; WhatsApp end-to-end, notificações externas e alertas de prazo permanecem na Fase 5B de `docs/IMPLEMENTATION_PLAN.md`. A IA não afirma conclusão jurídica — apenas descreve fatos documentais rastreáveis a página e trecho.

## Pré-requisitos

- Node.js 22+
- pnpm 11+
- Docker com Compose

## Configuração local

1. Copie `.env.example` para `.env`.
2. Substitua todos os valores `CHANGE_ME` por segredos locais fortes.
3. Para criar o primeiro administrador, defina `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (mínimo 12 caracteres, sem `CHANGE_ME`) e `SEED_ADMIN_NAME`.

Nunca envie `.env` ao Git. As variáveis `LLM_API_KEY`, `UAZAPI_TOKEN`, `MINIO_SECRET_KEY`, `DATABASE_URL` e segredos JWT não pertencem ao frontend.

## Execução com Docker

```bash
docker compose up -d postgres redis minio minio-init clamav
pnpm install
pnpm db:generate
pnpm db:deploy
pnpm db:seed
docker compose up --build api worker web
```

Ou, depois de existir uma migration e o seed já ter sido executado:

```bash
docker compose up --build
```

- Web: http://localhost:3000
- API: http://localhost:3001/api/v1
- Swagger: http://localhost:3001/api/docs
- Health: http://localhost:3001/health
- Readiness do worker: http://localhost:3002/health/ready
- Console MinIO: http://localhost:9001

PDFs também podem ser colocados em `data/inbox/`. O watcher aguarda estabilidade do arquivo, usa o mesmo pipeline do upload e move a entrada para `processed/`, `processed/duplicates/` ou `rejected/`. Após o processamento, a Secretaria pode classificá-los e vinculá-los pelas telas de Documentos, Proposições e Respostas.

O Compose não inicia n8n; integra-se a uma instalação existente conforme `infra/n8n/README.md`.

## Execução sem containers para API/web

Mantenha PostgreSQL, Redis e MinIO disponíveis, ajuste os hosts de `.env` para `localhost` e execute:

```bash
pnpm install
pnpm db:generate
pnpm db:deploy
pnpm db:seed
pnpm dev
```

## Qualidade

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

O CI também valida Prisma, todas as migrations em PostgreSQL limpo e os testes de integração das Fases 3, 4 e 5A (estes últimos contra PostgreSQL/pgvector real). Todas as fixtures são sintéticas; nenhum teste depende de credencial real de LLM ou de embeddings (`FakeLLMProvider`/`FakeEmbeddingProvider`), e nenhum documento real é usado como fixture. A validação está registrada em `docs/PHASE_3_REPORT.md`, `docs/PHASE_4_REPORT.md` e `docs/PHASE_5A_REPORT.md`.

## Bootstrap e seed

O seed é idempotente para papéis e configurações. Ele só cria/atualiza o administrador quando e-mail e senha são fornecidos juntos. Um placeholder ou senha curta interrompe a operação; nenhuma credencial padrão é embutida no código.

Configurações seed (todas editáveis e auditáveis): políticas de prazo por `REQUEST`/`INDICATION`, prorrogação, modo de contagem, timezone, suspensão, antecedência, confiança de análise, pesos/limiares de associação e limite documental. Cada prazo guarda seu próprio snapshot e não muda retroativamente quando a configuração global é alterada.

## Dados locais reais

`data/proposicoes-itanhandu/` (ignorado pelo Git) pode conter PDFs reais baixados por `scripts/baixar_proposicoes_itanhandu.py`. Esses arquivos nunca são fixture de teste, nunca entram em snapshot/log e não devem ser enviados a um provider de IA externo sem decisão institucional sobre LGPD e classificação.

## Documentação

- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/AI_PIPELINE.md`
- `docs/ANALYSIS_PIPELINE.md`
- `docs/AI_EVIDENCE_VALIDATION.md`
- `docs/WHATSAPP_FLOW.md`
- `docs/SECURITY.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/DOCUMENT_PIPELINE.md`
- `docs/PHASE_1_REPORT.md`
- `docs/PHASE_2_REPORT.md`
- `docs/DEADLINE_POLICY.md`
- `docs/ASSOCIATION_ENGINE.md`
- `docs/adr/ADR-001-DOCUMENT-PROCESSING-VERSIONING.md`
- `docs/adr/ADR-002-EMBEDDINGS.md`
- `docs/PHASE_3_REPORT.md`
- `docs/PHASE_4_REPORT.md`
- `docs/PHASE_5A_REPORT.md`

Antes de produção, trate como bloqueadores o checklist de segurança, a política LGPD, a regra administrativa exata de contagem, o antivírus/quarentena, o contrato real da UAZAPI, os testes de restauração e a aprovação institucional para envio de documentos reais a um provider de IA externo.
