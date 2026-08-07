# ADR-001: Versionamento dos derivados do processamento documental

- Status: aceito
- Data: 2026-08-07
- Fase: 3

## Contexto

Na Fase 2, `DocumentPage` e `DocumentChunk` representam somente o resultado mais recente. O reprocessamento apaga esses registros antes de persistir a nova extração. Esse comportamento é adequado enquanto não existem consumidores históricos, mas deixaria de ser auditável na Fase 4: uma `Evidence` poderia passar a apontar para texto diferente ou para uma página removida depois de novo OCR.

O arquivo original (`Document`) continua único por SHA-256. O que muda entre reprocessamentos são os derivados e as decisões técnicas que os produziram.

## Decisão

`DocumentProcessingAttempt` passa a ser a versão imutável dos derivados:

```text
Document
  -> DocumentProcessingAttempt
       -> DocumentPage
            -> DocumentChunk
```

Cada página e chunk recebe `processingAttemptId`. A identidade de uma página passa a ser `(processingAttemptId, pageNumber)`, e um reprocessamento só pode substituir dados incompletos da própria tentativa corrente. Resultados de tentativas anteriores não são apagados.

`Evidence` passa a guardar `documentPageId`, além de `documentId` e `pageNumber` desnormalizados para apresentação e verificações. A chave estrangeira imutável é `documentPageId`; portanto, a evidência continua ligada exatamente ao texto observado na análise.

`AnalysisDocument` também registra `processingAttemptId`, permitindo que cada documento de entrada de uma análise declare a versão usada. A Fase 4 deverá criar análises somente com tentativas finalizadas e nunca resolver páginas apenas por `Document.processingAttempt` depois da criação da análise.

A API documental continua exibindo, por padrão, as páginas da tentativa atual. O histórico permanece no banco para auditoria e poderá ganhar uma interface administrativa própria sem alterar o modelo.

## Migração

A migration incremental:

1. adiciona `processing_attempt_id` às páginas e chunks;
2. associa os registros existentes à tentativa indicada por `Document.processingAttempt`;
3. troca as constraints de unicidade para a tentativa;
4. adiciona `document_page_id` às evidências existentes por backfill;
5. adiciona a referência de tentativa em `AnalysisDocument` por backfill.

O backfill falha de forma explícita se encontrar um derivado sem tentativa correspondente. Não há edição das migrations das Fases 1 e 2.

## Consequências

- Reprocessamento deixa de alterar retroativamente evidências.
- O banco preserva texto histórico e, portanto, cresce a cada tentativa; retenção futura deverá considerar obrigações de auditoria.
- Consultas operacionais precisam filtrar pela tentativa corrente.
- Exclusão de `DocumentProcessingAttempt`, `DocumentPage` ou `DocumentChunk` histórico não será exposta como operação comum.
- `DocumentChunk.embedding` permanece `null` na Fase 3. A dimensão física `vector(1536)` será decidida antes da Fase 5 e não influencia este ADR.

## Alternativas rejeitadas

- Copiar texto da página para `Evidence`: duplicaria conteúdo, perderia estrutura e não versionaria chunks.
- Manter apenas hash textual na análise: prova mudança, mas não preserva o conteúdo exato consultável.
- Adiar a alteração para a Fase 4: aumentaria o risco de já existirem reprocessamentos destrutivos quando evidências começassem a ser gravadas.
