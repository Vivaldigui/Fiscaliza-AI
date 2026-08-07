import { DeterministicAssociationEngine, type AssociationWeights } from './association-engine';

const weights: AssociationWeights = {
  explicitReference: 0.5,
  number: 0.15,
  year: 0.1,
  type: 0.1,
  protocol: 0.05,
  subject: 0.05,
  temporal: 0.05,
};

describe('DeterministicAssociationEngine', () => {
  const engine = new DeterministicAssociationEngine();
  const propositions = [
    {
      id: 'request-10',
      type: 'REQUEST' as const,
      number: 10,
      year: 2026,
      protocolDate: new Date('2026-01-01'),
      subject: 'Frota municipal',
    },
    {
      id: 'request-11',
      type: 'REQUEST' as const,
      number: 11,
      year: 2026,
      protocolDate: new Date('2026-01-02'),
      subject: 'Unidades de saúde',
    },
    {
      id: 'indication-10',
      type: 'INDICATION' as const,
      number: 10,
      year: 2026,
      protocolDate: new Date('2026-01-03'),
      subject: 'Pavimentação',
    },
  ];

  it('prioriza Requerimento 10/2026 sem confundir Indicação 10/2026', () => {
    const scores = engine.score(
      {
        text: 'Em resposta ao Requerimento nº 10/2026, seguem as informações.',
        protocolDate: new Date('2026-01-20'),
      },
      propositions,
      weights,
    );
    expect(scores[0]?.propositionId).toBe('request-10');
    expect(scores[0]?.signals.explicitReference).toBe(1);
    expect(
      scores.find(({ propositionId }) => propositionId === 'indication-10')?.signals.type,
    ).toBe(0);
  });

  it('não autoassocia quando a margem entre 0,88 e 0,86 é insuficiente', () => {
    const decision = engine.decide(
      [
        { propositionId: 'a', score: 0.88, signals: emptySignals(), explanations: [] },
        { propositionId: 'b', score: 0.86, signals: emptySignals(), explanations: [] },
      ],
      0.85,
      0.05,
    );
    expect(decision.selected).toBeNull();
    expect(decision.needsReview).toBe(true);
    expect(decision.margin).toBe(0.02);
  });
});

function emptySignals() {
  return {
    explicitReference: 0,
    number: 0,
    year: 0,
    type: 0,
    protocol: 0,
    subject: 0,
    temporal: 0,
  };
}
