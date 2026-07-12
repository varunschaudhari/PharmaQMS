// PLT-6: templated content for workflow-driven notifications. The rendered title/body is stored
// on the notification log entry AND used as the email subject/text — one source of wording.
export interface NotificationContent {
  title: string;
  body: string;
}

export function taskAssignedContent(entityType: string, entityId: string, stepName: string): NotificationContent {
  return {
    title: `Approval task: ${entityType} ${entityId}`,
    body: `${entityType} ${entityId} is awaiting your action at step "${stepName}".`,
  };
}

export function approvedContent(entityType: string, entityId: string, actorFullName: string): NotificationContent {
  return {
    title: `Approved: ${entityType} ${entityId}`,
    body: `${entityType} ${entityId} completed its approval workflow. Final approval by ${actorFullName}.`,
  };
}

export function rejectedContent(
  entityType: string,
  entityId: string,
  actorFullName: string,
  comment: string | null,
): NotificationContent {
  return {
    title: `Rejected: ${entityType} ${entityId}`,
    body:
      `${entityType} ${entityId} was rejected by ${actorFullName}.` +
      (comment ? ` Reason: ${comment}` : ''),
  };
}
