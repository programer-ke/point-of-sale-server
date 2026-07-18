// server.ts
import { startStandaloneServer } from "@apollo/server/standalone";
import dotenv from "dotenv";
import { createApolloServer } from "./app";
import { verifyAwsConnection } from "./config/db";
import { contextFromAuthorization } from "./auth";

dotenv.config({ quiet: true });

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "127.0.0.1";

async function startServer() {
  console.log("\n" + "=".repeat(60));
  console.log("🚀 Starting Server");
  console.log("=".repeat(60));

  // Test DynamoDB connection
  console.log("\n🔌 Testing DynamoDB connection...");
  const isConnected = await verifyAwsConnection();

  if (!isConnected) {
    console.error("\n❌ Failed to connect to DynamoDB");
    console.error(
      "💡 Check the AWS credential provider, region, table name, and network connectivity",
    );
    process.exit(1);
  }

  console.log("\n✅ DynamoDB connection established");

  // Start Apollo Server
  try {
    console.log("\n📡 Starting Apollo Server...");
    const server = createApolloServer();

    const { url } = await startStandaloneServer(server, {
      listen: {
        host: HOST,
        port: Number(PORT),
      },
      context: async ({ req }) => {
        const requestedRole = req.headers["x-tomkondi-role"];
        return contextFromAuthorization(
          req.headers.authorization,
          Array.isArray(requestedRole) ? requestedRole[0] : requestedRole,
        );
      },
    });

    console.log("\n" + "=".repeat(60));
    console.log(`✅ Server ready at ${url}`);
    console.log(`📍 Running on http://${HOST}:${PORT}`);
    console.log("=".repeat(60));
    console.log("\nPress Ctrl+C to stop the server");
  } catch (error) {
    console.error("\n❌ Failed to start Apollo Server:", error);
    process.exit(1);
  }
}

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("\n⚠️  SIGTERM received, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("\n⚠️  SIGINT received, shutting down gracefully...");
  process.exit(0);
});

startServer();
