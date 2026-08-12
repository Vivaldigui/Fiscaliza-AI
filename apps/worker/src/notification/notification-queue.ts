export const NOTIFICATION_QUEUE = 'notification-delivery';
export const NOTIFICATION_JOB = 'deliver';

export interface NotificationQueuePayload {
  outboxEventId?: string;
  notificationId: string;
}

/** Deterministic per notification so a duplicate outbox event can never enqueue the same delivery twice. */
export function notificationJobId(
  payload: Pick<NotificationQueuePayload, 'notificationId'>,
): string {
  return `notification:${payload.notificationId}`;
}
