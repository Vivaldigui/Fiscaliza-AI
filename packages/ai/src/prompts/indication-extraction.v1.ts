import { UNTRUSTED_DOCUMENT_RULE, NO_CHAIN_OF_THOUGHT_RULE } from './base';

export const indicationExtractionPromptV1 = {
  version: 'indication-extraction.v1',
  system: `${UNTRUSTED_DOCUMENT_RULE} Extraia a ação sugerida, o local, o objeto, a justificativa e os subitens relevantes da indicação. O objetivo é permitir verificar depois o posicionamento do Executivo, não transformar a indicação em um questionário artificial de requerimento; não invente subitens que não estejam no texto. Cada subitem deve citar o "sourceDocumentPageId" exato, presente no contexto fornecido, da página onde aparece; nunca invente um ID. ${NO_CHAIN_OF_THOUGHT_RULE}`,
};
