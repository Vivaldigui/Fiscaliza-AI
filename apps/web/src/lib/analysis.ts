export const analysisStatusLabel: Record<string, string> = {
  PENDING: 'Pendente',
  PROCESSING: 'Processando',
  COMPLETED: 'Concluída',
  NEEDS_HUMAN_REVIEW: 'Revisão necessária',
  FAILED: 'Falhou',
};

export const itemStatusLabel: Record<string, string> = {
  ANSWERED: 'Respondido',
  PARTIALLY_ANSWERED: 'Parcialmente respondido',
  NOT_ANSWERED: 'Não localizado',
  INCONCLUSIVE: 'Inconclusivo',
  NOT_APPLICABLE: 'Não aplicável',
  ACCEPTED: 'Aceita',
  REJECTED: 'Rejeitada',
  UNDER_ANALYSIS: 'Em análise',
  ACTION_REPORTED: 'Ação relatada',
  EXECUTION_REPORTED: 'Execução relatada',
  NO_CLEAR_POSITION: 'Sem posição clara',
  NEEDS_HUMAN_REVIEW: 'Revisão necessária',
};

export const itemStatusIcon: Record<string, string> = {
  ANSWERED: '✓',
  ACCEPTED: '✓',
  EXECUTION_REPORTED: '✓',
  ACTION_REPORTED: '✓',
  PARTIALLY_ANSWERED: '◐',
  UNDER_ANALYSIS: '◐',
  NOT_ANSWERED: '✕',
  REJECTED: '✕',
  NO_CLEAR_POSITION: '?',
  INCONCLUSIVE: '?',
  NOT_APPLICABLE: '—',
  NEEDS_HUMAN_REVIEW: '⚠',
};

export function itemStatusTone(status: string): string {
  if (status === 'NEEDS_HUMAN_REVIEW') return 'bg-amber/10 text-amber';
  if (['ANSWERED', 'ACCEPTED', 'EXECUTION_REPORTED', 'ACTION_REPORTED'].includes(status))
    return 'bg-emerald-50 text-emerald-700';
  if (['PARTIALLY_ANSWERED', 'UNDER_ANALYSIS'].includes(status)) return 'bg-amber/10 text-amber';
  if (['NOT_ANSWERED', 'REJECTED'].includes(status)) return 'bg-red-50 text-red-700';
  return 'bg-black/5 text-black/60';
}

export const REQUEST_ITEM_STATUSES = [
  'ANSWERED',
  'PARTIALLY_ANSWERED',
  'NOT_ANSWERED',
  'INCONCLUSIVE',
  'NOT_APPLICABLE',
  'NEEDS_HUMAN_REVIEW',
] as const;

export const INDICATION_ITEM_STATUSES = [
  'ACCEPTED',
  'REJECTED',
  'UNDER_ANALYSIS',
  'ACTION_REPORTED',
  'EXECUTION_REPORTED',
  'NO_CLEAR_POSITION',
  'NEEDS_HUMAN_REVIEW',
] as const;
