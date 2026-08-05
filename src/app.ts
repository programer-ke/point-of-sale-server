import { ApolloServer } from "@apollo/server";
import dotenv from "dotenv";
import { typeDefs } from "./graphql/schema";
import { resolvers } from "./graphql/resolvers";
import type { GraphQLContext } from "./auth";
import { validateBillingEnvironment } from "./repositories/billing-repository";
import { observabilityPlugin } from "./observability";

dotenv.config({ quiet: true });

export function createApolloServer(): ApolloServer<GraphQLContext> {
  validateBillingEnvironment();
  return new ApolloServer<GraphQLContext>({
    typeDefs,
    resolvers,
    plugins: [observabilityPlugin()],
  });
}
