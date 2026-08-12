/**
 * Deterministic PostgreSQL-only answers for the web conversation: questions
 * about the proposition itself (status, protocol, numbering, authorship, type,
 * deadlines, requested items) are resolved without any LLM call — cheaper,
 * auditable and injectable-proof. Only when no template matches does the
 * pipeline fall back to authorized RAG.
 */

export interface StructuredQueryData {
  type: string;
  number: number;
  year: number;
  protocolNumber: string | null;
  protocolDate: Date | null;
  summary: string | null;
  status: string;
  authors: Array<{ name: string; role: string }>;
  deadline: {
    status: string;
    currentDueDate: Date | null;
  } | null;
  activeItemCount: number;
}

export interface StructuredAnswer {
  text: string;
  kind: 'db';
}

const PROPOSITION_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'em rascunho',
  ACTIVE: 'em tramitação',
  AWAITING_RESPONSE: 'aguardando resposta',
  RESPONSE_RECEIVED: 'com resposta recebida',
  PARTIALLY_RESPONDED: 'parcialmente respondido',
  RESPONDED: 'respondida',
  ARCHIVED: 'arquivada',
  NEEDS_REVIEW: 'em revisão',
};

const DEADLINE_STATUS_LABEL: Record<string, string> = {
  OPEN: 'aberto',
  DUE_SOON: 'a vencer',
  OVERDUE: 'em atraso',
  RESPONSE_RECEIVED: 'encerrado após resposta',
  RESPONDED: 'encerrado após resposta',
  EXTENDED: 'prorrogado',
  SUSPENDED: 'suspenso',
};

const TYPE_LABEL: Record<string, string> = {
  REQUEST: 'requerimento',
  INDICATION: 'indicação',
};

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function daysRemaining(currentDueDate: Date | null): number | null {
  if (!currentDueDate) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(currentDueDate);
  due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - now.getTime()) / 86_400_000);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Matches the (normalized) question against the DB templates. Returns null
 * when the question needs the document corpus (semantic retrieval).
 */
export function resolveStructuredAnswer(
  question: string,
  data: StructuredQueryData,
): StructuredAnswer | null {
  const q = normalize(question);

  if (
    /(status|situacao|andamento)( da proposicao| do projeto| da proposta| do requerimento| da indicacao)?/.test(
      q,
    )
  ) {
    const label = PROPOSITION_STATUS_LABEL[data.status] ?? data.status;
    let text = `A proposição está ${label}.`;
    if (data.summary && data.status === 'AWAITING_RESPONSE') {
      text += ` Resumo: ${data.summary}`;
    }
    return { text, kind: 'db' };
  }

  if (/protocolo/.test(q) && data.protocolNumber) {
    const date = data.protocolDate ? ` em ${formatDate(data.protocolDate)}` : '';
    return { text: `O número de protocolo é ${data.protocolNumber}${date}.`, kind: 'db' };
  }

  if (/(numero|numeracao)( da proposicao| do projeto| da proposta)?/.test(q)) {
    return {
      text: `É a proposta ${data.type === 'REQUEST' ? 'de requerimento' : 'de indicação'} nº ${data.number}/${data.year}.`,
      kind: 'db',
    };
  }

  if (/(autor|autoria|autores|vereador|vereadora)/.test(q)) {
    if (data.authors.length === 0) {
      return { text: 'Não há autores registrados para esta proposição.', kind: 'db' };
    }
    const names = data.authors.map((author) => author.name);
    return {
      text: `${names.length === 1 ? 'O autor é' : 'Os autores são'} ${names.join(', ')}.`,
      kind: 'db',
    };
  }

  if (/(tipo)( da proposicao| do projeto| da proposta)?/.test(q)) {
    return { text: `É uma ${TYPE_LABEL[data.type] ?? data.type}.`, kind: 'db' };
  }

  if (/(prazo|vence|dias restantes|quando termina|data limite)/.test(q)) {
    if (!data.deadline) {
      return { text: 'Não há prazo registrado para esta proposição.', kind: 'db' };
    }
    const remaining = daysRemaining(data.deadline.currentDueDate);
    const base = `O prazo atual é ${DEADLINE_STATUS_LABEL[data.deadline.status] ?? data.deadline.status}.`;
    const datePart = data.deadline.currentDueDate
      ? ` Vence em ${formatDate(data.deadline.currentDueDate)}.`
      : '';
    const daysPart =
      remaining === null
        ? ''
        : remaining > 0
          ? ` Restam ${remaining} dia${remaining === 1 ? '' : 's'}.`
          : ' O prazo já venceu.';
    return { text: `${base}${datePart}${daysPart}`, kind: 'db' };
  }

  if (/((quantos|quantas) (itens|pedidos)|numero de itens)/.test(q)) {
    return {
      text: `A proposição tem ${data.activeItemCount} item${data.activeItemCount === 1 ? '' : 's'} em apuração ativa.`,
      kind: 'db',
    };
  }

  return null;
}
