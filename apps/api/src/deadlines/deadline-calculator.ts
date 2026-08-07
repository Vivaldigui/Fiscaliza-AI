import type { DeadlinePolicy } from '@fiscaliza/shared';

export interface HolidayDate {
  date: string;
  scope: string;
}

export interface DeadlineCalculation {
  dueDate: string;
  countedDays: number;
  adjustedFrom?: string;
}

export function calculateDueDate(
  baseDate: string,
  days: number,
  policy: DeadlinePolicy,
  holidays: HolidayDate[],
): DeadlineCalculation {
  assertIsoDate(baseDate);
  if (!Number.isInteger(days) || days < 0) throw new Error('Quantidade de dias inválida.');
  const holidaySet = scopedHolidaySet(holidays, policy.holidayScopes);
  let cursor = baseDate;
  let remaining = days;

  if (policy.startDayRule === 'INCLUDE_START_DATE' && remaining > 0) {
    if (policy.countingMode === 'CALENDAR_DAYS' || isBusinessDay(cursor, holidaySet)) {
      remaining -= 1;
    }
  }

  while (remaining > 0) {
    cursor = addDays(cursor, 1);
    if (policy.countingMode === 'CALENDAR_DAYS' || isBusinessDay(cursor, holidaySet)) {
      remaining -= 1;
    }
  }

  const unadjusted = cursor;
  if (!isBusinessDay(cursor, holidaySet)) {
    if (policy.nonBusinessDueDateRule === 'NEXT_BUSINESS_DAY') {
      while (!isBusinessDay(cursor, holidaySet)) cursor = addDays(cursor, 1);
    } else if (policy.nonBusinessDueDateRule === 'PREVIOUS_BUSINESS_DAY') {
      while (!isBusinessDay(cursor, holidaySet)) cursor = addDays(cursor, -1);
    }
  }

  return {
    dueDate: cursor,
    countedDays: days,
    ...(cursor !== unadjusted ? { adjustedFrom: unadjusted } : {}),
  };
}

export function countSuspendedDays(
  startedAt: Date,
  endedAt: Date,
  policy: DeadlinePolicy,
  holidays: HolidayDate[],
): number {
  if (endedAt < startedAt) throw new Error('Fim da suspensão anterior ao início.');
  const start = dateInTimeZone(startedAt, policy.timezone);
  const end = dateInTimeZone(endedAt, policy.timezone);
  const holidaySet = scopedHolidaySet(holidays, policy.holidayScopes);
  let cursor = start;
  let total = 0;
  while (cursor < end) {
    cursor = addDays(cursor, 1);
    if (policy.countingMode === 'CALENDAR_DAYS' || isBusinessDay(cursor, holidaySet)) total += 1;
  }
  return total;
}

export function dateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value;
  const result = `${part('year')}-${part('month')}-${part('day')}`;
  assertIsoDate(result);
  return result;
}

export function databaseDate(value: string): Date {
  assertIsoDate(value);
  return new Date(`${value}T00:00:00.000Z`);
}

export function isoDatabaseDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addDays(value: string, amount: number): string {
  assertIsoDate(value);
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function daysUntil(from: string, to: string): number {
  assertIsoDate(from);
  assertIsoDate(to);
  return Math.round(
    (Date.parse(`${to}T12:00:00.000Z`) - Date.parse(`${from}T12:00:00.000Z`)) / 86_400_000,
  );
}

function scopedHolidaySet(holidays: HolidayDate[], scopes: string[]): Set<string> {
  const allowed = new Set(scopes);
  return new Set(holidays.filter(({ scope }) => allowed.has(scope)).map(({ date }) => date));
}

function isBusinessDay(value: string, holidays: Set<string>): boolean {
  const weekday = new Date(`${value}T12:00:00.000Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !holidays.has(value);
}

function assertIsoDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`Data civil inválida: ${value}`);
  }
}
