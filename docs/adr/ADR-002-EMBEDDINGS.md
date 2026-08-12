# ADR-002: Embeddings e RAG autorizado (Fase 5A)

- Status: aceito
- Data: 2026-08-11
- Fase: 5A

## Contexto

A Fase 4 entregou extração/análise estruturada com evidências por página, mas nenhum embedding, índice vetorial ou conversa foi implementado. `DocumentChunk.embedding` existe como coluna provisória `vector(1536)` (criada na migration inicial por SQL cru, sem índice e sem metadados). O `AnalysisType.CONVERSATION_ANSWER`, `Conversation`, `ConversationMessage` e a sessão Redis já estão modelados.

A consulta em linguagem natural precisa (1) resolver primeiro fatos estruturados no PostgreSQL, (2) buscar vetores somente sobre documentos que o usuário pode ver, com filtro no SQL antes do `ORDER BY`/`LIMIT`, e (3) exibir fontes validadas (documento/página/chunk). O provider de chat de produção é OpenAI (PR #4), mas o provider de embeddings é uma decisão independente: nada garante que o provider que gera texto também gera vetores.

## Decisão

### Provider, modelo e dimensão

- **Provider:** `openai` (módulo `OpenAIEmbeddingProvider` em `packages/ai`). O `text-embedding-3` aceita o parâmetro `dimensions`, então a dimensão é **fixada em 1536** no código e enviada sempre.
- **Modelo padrão:** `text-embedding-3-small` (nativo 1536). Alternativa documentada de maior qualidade: `text-embedding-3-large` com `dimensions: 1536` (mesma coluna, custo maior).
- **Dimensão:** `1536`, compatível com a coluna provisória `vector(1536)` — não há rebuild de coluna nem cópia de dados.
- **`FakeEmbeddingProvider`** (dublê determinístico, em processo, baseado em hash do conteúdo): exclusivo para testes/CI. `EMBEDDINGS_PROVIDER=fake` é rejeitado pela validação de ambiente quando `NODE_ENV=production` e `EMBEDDINGS_ENABLED=true`.

### Separação entre provider de embeddings e provider de chat

`EmbeddingProvider` é uma interface própria, independente de `LLMProvider`. Configurações separadas:

```text
LLM_*          -> geração de texto (análise, resumo, conversa)
EMBEDDINGS_*   -> geração de vetores (índice e consulta)
```

`createEmbeddingProvider` é a única fábrica; nenhum controller, service ou domínio importa o SDK OpenAI. Chave: `EMBEDDINGS_API_KEY`; para o provider `openai`, se ausente, usa `LLM_API_KEY` (mesma conta OpenAI), documentado no `.env.example`.

### Versão do embedding

Cada chunk armazena `embedding_provider`, `embedding_model`, `embedding_version` e `embedding_hash`.

- `EMBEDDING_VERSION` (constante `phase5a-embedding-v1` em `packages/ai/src/versions.ts`) representa o contrato de vectorização (provider + modelo + dimensão + normalização + versão de pipeline).
- `embedding_hash = sha256(content + ':' + provider + ':' + model + ':' + dimension + ':' + version)`. Serve para idempotência (rede hashing) e detecção de conteúdo reindexável (mudou de versão → novo hash).

### Estratégia de reindexação e rollback

- Indexação é **incremental e idempotente**: o job só grava um chunk quando o hash da combinação atual é diferente do armazenado (ou o embedding é `NULL`). Reprocessar o mesmo job não refaz trabalho.
- Backfill controlado: script explícito (`apps/worker/scripts/backfill-embeddings.ts`) que enfileira documentos sem embedding na versão corrente. Nunca roda sozinho na produção.
- Rollback: ao trocar provider/modelo/versão, os vectors antigos **não são apagados**; ficam marcados com a versão anterior. A **consulta filtra por `embeddingVersion` igual à versão corrente**, então reverter a configuração restaura imediatamente os chunks da versão anterior que ainda existem, sem reindexação urgente. O backfill depois alinha o restante.

### Chunks de tentativas documentais antigas

Somente a **tentativa corrente** (`DocumentProcessingAttempt.attempt == Document.processingAttempt` e `status COMPLETED`, com documento `CLEAN`/`COMPLETED`) participa de indexação e consulta.

- Indexação: o job resolve a tentativa corrente no momento da execução.
- Consulta: o SQL une `document_processing_attempts` e exige `pa.attempt = d.processing_attempt` e `pa.status = 'COMPLETED'`. Chunks históricos nunca são recuperados por RAG, nem alterados por reprocessamento.
- Evidências e conversas históricas referenciam `DocumentPage` (nunca chunk), portanto reprocessar não altera nada já persistido.

### Custos, limites e política de envio

- Preço de referência `text-embedding-3-small` ≈ US$ 0,02 por 1M tokens (≈ 12.500 páginas a US$~0,16 por 1M chars, ordem de grandeza apenas; valor real deve vir de contrato). Custos são registrados em `AIUsage` (operação `embedding`), sem inventar preço — `estimatedCost` permanece `null` se não houver tabela.
- `EMBEDDINGS_ENABLED=false` por padrão (**fail-closed**): nenhum texto é enviado a um provider externo sem ativação operacional explícita.
- `EMBEDDINGS_BATCH_SIZE` limita o lote; `EMBEDDINGS_TIMEOUT_MS` limita cada chamada; `EMBEDDINGS_QUEUE_ATTEMPTS`/`BACKOFF` governam retries.
- Política de envio: mesmo tratamento da Fase 4 — documentos reais da Câmara (`data/proposicoes-itanhandu/`) não podem ser vetorizados em desenvolvimento/testes; fixtures sintéticas apenas. Decisão institucional/LGPD exigida antes de enviar conteúdo real.

### Migração da coluna provisória `vector(1536)`

Nova migration incremental `202608110100_phase5a_embeddings` (nenhuma migration anterior é editada):

1. colunas tipadas em `DocumentChunk`: `embedding_provider`, `embedding_model`, `embedding_version`, `embedding_hash`;
2. índice **HNSW** (`vector_cosine_ops`) sobre `document_chunks.embedding` por SQL cru (Prisma não gerencia tipos vetoriais);
3. a coluna `document_chunks.embedding` continua `vector(1536)` nas mãos do banco (tipo `Unsupported` no schema), mantida pelos migrations existentes — sem rebuild.

## Consequências

- A busca vetorial é um passo opcional, sempre precedido por consulta estruturada e sempre restrito por allowlist em SQL.
- Reprocessamento documental cria uma nova tentativa com novos chunks/vectors; nunca altera evidências ou conversas antigas.
- Troca de modelo de embedding é configurável e reversível por rollback de versão, sem downtime.
- `ConversationMessage.sources` guarda apenas fontes validadas; `AIUsage` registra provider/modelo/tokens/latência sem conteúdo sensível.
- `CHAT_ENABLED=false` (padrão) falha de forma explícita e recuperável quando uma resposta exige IA; a conversa em si (CRUD/mensagens) continua disponível sem chamada externa.
