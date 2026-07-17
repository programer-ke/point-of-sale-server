import { ApolloServer } from "@apollo/server";
import dotenv from "dotenv";
import { typeDefs } from "./graphql/schema";
import { resolvers } from "./graphql/resolvers";

dotenv.config();

export function createApolloServer(): ApolloServer {
  return new ApolloServer({
    typeDefs,
    resolvers,
  });
}
