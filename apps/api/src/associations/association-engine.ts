import type { PropositionType } from '@fiscaliza/database';

export interface AssociationWeights {
  explicitReference: number;
  number: number;
  year: number;
  type: number;
  protocol: number;
  subject: number;
  temporal: number;
}

export interface ResponseAssociationInput {
  text: string;
  protocolNumber?: string | null;
  protocolDate?: Date | null;
  subject?: string | null;
}

export interface PropositionAssociationInput {
  id: string;
  type: PropositionType;
  number: number;
  year: number;
  protocolNumber?: string | null;
  protocolDate?: Date | null;
  subject: string;
}

export interface AssociationScore {
  propositionId: string;
  score: number;
  signals: Record<keyof AssociationWeights, number>;
  explanations: string[];
}

export interface AssociationDecision {
  selected: AssociationScore | null;
  topScore: number;
  secondScore: number;
  margin: number;
  needsReview: boolean;
  reason: string;
}

export class DeterministicAssociationEngine {
  score(
    response: ResponseAssociationInput,
    propositions: PropositionAssociationInput[],
    weights: AssociationWeights,
  ): AssociationScore[] {
    const references = extractReferences(`${response.subject ?? ''}\n${response.text}`);
    return propositions
      .map((proposition) => scoreCandidate(response, proposition, references, weights))
      .sort((a, b) => b.score - a.score || a.propositionId.localeCompare(b.propositionId));
  }

  decide(
    scores: AssociationScore[],
    minimumScore: number,
    minimumMargin: number,
  ): AssociationDecision {
    const top = scores[0];
    const second = scores[1];
    const topScore = top?.score ?? 0;
    const secondScore = second?.score ?? 0;
    const margin = round(topScore - secondScore);
    if (!top || topScore < minimumScore) {
      return {
        selected: null,
        topScore,
        secondScore,
        margin,
        needsReview: true,
        reason: 'Pontuação máxima abaixo do limiar configurado.',
      };
    }
    if (margin < minimumMargin) {
      return {
        selected: null,
        topScore,
        secondScore,
        margin,
        needsReview: true,
        reason: 'Margem insuficiente entre os dois primeiros candidatos.',
      };
    }
    return {
      selected: top,
      topScore,
      secondScore,
      margin,
      needsReview: false,
      reason: 'Limiar e margem mínima atendidos.',
    };
  }
}

interface Reference {
  type: PropositionType;
  number: number;
  year: number;
}

function extractReferences(text: string): Reference[] {
  const normalized = normalize(text);
  const pattern =
    /\b(requerimento|indicacao)\s*(?:n(?:o|r)?\s*)?(\d{1,8})\s*(?:\/|,\s*de\s*|-)(\d{4})\b/g;
  const references: Reference[] = [];
  for (const match of normalized.matchAll(pattern)) {
    references.push({
      type: match[1] === 'requerimento' ? 'REQUEST' : 'INDICATION',
      number: Number(match[2]),
      year: Number(match[3]),
    });
  }
  return references;
}

function scoreCandidate(
  response: ResponseAssociationInput,
  proposition: PropositionAssociationInput,
  references: Reference[],
  weights: AssociationWeights,
): AssociationScore {
  const exact = references.some(
    (reference) =>
      reference.type === proposition.type &&
      reference.number === proposition.number &&
      reference.year === proposition.year,
  );
  const number = references.some((reference) => reference.number === proposition.number) ? 1 : 0;
  const year = references.some((reference) => reference.year === proposition.year) ? 1 : 0;
  const type = references.some((reference) => reference.type === proposition.type) ? 1 : 0;
  const protocol =
    normalizedIdentifier(response.protocolNumber) &&
    normalizedIdentifier(response.protocolNumber) ===
      normalizedIdentifier(proposition.protocolNumber)
      ? 1
      : 0;
  const subject = tokenSimilarity(
    response.subject ?? response.text.slice(0, 1000),
    proposition.subject,
  );
  const temporal = temporalScore(response.protocolDate, proposition.protocolDate);
  const signals: AssociationScore['signals'] = {
    explicitReference: exact ? 1 : 0,
    number,
    year,
    type,
    protocol,
    subject,
    temporal,
  };
  const score = round(
    Object.entries(weights).reduce(
      (sum, [key, weight]) => sum + weight * signals[key as keyof AssociationWeights],
      0,
    ),
  );
  const explanations = [
    ...(exact ? ['Referência explícita exata encontrada no documento.'] : []),
    ...(number ? ['Número coincidente.'] : []),
    ...(year ? ['Ano coincidente.'] : []),
    ...(type ? ['Tipo legislativo coincidente.'] : []),
    ...(protocol ? ['Protocolo coincidente.'] : []),
    ...(subject >= 0.5 ? [`Assunto semelhante (${subject.toFixed(2)}).`] : []),
    ...(temporal === 0 ? ['Data incompatível ou anterior à proposição.'] : []),
  ];
  return { propositionId: proposition.id, score, signals, explanations };
}

function tokenSimilarity(left: string, right: string): number {
  const ignored = new Set([
    'a',
    'as',
    'ao',
    'aos',
    'da',
    'das',
    'de',
    'do',
    'dos',
    'e',
    'em',
    'o',
    'os',
    'para',
    'por',
    'sobre',
    'um',
    'uma',
  ]);
  const tokens = (value: string) =>
    new Set(
      normalize(value)
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 2 && !ignored.has(token)),
    );
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return round(intersection / new Set([...a, ...b]).size);
}

function temporalScore(responseDate?: Date | null, propositionDate?: Date | null): number {
  if (!responseDate || !propositionDate) return 0.5;
  const days = (responseDate.getTime() - propositionDate.getTime()) / 86_400_000;
  if (days < 0) return 0;
  if (days <= 365) return 1;
  if (days <= 730) return 0.5;
  return 0.2;
}

function normalizedIdentifier(value?: string | null): string {
  return normalize(value ?? '').replace(/[^a-z0-9]/g, '');
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[º°ª.]/g, '');
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
