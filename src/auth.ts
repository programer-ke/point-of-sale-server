import { GraphQLError } from "graphql";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { getTenantMembership } from "./repositories/tenant-repository";

export type UserRole = "admin" | "staff";

export interface AuthenticatedUser {
  id: string;
  username: string;
  roles: UserRole[];
  activeRole: UserRole;
  tenantId?: string;
  tenantName?: string;
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
  requestedRole?: string,
): AuthenticatedUser => {
  const id = claims.sub;
  const username = claims.username ?? claims["cognito:username"];
  const roles = parseRoles(claims["cognito:groups"]);

  if (typeof id !== "string" || typeof username !== "string") {
    throw unauthenticatedError();
  }
  if (requestedRole !== undefined && requestedRole !== "admin" && requestedRole !== "staff") {
    throw forbiddenError();
  }

  const activeRole = requestedRole === "admin" || requestedRole === "staff"
    ? requestedRole
    : roles.includes("admin") ? "admin" : "staff";
  if (roles.length > 0 && !roles.includes(activeRole)) throw forbiddenError();

  return { id, username, roles, activeRole };
};

const attachTenantMembership = async (identity: AuthenticatedUser): Promise<AuthenticatedUser> => {
  const membership = await getTenantMembership(identity.id);
  if (membership) {
    const activeRole = membership.roles.includes(identity.activeRole)
      ? identity.activeRole
      : membership.roles.includes("admin") ? "admin" : "staff";
    return { ...identity, roles: membership.roles, activeRole, tenantId: membership.tenantId, tenantName: membership.tenantName };
  }
  return identity;
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
  requestedRole?: string,
): Promise<GraphQLContext> => {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) throw unauthenticatedError();

  try {
    const claims = await configuredVerifier().verify(match[1]);
    return { auth: await attachTenantMembership(authenticatedUserFromClaims(claims, requestedRole)) };
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
  const requestedRole = request.headers?.["x-tomkondi-role"] ?? request.headers?.["X-Tomkondi-Role"];
  if (process.env.TRUST_API_GATEWAY_JWT_AUTHORIZER === "true" && claims) {
    return { auth: await attachTenantMembership(authenticatedUserFromClaims(claims, requestedRole)) };
  }

  const authorization =
    request.headers?.authorization ?? request.headers?.Authorization;
  return contextFromAuthorization(authorization, requestedRole);
};

export const requireRole = (
  context: GraphQLContext,
  allowedRoles: UserRole[],
) => {
  const activeRole = context.auth.activeRole ?? (context.auth.roles.includes("admin") ? "admin" : "staff");
  if (!context.auth.tenantId || !allowedRoles.includes(activeRole)) {
    throw forbiddenError();
  }
  return context.auth;
};

export const requireIdentity = (context: GraphQLContext) => context.auth;
