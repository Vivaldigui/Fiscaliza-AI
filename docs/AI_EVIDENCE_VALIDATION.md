# Validação de evidências de IA

## Princípio

Uma conclusão factual da IA só é aceita se puder ser verificada de volta ao documento original. O backend nunca confia na instrução do prompt sozinha; toda evidência retornada pelo modelo passa por uma segunda verificação determinística antes de ser persistida.

## Contexto fornecido ao modelo

Cada página entra no prompt com um identificador opaco e explícito, nunca apenas por número:

```text
[PAGE id="3fa1...uuid" document="Resposta 10/2026" page="7"]
texto efetivo da página...
[/PAGE]
```

(`pageDelimitedContentWithIds`, em `packages/ai/src/prompts/base.ts`.) O modelo só pode citar um `documentPageId` que apareça nesse contexto — mas isso é apenas o que se pede; o backend não confia nisso.

## O que é validado, e onde

`extractRequestItems`/`extractIndicationItems` (`packages/ai/src/pipeline.ts`):

1. `sourceDocumentPageId` retornado deve pertencer ao conjunto de páginas que foi realmente enviado naquele lote da extração.
2. Se não pertencer, o item inteiro é descartado (contabilizado em `rejectedForInventedPage`) — nunca persistido com origem inventada.

`analyzeRequestResponses`/`analyzeIndicationResponses` (mesmo arquivo):

1. Toda evidência cujo `documentPageId` não esteja no conjunto de páginas enviado naquele lote é removida antes do merge entre lotes.

`AiAnalysisPipeline.finalizeItem` (`apps/worker/src/ai/ai-pipeline.ts`), depois do merge entre lotes — segunda camada, contra o estado real do banco:

1. `documentPageId` deve resolver para uma `DocumentPage` que fez parte da entrada desta análise (mesma tentativa de processamento congelada).
2. `pageNumber` retornado deve coincidir com o `pageNumber` real dessa página.
3. Se houver `excerpt`, ele deve existir no `effectiveText` da página após normalização controlada (`apps/worker/src/ai/evidence-validator.ts#excerptExistsOnPage`): Unicode NFKC, colapso de espaços/quebras de linha, `trim`, minúsculas — para que um trecho real não seja rejeitado por reflow inofensivo, mas um trecho inventado nunca passe.
4. Evidência que falhar em qualquer verificação é removida antes da persistência.

## Regra por status

- `ANSWERED`/`PARTIALLY_ANSWERED` (requerimento) e `ACCEPTED`/`REJECTED`/`UNDER_ANALYSIS`/`ACTION_REPORTED`/`EXECUTION_REPORTED` (indicação) exigem ao menos uma evidência válida sobrevivente. Se nenhuma sobreviver à validação, o item é rebaixado para `NEEDS_HUMAN_REVIEW` — o `originalStatus`/`originalExplanation` do modelo são preservados para auditoria, mas o `currentStatus` deixa de afirmar uma conclusão sem lastro.
- `NOT_ANSWERED`/`NOT_APPLICABLE`/`INCONCLUSIVE`/`NO_CLEAR_POSITION` podem legitimamente não ter evidência positiva — a ausência de resposta é a própria conclusão. Nesse caso, `Analysis.currentResult.coverage` registra o universo examinado (`responseIds`, `documentIds`, `processingAttemptIds`, `pageCountScanned`, `batchCount`, `analysisCutoff`), para que a conclusão de ausência seja auditável sem inventar um trecho para "provar" a ausência.

## O que nunca acontece

- Uma página fora do escopo da análise nunca vira evidência, mesmo que exista no banco.
- Um trecho que não aparece no texto da página nunca é aceito, mesmo com página correta.
- Ausência de evidência nunca é silenciosamente promovida a `ANSWERED`.
- A aplicação nunca "corrige" ou adivinha uma página/trecho — a evidência é aceita como veio, ou é descartada.

## Testes que garantem isso

- `packages/ai/src/pipeline.test.ts`: rejeita extração com `sourceDocumentPageId` inventado; rejeita evidência de análise fora do conjunto de páginas; ignora instrução de prompt injection.
- `apps/worker/src/ai/evidence-validator.spec.ts`: aceita trecho real com reflow de espaço/quebra de linha; rejeita trecho inexistente; aceita evidência visual sem trecho.
- `apps/worker/src/ai/ai-pipeline.integration-spec.ts` (PostgreSQL real): evidência com `documentPageId` inventado não é persistida e o item vai para `NEEDS_HUMAN_REVIEW`; reprocessamento documental cria nova tentativa sem alterar a evidência da análise histórica.
