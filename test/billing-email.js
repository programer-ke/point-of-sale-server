const assert = require("node:assert/strict");
const { sendBillingEmail } = require("../dist/services/billing-email.js");

async function main() {
  const sentCommands = [];
  let sendEmailInput;
  const result = await sendBillingEmail({
    to: " Owner@Example.COM ",
    subject: "Billing update",
    heading: "Payment received",
    message: "Thank you.",
  }, {
    send: async (command) => {
      sentCommands.push(command.constructor.name);
      if (command.constructor.name === "GetSuppressedDestinationCommand") {
        const error = new Error("not found");
        error.name = "NotFoundException";
        throw error;
      }
      sendEmailInput = command.input;
      return { MessageId: "message-1" };
    },
  });

  assert.deepEqual(sentCommands, ["GetSuppressedDestinationCommand", "SendEmailCommand"]);
  assert.deepEqual(sendEmailInput.Destination.ToAddresses, ["owner@example.com"]);
  assert.deepEqual(sendEmailInput.ReplyToAddresses, ["support@biasharakit.com"]);
  assert.deepEqual(result, { status: "sent", messageId: "message-1" });
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
