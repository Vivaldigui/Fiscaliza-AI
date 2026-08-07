import type { PrismaService } from '../database/prisma.service';
import { DeadlinesService } from './deadlines.service';

const basePolicy = {
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

describe('DeadlinesService snapshot', () => {
  it('mantém 15 dias no snapshot A e usa 20 somente no novo prazo B', async () => {
    const setting = { key: 'deadlines.policy.REQUEST', value: basePolicy, version: 1 };
    const prisma = {
      systemSetting: { findUnique: jest.fn().mockImplementation(() => Promise.resolve(setting)) },
      holiday: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const service = new DeadlinesService(prisma);
    const deadlineA = await service.prepare('REQUEST', '2026-08-01');
    setting.value = { ...basePolicy, initialResponseDays: 20 };
    setting.version = 2;
    const deadlineB = await service.prepare('REQUEST', '2026-08-01');

    const snapshotA = deadlineA.configurationSnapshot as unknown as {
      policy: { initialResponseDays: number };
      settingVersion: number;
    };
    expect(snapshotA.policy.initialResponseDays).toBe(15);
    expect(snapshotA.settingVersion).toBe(1);
    expect(deadlineA.currentDueDate.toISOString().slice(0, 10)).toBe('2026-08-17');
    expect(deadlineB.currentDueDate.toISOString().slice(0, 10)).toBe('2026-08-21');
  });
});
