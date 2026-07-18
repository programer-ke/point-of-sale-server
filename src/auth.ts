import { GraphQLError } from "graphql";
import { CognitoJwtVerifier } from "aws-jwt-verify";

export type UserRole = "admin" | "staff";

export interface AuthenticatedUser {
  id: string;
  username: string;
  roles: UserRole[];
}

export interface GraphQLContext {
  auth: AuthenticatedUser;
}

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | undefined;

const configuredVerifier = () => {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_USER_POOL_CLIENT_ID;

  if (!userPoolId || !clientId) {
    throw new Error(
      "COGNITO_USER_POOL_ID and COGNITO_USER_POOL_CLIENT_ID are required",
    );
  }

  verifier ??= CognitoJwtVerifier.create({
    userPoolId,
    clientId,
    tokenUse: "access",
  });
  return verifier;
};

const parseRoles = (groups: unknown): UserRole[] => {
  const values = Array.isArray(groups)
    ? groups
    : typeof groups === "string"
      ? groups.replace(/^\[|\]$/g, "").split(/[ ,]+/)
      : [];

  return [...new Set(values.filter((value): value is UserRole => value === "admin" || value === "staff"))];
};

const authenticatedUserFromClaims = (
  claims: Record<string, unknown>,
): AuthenticatedUser => {
  const id = claims.sub;
  const username = claims.username ?? claims["cognito:username"];
  const roles = parseRoles(claims["cognito:groups"]);

  if (typeof id !== "string" || typeof username !== "string" || roles.length === 0) {
    throw unauthenticatedError();
  }

  return { id, username, roles };
};

export const unauthenticatedError = () =>
  new GraphQLError("Authentication is required", {
    extensions: { code: "UNAUTHENTICATED" },
  });

export const forbiddenError = () =>
  new GraphQLError("You do not have permission to perform this operation", {
    extensions: { code: "FORBIDDEN" },
  });

export const contextFromAuthorization = async (
  authorization: string | undefined,
): Promise<GraphQLContext> => {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) throw unauthenticatedError();

  try {
    const claims = await configuredVerifier().verify(match[1]);
    return { auth: authenticatedUserFromClaims(claims) };
  } catch (error) {
    if (error instanceof GraphQLError) throw error;
    throw unauthenticatedError();
  }
};

export const contextFromApiGatewayEvent = async (
  event: unknown,
): Promise<GraphQLContext> => {
  const request = event as {
    headers?: Record<string, string | undefined>;
    requestContext?: {
      authorizer?: { jwt?: { claims?: Record<string, unknown> } };
    };
  };
  const claims = request.requestContext?.authorizer?.jwt?.claims;
  if (process.env.TRUST_API_GATEWAY_JWT_AUTHORIZER === "true" && claims) {
    return { auth: authenticatedUserFromClaims(claims) };
  }

  const authorization =
    request.headers?.authorization ?? request.headers?.Authorization;
  return contextFromAuthorization(authorization);
};

export const requireRole = (
  context: GraphQLContext,
  allowedRoles: UserRole[],
) => {
  if (!context.auth.roles.some((role) => allowedRoles.includes(role))) {
    throw forbiddenError();
  }
  return context.auth;
};
