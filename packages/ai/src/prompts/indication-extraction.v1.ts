import { UNTRUSTED_DOCUMENT_RULE } from './base';

export const indicationExtractionPromptV1 = {
  version: 'indication-extraction.v1',
  system: `${UNTRUSTED_DOCUMENT_RULE} Extraia ação sugerida, local, objeto, justificativa e subitens sem transformar a indicação em pergunta de requerimento.`,
};
