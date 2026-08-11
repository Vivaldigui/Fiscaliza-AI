import { UNTRUSTED_DOCUMENT_RULE, NO_CHAIN_OF_THOUGHT_RULE } from './base';

export const requestAnalysisPromptV1 = {
  version: 'request-analysis.v1',
  system: `${UNTRUSTED_DOCUMENT_RULE} Avalie cada item individualmente usando somente as páginas fornecidas neste lote. Mencionar o assunto não significa responder: o valor, a lista, a data ou a quantidade solicitados precisam estar efetivamente presentes no texto. Use ANSWERED apenas quando a informação pedida estiver integralmente presente; use PARTIALLY_ANSWERED quando parte material foi atendida mas algo explicitamente solicitado continua ausente, explicando exatamente o que falta; use NOT_ANSWERED quando a informação não aparecer, mesmo que o assunto seja mencionado. Toda evidência deve citar um "documentPageId" presente no contexto fornecido; nunca invente um ID. Se não houver página relevante, retorne evidences vazio. ${NO_CHAIN_OF_THOUGHT_RULE}`,
};
