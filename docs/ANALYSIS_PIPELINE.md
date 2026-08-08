# Pipeline de análise (Fase 4)

## Escopo

Este documento descreve como uma proposição vai de "documentos seguros e classificados" (Fase 3) a "3 solicitações identificadas, 2 respondidas, 1 parcialmente respondida" (Fase 4), sem RAG, embeddings, WhatsApp ou chat genérico com PDF.

## Fluxo ponta a ponta

```text
POST /propositions/:id/analyses
  → AnalysesService.create
      - AI_PROCESSING_ENABLED=false → 503 explícito, nenhuma chamada externa
      - calcula inputHash (documentos+tentativas da(s) resposta(s), promptVersion, schemaVersion, provider, modelo)
      - Analysis já existe com esse inputHash? retorna a existente (cache/idempotência)
      - senão: transação cria Analysis PENDING + AuditLog + outbox AnalysisRequested
  → OutboxDispatcher (worker) publica na fila `ai-processing`, jobId determinístico
  → AiAnalysisPipeline.process(analysisId)
      1. Analysis não está PENDING/PROCESSING? job obsoleto, ignora (idempotente)
      2. ensureExtraction: se a proposição já tem RequestedItem ativo, reaproveita;
         senão roda extração (REQUEST_EXTRACTION/INDICATION_EXTRACTION), cria itens ativos
      3. carrega páginas cumulativas de todas as Response da proposição (tentativa corrente de cada documento)
      4. sem página de resposta → todos os itens NOT_ANSWERED/NO_CLEAR_POSITION (determinístico, sem custo de IA)
      5. com página de resposta → analyzeRequestResponses/analyzeIndicationResponses, por lote de páginas
      6. valida evidências (documentPageId + trecho real) e aplica limiar de confiança
      7. gera resumo executivo a partir dos itens já validados (não do PDF bruto)
      8. persiste em uma única transação: AnalysisDocument, AnalysisItem, Evidence, AIUsage,
         atualiza Analysis (status/confidence/executiveSummary/originalResult/currentResult),
         atualiza Proposition.status quando aplicável, emite AnalysisCompleted/NeedsReview/Failed
```

## Extração (REQUEST_EXTRACTION / INDICATION_EXTRACTION)

- Roda no máximo uma vez por proposição por geração de itens: se já existir `RequestedItem` com `active = true`, a extração é pulada e os itens existentes são reutilizados.
- Uma nova tentativa documental (`DocumentProcessingAttempt`) ou uma mudança de `promptVersion`/`SCHEMA_VERSION`/provider/modelo produz um `inputHash` de extração diferente; se não houver `Analysis` de extração `COMPLETED` com esse hash, uma nova extração roda, os itens antigos são marcados `active = false` (nunca apagados) e um novo conjunto `active = true` é criado, vinculado à nova `Analysis` de extração.
- `RequestedItem.sourceDocumentPageId` é validado contra o conjunto de páginas efetivamente enviado ao modelo; um item cujo `sourceDocumentPageId` não pertença a esse conjunto é descartado (contabilizado, nunca persistido com origem inventada).
- Para requerimentos, o prompt favorece dividir perguntas independentes em itens separados em vez de uni-las.
- Para indicações, o pipeline (`extractIndicationItems`) usa prompt e schema próprios (`indicationExtractionSchema`), extraindo ação sugerida, local, objeto, justificativa e subitens — não gera um questionário artificial.

## Análise cumulativa de respostas

