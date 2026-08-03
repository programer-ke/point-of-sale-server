import { GetSuppressedDestinationCommand, SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

const ses = new SESv2Client({ region: process.env.AWS_REGION ?? "us-east-1" });
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));

export const sendBillingEmail = async (input: { to: string; subject: string; heading: string; message: string }) => {
  const to = input.to.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error("Billing recipient email is invalid");
  try {
    await ses.send(new GetSuppressedDestinationCommand({ EmailAddress: to }));
    return { status: "suppressed" as const };
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "NotFoundException") throw error;
  }
  const from = process.env.BILLING_FROM_EMAIL || process.env.SES_FROM_EMAIL || "Tomkondi Billing <billing@tomkondi.shop>";
  const response = await ses.send(new SendEmailCommand({
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    Content: { Simple: {
      Subject: { Data: input.subject, Charset: "UTF-8" },
      Body: {
        Text: { Data: `${input.heading}\n\n${input.message}\n\nSign in to Tomkondi and open Billing for payment instructions.`, Charset: "UTF-8" },
        Html: { Data: `<div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6;max-width:600px;margin:auto"><h1 style="color:#1d4ed8">${escapeHtml(input.heading)}</h1><p>${escapeHtml(input.message)}</p><p>Sign in to Tomkondi and open <strong>Billing</strong> for payment instructions.</p><p style="color:#64748b;font-size:13px">This message contains billing information only and no sales or customer data.</p></div>`, Charset: "UTF-8" },
      },
    } },
  }));
  return { status: "sent" as const, messageId: response.MessageId ?? null };
};
