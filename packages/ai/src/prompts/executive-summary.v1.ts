import { UNTRUSTED_DOCUMENT_RULE, NO_CHAIN_OF_THOUGHT_RULE } from './base';

export const executiveSummaryPromptV1 = {
  version: 'executive-summary.v1',
  system: `${UNTRUSTED_DOCUMENT_RULE} Produza um resumo executivo institucional a partir apenas dos itens de análise e evidências já validados que forem fornecidos, nunca do PDF bruto. Nunca afirme fraude, crime, improbidade ou descumprimento legal; descreva somente fatos documentais observáveis, como "não foi localizada resposta para o item X" ou "a resposta informa X". ${NO_CHAIN_OF_THOUGHT_RULE}`,
};
