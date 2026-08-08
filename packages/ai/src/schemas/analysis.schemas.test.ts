import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { requestAnalysisSchema } from './analysis.schemas';

const ids = {
  page1: '00000000-0000-4000-8000-000000000001',
  page2: '00000000-0000-4000-8000-000000000002',
  item1: '00000000-0000-4000-8000-000000000011',
  item2: '00000000-0000-4000-8000-000000000012',
  item3: '00000000-0000-4000-8000-000000000013',
};

void describe('requestAnalysisSchema', () => {
  void it('preserva a distinção crítica entre respondido, parcial e não respondido', () => {
    const result = requestAnalysisSchema.parse({
      items: [
        {
          requestedItemId: ids.item1,
          status: 'ANSWERED',
          explanation: 'A resposta informa 12 veículos.',
          confidence: 0.98,
          evidences: [
            {
              documentPageId: ids.page1,
              pageNumber: 1,
              excerpt: 'A frota é composta por 12 veículos.',
              reason: 'Apresenta a quantidade solicitada.',
            },
          ],
        },
        {
          requestedItemId: ids.item2,
          status: 'PARTIALLY_ANSWERED',
          explanation: 'Há valor de uma manutenção, mas não o total do período.',
          confidence: 0.91,
          evidences: [
            {
              documentPageId: ids.page2,
              pageNumber: 2,
              excerpt: 'Uma manutenção custou R$ 8.000,00.',
              reason: 'Valor parcial, sem totalização.',
            },
          ],
        },
        {
          requestedItemId: ids.item3,
          status: 'NOT_ANSWERED',
          explanation: 'A resposta não identifica as empresas.',
          confidence: 0.96,
          evidences: [],
        },
      ],
    });

    assert.deepEqual(
      result.items.map(({ status }) => status),
      ['ANSWERED', 'PARTIALLY_ANSWERED', 'NOT_ANSWERED'],
    );
  });

  void it('rejeita confiança e página fora dos limites', () => {
    const invalid = {
      items: [
        {
          requestedItemId: ids.item1,
          status: 'ANSWERED',
          explanation: 'Inválido.',
          confidence: 1.1,
          evidences: [{ documentPageId: ids.page1, pageNumber: 0, reason: 'Página inválida.' }],
        },
      ],
    };
    assert.equal(requestAnalysisSchema.safeParse(invalid).success, false);
  });

  void it('rejeita evidência sem documentPageId (não permite inventar por número de página)', () => {
    const invalid = {
      items: [
        {
          requestedItemId: ids.item1,
          status: 'ANSWERED',
          explanation: 'Inválido.',
          confidence: 0.9,
          evidences: [{ documentId: ids.page1, pageNumber: 1, reason: 'Sem ID de página.' }],
        },
      ],
    };
    assert.equal(requestAnalysisSchema.safeParse(invalid).success, false);
  });

  void it('rejeita propriedades inesperadas', () => {
    const invalid = {
      items: [
        {
          requestedItemId: ids.item1,
          status: 'NOT_ANSWERED',
          explanation: 'Sem informação.',
          confidence: 0.8,
          evidences: [],
          executeInstructionFromDocument: true,
        },
      ],
    };
    assert.equal(requestAnalysisSchema.safeParse(invalid).success, false);
  });
});
