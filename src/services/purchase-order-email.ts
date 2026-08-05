import {
  GetSuppressedDestinationCommand,
  SESv2Client,
  SendEmailCommand,
} from "@aws-sdk/client-sesv2";
import { createHash } from "node:crypto";
import type { BusinessSettingsRecord } from "../repositories/pos-repository";
import type { PurchaseOrderRecord, SupplierRecord } from "../repositories/supply-chain-repository";
import { logEvent } from "../observability";

export type PurchaseOrderEmailStatus = "sent" | "not_configured" | "suppressed" | "failed";
export interface PurchaseOrderEmailResult {
  emailStatus: PurchaseOrderEmailStatus;
  emailRecipient: string | null;
  emailMessageId: string | null;
  emailAttemptedAt: string;
  emailError: string | null;
}

export const normalizeEmail = (value: string) => value.trim().toLowerCase();
export const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
export const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const money = (value: number) => new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 2,
}).format(value);

const ses = new SESv2Client({ region: process.env.AWS_REGION ?? "us-east-1" });
const recipientReference = (email: string) =>
  createHash("sha256").update(email).digest("hex").slice(0, 12);

export const renderPurchaseOrderEmail = (
  order: PurchaseOrderRecord,
  supplier: SupplierRecord,
  business: BusinessSettingsRecord,
) => {
  const rows = order.lines.map((line) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0">${escapeHtml(line.supplierSku || "—")}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0">${escapeHtml(line.productName)}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right">${line.orderedPurchaseQuantity} ${escapeHtml(line.purchaseUnit)}${line.orderedPurchaseQuantity === 1 ? "" : "s"}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right">${escapeHtml(money(line.pricePerPurchaseUnit))}</td>
      <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right">${escapeHtml(money(line.orderedPurchaseQuantity * line.pricePerPurchaseUnit))}</td>
    </tr>`).join("");
  const textLines = order.lines.map((line) =>
    `${line.supplierSku || "—"} | ${line.productName} | ${line.orderedPurchaseQuantity} ${line.purchaseUnit}${line.orderedPurchaseQuantity === 1 ? "" : "s"} | ${money(line.pricePerPurchaseUnit)} | ${money(line.orderedPurchaseQuantity * line.pricePerPurchaseUnit)}`,
  ).join("\n");
  const businessContact = [business.address, business.phone, business.email].filter(Boolean).join(" · ");
  const expected = order.expectedDeliveryDate || "Not specified";
  const businessNameForSubject = business.businessName.replace(/[\r\n]+/g, " ").trim();

  return {
    subject: `${order.orderNumber} from ${businessNameForSubject}`,
    html: `<div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.5;max-width:760px;margin:auto">
      <h1 style="margin-bottom:4px">${escapeHtml(business.businessName)}</h1>
      <p style="color:#64748b;margin-top:0">${escapeHtml(businessContact)}</p>
      <h2 style="color:#1d4ed8">Purchase order ${escapeHtml(order.orderNumber)}</h2>
      <p>Dear ${escapeHtml(supplier.contactName || supplier.name)},</p>
      <p>Please supply the items below to <strong>${escapeHtml(order.storeName)}</strong>. Expected delivery: <strong>${escapeHtml(expected)}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0">
        <thead><tr style="background:#eff6ff"><th style="padding:8px;text-align:left">Supplier SKU</th><th style="padding:8px;text-align:left">Product</th><th style="padding:8px;text-align:right">Quantity</th><th style="padding:8px;text-align:right">Price / unit</th><th style="padding:8px;text-align:right">Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="font-size:18px;text-align:right"><strong>Total: ${escapeHtml(money(order.totalAmount))}</strong></p>
      ${order.notes ? `<div style="background:#f8fafc;padding:12px;border-radius:6px"><strong>Notes</strong><br>${escapeHtml(order.notes).replaceAll("\n", "<br>")}</div>` : ""}
      <p style="color:#64748b;font-size:13px;margin-top:24px">This is a transactional purchase order sent by ${escapeHtml(business.businessName)}.</p>
    </div>`,
    text: `${business.businessName}\n${businessContact}\n\nPURCHASE ORDER ${order.orderNumber}\n\nDear ${supplier.contactName || supplier.name},\n\nPlease supply the items below to ${order.storeName}.\nExpected delivery: ${expected}\n\nSupplier SKU | Product | Quantity | Price / unit | Total\n${textLines}\n\nTotal: ${money(order.totalAmount)}${order.notes ? `\n\nNotes:\n${order.notes}` : ""}\n`,
  };
};

const safeError = (error: unknown) => {
  if (!(error instanceof Error)) return "Email delivery failed";
  if (error.name === "TooManyRequestsException" || error.name === "ThrottlingException") return "SES temporarily throttled the request";
  if (error.name === "MessageRejected") return "SES rejected the message";
  return "SES could not accept the email";
};

export const sendPurchaseOrderEmail = async (
  order: PurchaseOrderRecord,
  supplier: SupplierRecord,
  business: BusinessSettingsRecord,
  client: Pick<SESv2Client, "send"> = ses,
): Promise<PurchaseOrderEmailResult> => {
  const emailAttemptedAt = new Date().toISOString();
  const recipient = normalizeEmail(supplier.email);
  const recipientRef = recipientReference(recipient);
  if (!recipient || !isValidEmail(recipient)) {
    return { emailStatus: "not_configured", emailRecipient: recipient || null, emailMessageId: null, emailAttemptedAt, emailError: "Supplier email is not configured" };
  }

  try {
    await client.send(new GetSuppressedDestinationCommand({ EmailAddress: recipient }));
    return { emailStatus: "suppressed", emailRecipient: recipient, emailMessageId: null, emailAttemptedAt, emailError: "SES has suppressed this address after a bounce or complaint" };
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "NotFoundException") {
      const result = { emailStatus: "failed" as const, emailRecipient: recipient, emailMessageId: null, emailAttemptedAt, emailError: safeError(error) };
      logEvent("error", "purchase_order_email_suppression_check_failed", { entityId: order.id, recipientRef, errorName: error instanceof Error ? error.name : "UnknownError" });
      return result;
    }
  }

  const content = renderPurchaseOrderEmail(order, supplier, business);
  try {
    const response = await client.send(new SendEmailCommand({
      FromEmailAddress: process.env.SES_FROM_EMAIL || "BiasharaKit Orders <orders@biasharakit.com>",
      ReplyToAddresses: [process.env.SES_REPLY_TO_EMAIL || "support@biasharakit.com"],
      Destination: { ToAddresses: [recipient] },
      Content: { Simple: {
        Subject: { Data: content.subject, Charset: "UTF-8" },
        Body: {
          Html: { Data: content.html, Charset: "UTF-8" },
          Text: { Data: content.text, Charset: "UTF-8" },
        },
      } },
    }));
    logEvent("info", "purchase_order_email_accepted", { entityId: order.id, recipientRef, providerMessageId: response.MessageId });
    return { emailStatus: "sent", emailRecipient: recipient, emailMessageId: response.MessageId ?? null, emailAttemptedAt, emailError: null };
  } catch (error) {
    logEvent("error", "purchase_order_email_failed", { entityId: order.id, recipientRef, errorName: error instanceof Error ? error.name : "UnknownError" });
    return { emailStatus: "failed", emailRecipient: recipient, emailMessageId: null, emailAttemptedAt, emailError: safeError(error) };
  }
};
