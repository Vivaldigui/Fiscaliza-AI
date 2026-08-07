import type { DeadlinePolicy } from '@fiscaliza/shared';
import { calculateDueDate, countSuspendedDays, dateInTimeZone } from './deadline-calculator';

const policy: DeadlinePolicy = {
  policyVersion: 1,
  initialResponseDays: 15,
  extensionDays: 15,
  countingMode: 'CALENDAR_DAYS',
  timezone: 'America/Sao_Paulo',
  dueSoonDays: 3,
  suspensionEnabled: true,
  startDayRule: 'EXCLUDE_START_DATE',
  nonBusinessDueDateRule: 'NEXT_BUSINESS_DAY',
  holidayScopes: ['NATIONAL', 'STATE', 'MUNICIPAL', 'INSTITUTIONAL'],
};

describe('deadline calculator', () => {
  it('calcula 15 dias corridos excluindo o dia inicial', () => {
    expect(calculateDueDate('2026-08-03', 15, policy, []).dueDate).toBe('2026-08-18');
  });

  it('calcula 15 dias úteis', () => {
    expect(
      calculateDueDate('2026-08-03', 15, { ...policy, countingMode: 'BUSINESS_DAYS' }, []).dueDate,
    ).toBe('2026-08-24');
  });

  it('move vencimento de sábado para o próximo dia útil', () => {
    expect(calculateDueDate('2026-08-07', 1, policy, []).dueDate).toBe('2026-08-10');
  });

  it('respeita feriado municipal no cálculo útil', () => {
    expect(
      calculateDueDate('2026-08-03', 2, { ...policy, countingMode: 'BUSINESS_DAYS' }, [
        { date: '2026-08-04', scope: 'MUNICIPAL' },
      ]).dueDate,
    ).toBe('2026-08-06');
  });

  it('preserva a regra de prorrogação sobre o vencimento anterior', () => {
    expect(calculateDueDate('2026-08-20', 15, policy, []).dueDate).toBe('2026-09-04');
  });

  it('acrescenta dias suspensos sem perder o calendário anterior', () => {
    expect(
      countSuspendedDays(
        new Date('2026-08-10T12:00:00-03:00'),
        new Date('2026-08-13T12:00:00-03:00'),
        policy,
        [],
      ),
    ).toBe(3);
  });

  it('usa America/Sao_Paulo na virada de data', () => {
    expect(dateInTimeZone(new Date('2026-08-08T01:30:00Z'), 'America/Sao_Paulo')).toBe(
      '2026-08-07',
    );
  });
});
