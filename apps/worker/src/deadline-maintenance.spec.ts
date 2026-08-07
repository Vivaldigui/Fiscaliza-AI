import type { PrismaClient } from '@fiscaliza/database';
import { refreshDeadlineStatuses } from './deadline-maintenance';

describe('deadline maintenance', () => {
  it('é idempotente e emite DeadlineExpired somente na primeira transição', async () => {
    const deadline = {
      id: 'deadline-1',
      propositionId: 'proposition-1',
      currentDueDate: new Date('2026-08-01T00:00:00Z'),
      status: 'OPEN',
      version: 0,
      configurationSnapshot: {
        policy: {
          policyVersion: 1,
          initialResponseDays: 15,
          extensionDays: 15,
          countingMode: 'CALENDAR_DAYS',
          timezone: 'America/Sao_Paulo',
          dueSoonDays: 3,
          suspensionEnabled: true,
          startDayRule: 'EXCLUDE_START_DATE',
          nonBusinessDueDateRule: 'NEXT_BUSINESS_DAY',
          holidayScopes: [],
        },
      },
    };
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const create = jest.fn();
    const transaction = { deadline: { updateMany }, outboxEvent: { create } };
    const prisma = {
      deadline: { findMany: jest.fn().mockResolvedValue([deadline]) },
      $transaction: (operation: (value: typeof transaction) => unknown) => operation(transaction),
    } as unknown as PrismaClient;

    await refreshDeadlineStatuses(prisma, new Date('2026-08-07T12:00:00Z'));
    await refreshDeadlineStatuses(prisma, new Date('2026-08-07T12:00:00Z'));

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0].data.eventType).toBe('DeadlineExpired');
  });
});
