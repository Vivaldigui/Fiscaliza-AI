export const propositionTypeLabel = {
  REQUEST: 'Requerimento',
  INDICATION: 'Indicação',
} as const;

export const propositionStatusLabel: Record<string, string> = {
  DRAFT: 'Rascunho',
  ACTIVE: 'Ativa',
  AWAITING_RESPONSE: 'Aguardando resposta',
  RESPONSE_RECEIVED: 'Resposta recebida',
  PARTIALLY_RESPONDED: 'Parcialmente respondida',
  RESPONDED: 'Respondida',
  ARCHIVED: 'Arquivada',
  NEEDS_REVIEW: 'Requer revisão',
};

export const deadlineStatusLabel: Record<string, string> = {
  OPEN: 'Aberto',
  DUE_SOON: 'Vence em breve',
  OVERDUE: 'Vencido',
  RESPONSE_RECEIVED: 'Resposta protocolada',
  RESPONDED: 'Respondido',
  EXTENDED: 'Prorrogado',
  SUSPENDED: 'Suspenso',
};

export const responseTypeLabel: Record<string, string> = {
  INITIAL: 'Resposta inicial',
  COMPLEMENTARY: 'Resposta complementar',
  RECTIFICATION: 'Retificação',
  OTHER: 'Outro',
};

export function formatDate(value?: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(value));
}

export function statusTone(status: string): string {
  if (status === 'OVERDUE' || status === 'NEEDS_REVIEW') return 'bg-red-50 text-red-700';
  if (status === 'DUE_SOON' || status === 'PARTIALLY_RESPONDED') return 'bg-amber/10 text-amber';
  if (status === 'RESPONSE_RECEIVED' || status === 'RESPONDED')
    return 'bg-emerald-50 text-emerald-700';
  return 'bg-black/5 text-black/60';
}
