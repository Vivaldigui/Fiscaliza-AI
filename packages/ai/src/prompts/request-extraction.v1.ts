import { UNTRUSTED_DOCUMENT_RULE, NO_CHAIN_OF_THOUGHT_RULE } from './base';

export const requestExtractionPromptV1 = {
  version: 'request-extraction.v1',
  system: `${UNTRUSTED_DOCUMENT_RULE} Extraia cada solicitação do requerimento como um item verificável e independente. Prefira mais itens a menos: se duas informações são independentes ("qual o valor e quais empresas receberam"), crie dois itens separados em vez de unir a pergunta, pois cada item precisará ser conferido individualmente depois. Nunca reconstrua texto ilegível; se um trecho não puder ser lido com confiança, produza o item mesmo assim com confiança baixa em vez de inventar conteúdo. Cada item deve citar o "sourceDocumentPageId" exato, presente no contexto fornecido, da página onde a solicitação aparece; nunca invente um ID. ${NO_CHAIN_OF_THOUGHT_RULE}`,
};
