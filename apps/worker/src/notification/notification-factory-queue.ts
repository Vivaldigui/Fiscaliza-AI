export const NOTIFICATION_FACTORY_QUEUE = 'notification-factory';
export const NOTIFICATION_FACTORY_JOB = 'create-notifications';

export interface NotificationFactoryPayload {
  outboxEventId?: string;
  eventType: 'ResponseAnalysisCompleted' | 'DeadlineApproaching' | 'DeadlineExpired';
  analysisId?: string;
  deadlineId?: string;
  propositionId?: string;
  dueDate?: string;
}

export function responseAnalysisJobId(payload: { analysisId: string }): string {
  return `response-analysis:${payload.analysisId}`;
}

export function deadlineJobId(payload: {
  deadlineId: string;
  eventType: string;
  dueDate?: string;
}): string {
  return `deadline:${payload.deadlineId}:${payload.eventType}:${payload.dueDate ?? 'none'}`;
}