- Toda `Response` associada à proposição (`INITIAL`, `COMPLEMENTARY`, `RECTIFICATION`, `OTHER`) entra na análise corrente; cada execução de "Executar análise"/"Analisar novamente" cria uma **nova** `Analysis`, nunca sobrescreve a anterior — histórico completo por proposição fica disponível em `GET /propositions/:id/analyses`.
- As páginas de todas as respostas (na tentativa de processamento corrente de cada documento) são divididas em lotes de até `AI_MAX_PAGES_PER_BATCH`. Cada lote recebe uma chamada estruturada própria com a lista completa de itens, pedindo uma entrada por item mesmo quando `NOT_ANSWERED` naquele lote — isso garante que toda página relevante passe por alguma etapa de julgamento.
- Os resultados por item são consolidados entre lotes por prioridade determinística:
  - requerimento: `ANSWERED` > `PARTIALLY_ANSWERED` > `INCONCLUSIVE` > `NEEDS_HUMAN_REVIEW` > `NOT_APPLICABLE` > `NOT_ANSWERED`;
  - indicação: `EXECUTION_REPORTED` > `ACTION_REPORTED` > `ACCEPTED`/`REJECTED` > `UNDER_ANALYSIS` > `NEEDS_HUMAN_REVIEW` > `NO_CLEAR_POSITION`.
  - a explicação e a evidência final vêm do(s) lote(s) que produziram o status vencedor; explicações duplicadas são deduplicadas.

## Regras de status (requerimento)

- `ANSWERED` exige evidência válida e o valor/quantidade/lista pedido efetivamente presente — menção ao assunto não basta.
- `PARTIALLY_ANSWERED` exige evidência da parte efetivamente respondida e a explicação deve dizer o que foi informado e o que ainda falta.
- `NOT_ANSWERED` pode não ter evidência positiva; a cobertura documental examinada fica registrada em `Analysis.currentResult.coverage` (respostas, documentos, tentativas, páginas, lotes, corte temporal).

## Regras de status (indicação)

- Frases de intenção futura ou encaminhamento ("será analisada pela Secretaria", "estamos avaliando a possibilidade") nunca geram `EXECUTION_REPORTED`; o prompt e o merge determinístico favorecem `UNDER_ANALYSIS`/`NO_CLEAR_POSITION` nesses casos.
- `EXECUTION_REPORTED`/`ACTION_REPORTED` exigem evidência que relate, de forma concreta, a ação já realizada.

## Confiança e revisão humana

- `analysis.confidence.normal`/`analysis.confidence.warning` (`SystemSetting`) definem o limiar; abaixo do limite inferior, o item vira `NEEDS_HUMAN_REVIEW`, preservando `originalStatus`/`originalExplanation`.
- Ausência de evidência válida para um status que a exige também rebaixa para `NEEDS_HUMAN_REVIEW`.
- `POST /analyses/:id/review` (`ADMIN`/`SECRETARIAT`) altera `currentStatus`/`currentExplanation` e cria um `AnalysisRevision` append-only com justificativa; o resultado original da IA nunca é sobrescrito.

## Status da proposição

Regra determinística (`deriveNextPropositionStatus`), aplicada apenas quando a `Analysis` termina `COMPLETED` (nunca quando `NEEDS_HUMAN_REVIEW`/`FAILED`):

- requerimento: todos os itens `ANSWERED` ou `NOT_APPLICABLE` → `RESPONDED`; algum progresso (`ANSWERED`/`PARTIALLY_ANSWERED`) sem cobrir todos → `PARTIALLY_RESPONDED`; caso contrário, sem mudança.
- indicação: todos os itens em posição resolvida (`ACCEPTED`/`REJECTED`/`ACTION_REPORTED`/`EXECUTION_REPORTED`) → `RESPONDED`; algum progresso → `PARTIALLY_RESPONDED`; caso contrário, sem mudança.

`NEEDS_HUMAN_REVIEW`/`INCONCLUSIVE` sempre impedem a declaração automática de atendimento integral. O `Deadline` nunca é alterado por essa regra — prazo é conceito administrativo separado (ver `docs/DEADLINE_POLICY.md`).

## Concorrência e cache

- `Analysis.inputHash` é `@unique`; `AnalysesService.create` retorna a análise existente quando o hash coincide, e absorve o conflito de unicidade em caso de corrida (duas solicitações simultâneas nunca criam duas análises equivalentes).
- O `jobId` da fila `ai-processing` é `analysis:{analysisId}:input:{inputHash}`, determinístico por análise.
