import { ApolloServer } from "@apollo/server";
import dotenv from "dotenv";
import { typeDefs } from "./graphql/schema";
import { resolvers } from "./graphql/resolvers";
import type { GraphQLContext } from "./auth";

dotenv.config({ quiet: true });

export function createApolloServer(): ApolloServer<GraphQLContext> {
  return new ApolloServer<GraphQLContext>({
    typeDefs,
    resolvers,
  });
}
