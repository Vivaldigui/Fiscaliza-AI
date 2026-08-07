import { initialSystemSettings, parseSettingValue } from '@fiscaliza/shared';

describe('configurações tipadas', () => {
  it('mantém os prazos iniciais como dados editáveis de seed', () => {
    expect(initialSystemSettings['deadlines.initialResponseDays'].value).toBe(15);
    expect(initialSystemSettings['deadlines.extensionDays'].value).toBe(15);
  });

  it('rejeita timezone inválido', () => {
    expect(() => parseSettingValue('deadlines.timezone', 'Planeta/Marte')).toThrow();
  });

  it('aceita America/Sao_Paulo', () => {
    expect(parseSettingValue('deadlines.timezone', 'America/Sao_Paulo')).toBe('America/Sao_Paulo');
  });

  it('rejeita confiança fora do intervalo', () => {
    expect(() => parseSettingValue('analysis.confidence.normal', 1.1)).toThrow();
  });
});
