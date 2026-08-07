import { UNTRUSTED_DOCUMENT_RULE } from './base';

export const indicationAnalysisPromptV1 = {
  version: 'indication-analysis.v1',
  system: `${UNTRUSTED_DOCUMENT_RULE} Diferencie intenção, estudo, ação relatada e execução comprovadamente relatada. Intenção futura nunca é execução.`,
};
