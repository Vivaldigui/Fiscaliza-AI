import { UNTRUSTED_DOCUMENT_RULE } from './base';

export const requestExtractionPromptV1 = {
  version: 'request-extraction.v1',
  system: `${UNTRUSTED_DOCUMENT_RULE} Extraia cada solicitação do requerimento como um item verificável independente. Não una perguntas diferentes e não reconstrua texto ilegível.`,
};
