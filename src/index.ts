// server.ts
import { startStandaloneServer } from "@apollo/server/standalone";
import dotenv from "dotenv";
import { createApolloServer } from "./app";
import { testConnection } from "./utils/db-helpers";

dotenv.config();

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "127.0.0.1";

const validateEnvironment = () => {
  const required = ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(`❌ Missing environment variables: ${missing.join(", ")}`);
    console.error("   Please check your .env file");
    return false;
  }

  console.log("✅ Environment variables validated");
  return true;
};

async function startServer() {
  console.log("\n" + "=".repeat(60));
  console.log("🚀 Starting Server");
  console.log("=".repeat(60));

  // Validate environment variables
  if (!validateEnvironment()) {
    process.exit(1);
  }

  // Test DynamoDB connection
  console.log("\n🔌 Testing DynamoDB connection...");
  const isConnected = await testConnection();

  if (!isConnected) {
    console.error("\n❌ Failed to connect to DynamoDB");
    console.error("💡 Please check:");
    console.error("   1. AWS credentials are correct");
    console.error("   2. AWS region is correct");
    console.error("   3. Table name exists");
    console.error("   4. Network connectivity to AWS");
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
        return { req };
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
