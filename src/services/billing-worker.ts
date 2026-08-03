import { DeleteCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME } from "../config/db";
import { addBillingDays, billingStatus, kenyaDate } from "../domain/billing";
import { listBillingPayments, listPlatformBillingAccounts } from "../repositories/billing-repository";
import { listTenantMemberships } from "../repositories/tenant-repository";
import { createNotification } from "../repositories/notification-repository";
import { getCognitoUser } from "./cognito";
import { sendBillingEmail } from "./billing-email";

const reminderFor = (endOn: string, today: string, status: string) => {
  const days = (Date.parse(`${endOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  if ([7, 3, 1].includes(days)) return { key: `before-${days}`, subject: `Tomkondi payment due in ${days} day${days === 1 ? "" : "s"}`, message: `Your subscription is paid through ${endOn}. Renew before the grace period ends to keep staff access active.` };
  if (days === 0) return { key: "due", subject: "Tomkondi payment is due", message: `Your subscription is due today, ${endOn}. A one-day grace period is now available.` };
  if ((status === "restricted" || status === "cancelled") && today === addBillingDays(endOn, 2)) return { key: "restricted", subject: "Tomkondi staff access is restricted", message: "The payment grace period has ended. Business administrators can still sign in to review billing, reports, and exports." };
  return null;
};

export const processBillingReminders = async (today = kenyaDate()) => {
  const accounts = await listPlatformBillingAccounts();
  let sent = 0;
  for (const account of accounts) {
    const payments = await listBillingPayments(account.tenantId);
    if (payments.some((payment) => payment.status === "submitted")) continue;
    const endOn = account.paidThrough ?? account.trialEndsOn;
    const reminder = reminderFor(endOn, today, billingStatus(account, today));
    if (!reminder) continue;
    const eventKey = `${today}#${reminder.key}`;
    const markerKey = { partitionKey: `TENANT#${account.tenantId}`, sortKey: `BILLING#REMINDER#${eventKey}` };
    try {
      await dynamoDB.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...markerKey, entityType: "billing_reminder", tenantId: account.tenantId, eventKey, status: "sending", createdAt: new Date().toISOString() }, ConditionExpression: "attribute_not_exists(partitionKey)" }));
    } catch (error) {
      if (error instanceof Error && error.name === "ConditionalCheckFailedException") continue;
      throw error;
    }
    try {
      const owner = await getCognitoUser(account.ownerUsername);
      await sendBillingEmail({ to: owner.email, subject: reminder.subject, heading: reminder.subject, message: reminder.message });
      const admins = (await listTenantMemberships(account.tenantId)).filter(({ roles }) => roles.includes("admin"));
      await Promise.all(admins.map((admin) => createNotification(account.tenantId, admin.userId, {
        eventKey: `billing:${eventKey}`, type: "billing", title: reminder.subject, message: reminder.message, actionPath: "/dashboard/billing",
      })));
      await dynamoDB.send(new UpdateCommand({ TableName: TABLE_NAME, Key: markerKey, UpdateExpression: "SET #status = :sent, sentAt = :now", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":sent": "sent", ":now": new Date().toISOString() } }));
      sent += 1;
    } catch (error) {
      await dynamoDB.send(new DeleteCommand({ TableName: TABLE_NAME, Key: markerKey })).catch(() => undefined);
      console.error(JSON.stringify({ event: "billing_reminder_failed", tenantId: account.tenantId, reminder: reminder.key, errorName: error instanceof Error ? error.name : "UnknownError" }));
    }
  }
  return { checked: accounts.length, sent };
};
