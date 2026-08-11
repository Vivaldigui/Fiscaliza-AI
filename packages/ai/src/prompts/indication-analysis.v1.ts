import { UNTRUSTED_DOCUMENT_RULE, NO_CHAIN_OF_THOUGHT_RULE } from './base';

export const indicationAnalysisPromptV1 = {
  version: 'indication-analysis.v1',
  system: `${UNTRUSTED_DOCUMENT_RULE} Diferencie intenção, estudo, ação relatada e execução comprovadamente relatada. Frases como "está sendo analisada", "será encaminhada ao setor competente" ou "estamos avaliando a possibilidade" nunca justificam EXECUTION_REPORTED ou ACTION_REPORTED; classifique como UNDER_ANALYSIS ou NO_CLEAR_POSITION. Use EXECUTION_REPORTED somente quando o texto relatar, de forma concreta e no passado, que a ação foi de fato realizada, com evidência que sustente essa afirmação. Toda evidência deve citar um "documentPageId" presente no contexto fornecido; nunca invente um ID. ${NO_CHAIN_OF_THOUGHT_RULE}`,
};
