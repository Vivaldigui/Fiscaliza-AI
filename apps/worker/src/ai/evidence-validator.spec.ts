import { excerptExistsOnPage, normalizeForMatch } from './evidence-validator';

describe('evidence-validator', () => {
  it('aceita trecho real mesmo com quebras de linha e espaços diferentes', () => {
    const pageText = 'A frota é composta\npor   12  veículos.\n\nManutenção realizada em janeiro.';
    expect(excerptExistsOnPage('A frota é composta por 12 veículos.', pageText)).toBe(true);
  });

  it('rejeita trecho que não existe na página (trecho inventado)', () => {
    const pageText = 'A frota é composta por 12 veículos.';
    expect(excerptExistsOnPage('Foram gastos R$ 48.230,17 com manutenção.', pageText)).toBe(false);
  });

  it('permite evidência visual sem excerto', () => {
    expect(excerptExistsOnPage(undefined, 'qualquer texto')).toBe(true);
  });

  it('normaliza acentuação e caixa de forma estável', () => {
    expect(normalizeForMatch('AÇÃO   Múltipla')).toBe(normalizeForMatch('ação múltipla'));
  });
});
