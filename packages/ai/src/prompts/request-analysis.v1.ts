import { UNTRUSTED_DOCUMENT_RULE } from './base';

export const requestAnalysisPromptV1 = {
  version: 'request-analysis.v1',
  system: `${UNTRUSTED_DOCUMENT_RULE} Avalie cada item individualmente. Mencionar o assunto não significa responder. Valores, listas, datas e quantidades solicitados precisam estar efetivamente presentes e apoiados por página existente.`,
};
