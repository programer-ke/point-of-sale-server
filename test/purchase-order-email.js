const assert = require("node:assert/strict");
const {
  escapeHtml,
  isValidEmail,
  renderPurchaseOrderEmail,
  sendPurchaseOrderEmail,
} = require("../dist/services/purchase-order-email.js");

const order = {
  id: "po-1", orderNumber: "PO-001", supplierId: "supplier-1", supplierName: "Supplier",
  storeId: "store-1", storeName: "Main <Store>", status: "issued",
  expectedDeliveryDate: "2026-08-01", notes: "Leave at <rear> & call",
  lines: [{
    id: "line-1", productId: "product-1", productName: "Tea <Premium>", baseUnit: "each",
    stockUnit: "each", supplierSku: "TEA&1", purchaseUnit: "carton", purchaseQuantity: 12,
    purchaseMeasurementUnit: "each", unitsPerPurchaseUnit: 12, orderedPurchaseQuantity: 2,
    acceptedBaseQuantity: 0, pricePerPurchaseUnit: 960,
  }],
  totalAmount: 1920, createdBy: "admin", createdByName: "Admin", receiptCount: 0,
  issuedAt: "2026-07-28T10:00:00.000Z", createdAt: "2026-07-28T09:00:00.000Z",
  updatedAt: "2026-07-28T10:00:00.000Z",
};
const supplier = {
  id: "supplier-1", code: "SUP", name: "Supplier & Co", contactName: "A <Buyer>",
  phone: "", email: " Buyer@Example.COM ", address: "", status: "active",
  createdAt: order.createdAt, updatedAt: order.createdAt,
};
const business = {
  businessName: "Tomkondi <Shop>", address: "Nairobi", phone: "123", email: "sales@example.com",
  thankYouMessage: "", returnPolicy: "", storeName: "Main", updatedAt: order.updatedAt,
};

async function main() {
  assert.equal(escapeHtml(`<script>"&'</script>`), "&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;");
  assert.equal(isValidEmail(" USER@example.com "), true);
  assert.equal(isValidEmail("not-an-email"), false);
  const rendered = renderPurchaseOrderEmail(order, supplier, business);
  assert.doesNotMatch(rendered.html, /<script>|<Premium>|<rear>|<Shop>/);
  assert.match(rendered.html, /Tea &lt;Premium&gt;/);
  assert.match(rendered.text, /Ksh/);

  const sentCommands = [];
  const sent = await sendPurchaseOrderEmail(order, supplier, business, {
    send: async (command) => {
      sentCommands.push(command.constructor.name);
      if (command.constructor.name === "GetSuppressedDestinationCommand") {
        const error = new Error("not found"); error.name = "NotFoundException"; throw error;
      }
      return { MessageId: "message-1" };
    },
  });
  assert.equal(sent.emailStatus, "sent");
  assert.equal(sent.emailRecipient, "buyer@example.com");
  assert.equal(sent.emailMessageId, "message-1");
  assert.deepEqual(sentCommands, ["GetSuppressedDestinationCommand", "SendEmailCommand"]);

  const suppressed = await sendPurchaseOrderEmail(order, supplier, business, {
    send: async () => ({ SuppressedDestination: { Reason: "BOUNCE" } }),
  });
  assert.equal(suppressed.emailStatus, "suppressed");

  const missing = await sendPurchaseOrderEmail(order, { ...supplier, email: "" }, business, {
    send: async () => { throw new Error("must not send"); },
  });
  assert.equal(missing.emailStatus, "not_configured");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
