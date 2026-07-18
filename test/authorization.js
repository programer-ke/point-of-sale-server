const assert = require("node:assert/strict");
const repository = require("../dist/repositories/pos-repository.js");
repository.listProducts = async () => [{ id: "1" }];
const { createApolloServer } = require("../dist/app.js");

async function main() {
  const server = createApolloServer();
  await server.start();

  const staffContext = {
    auth: {
      id: "staff-1",
      username: "staff@example.com",
      roles: ["staff"],
    },
  };

  const denied = await server.executeOperation(
    { query: "query { users { id } }" },
    { contextValue: staffContext },
  );
  assert.equal(denied.body.kind, "single");
  assert.equal(denied.body.singleResult.errors[0].extensions.code, "FORBIDDEN");

  const allowed = await server.executeOperation(
    { query: "query { products { id } }" },
    { contextValue: staffContext },
  );
  assert.equal(allowed.body.kind, "single");
  assert.equal(allowed.body.singleResult.errors, undefined);
  assert.equal(allowed.body.singleResult.data.products[0].id, "1");

  await server.stop();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
