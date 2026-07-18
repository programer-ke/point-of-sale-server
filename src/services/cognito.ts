import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  type AttributeType,
  type UserType,
} from "@aws-sdk/client-cognito-identity-provider";
import type { UserRole } from "../auth";

const userPoolId = () => {
  const value = process.env.COGNITO_USER_POOL_ID;
  if (!value) throw new Error("COGNITO_USER_POOL_ID is required");
  return value;
};

const cognito = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION ?? "us-east-1",
});

const attributesToRecord = (attributes: AttributeType[] | undefined) =>
  Object.fromEntries(
    attributes?.flatMap(({ Name, Value }) =>
      Name && Value !== undefined ? [[Name, Value]] : [],
    ) ?? [],
  );

const normalizeRoles = (roles: readonly string[]): UserRole[] => [
  ...new Set(
    roles.filter((role): role is UserRole => role === "admin" || role === "staff"),
  ),
];

const primaryRole = (roles: UserRole[]) =>
  roles.includes("admin") ? "admin" : roles.includes("staff") ? "staff" : "unassigned";

const mapUser = (user: UserType, roles: UserRole[]) => {
  const attributes = attributesToRecord(user.Attributes);
  const firstName = attributes.given_name ?? "";
  const lastName = attributes.family_name ?? "";
  const createdAt = user.UserCreateDate?.toISOString() ?? new Date(0).toISOString();
  return {
    id: attributes.sub ?? user.Username ?? "",
    username: user.Username ?? "",
    email: attributes.email ?? "",
    name: attributes.name ?? ([firstName, lastName].filter(Boolean).join(" ") || attributes.email || user.Username || ""),
    firstName,
    lastName,
    role: primaryRole(roles),
    roles,
    status: user.Enabled === false ? "DISABLED" : (user.UserStatus ?? "UNKNOWN"),
    emailVerified: attributes.email_verified === "true",
    createdAt,
    updatedAt: user.UserLastModifiedDate?.toISOString() ?? createdAt,
  };
};

const groupsForUser = async (username: string) => {
  const response = await cognito.send(
    new AdminListGroupsForUserCommand({ UserPoolId: userPoolId(), Username: username }),
  );
  return normalizeRoles(response.Groups?.map(({ GroupName }) => GroupName ?? "") ?? []);
};

export const getCognitoUser = async (username: string) => {
  const response = await cognito.send(
    new AdminGetUserCommand({ UserPoolId: userPoolId(), Username: username }),
  );
  const roles = await groupsForUser(response.Username ?? username);
  return mapUser(
    {
      Username: response.Username,
      Attributes: response.UserAttributes,
      Enabled: response.Enabled,
      UserStatus: response.UserStatus,
      UserCreateDate: response.UserCreateDate,
      UserLastModifiedDate: response.UserLastModifiedDate,
    },
    roles,
  );
};

export const listCognitoUsers = async () => {
  const users: UserType[] = [];
  let paginationToken: string | undefined;
  do {
    const response = await cognito.send(
      new ListUsersCommand({ UserPoolId: userPoolId(), PaginationToken: paginationToken }),
    );
    users.push(...(response.Users ?? []));
    paginationToken = response.PaginationToken;
  } while (paginationToken);

  const rolesByUsername = new Map<string, UserRole[]>();
  await Promise.all(
    (["admin", "staff"] as const).map(async (role) => {
      let nextToken: string | undefined;
      do {
        const response = await cognito.send(
          new ListUsersInGroupCommand({
            UserPoolId: userPoolId(),
            GroupName: role,
            NextToken: nextToken,
          }),
        );
        for (const user of response.Users ?? []) {
          if (!user.Username) continue;
          rolesByUsername.set(user.Username, [
            ...(rolesByUsername.get(user.Username) ?? []),
            role,
          ]);
        }
        nextToken = response.NextToken;
      } while (nextToken);
    }),
  );

  return users.map((user) =>
    mapUser(user, rolesByUsername.get(user.Username ?? "") ?? []),
  );
};

export const inviteCognitoUser = async (input: {
  email: string;
  firstName: string;
  lastName: string;
  roles: UserRole[];
}) => {
  const roles = normalizeRoles(input.roles);
  if (roles.length === 0) throw new Error("At least one application role is required");

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName || !lastName) throw new Error("First name and last name are required");
  const response = await cognito.send(new AdminCreateUserCommand({
    UserPoolId: userPoolId(),
    Username: input.email.trim().toLowerCase(),
    DesiredDeliveryMediums: ["EMAIL"],
    UserAttributes: [
      { Name: "email", Value: input.email.trim().toLowerCase() },
      { Name: "given_name", Value: firstName },
      { Name: "family_name", Value: lastName },
      { Name: "name", Value: `${firstName} ${lastName}` },
    ],
  })).catch((error: unknown) => {
    if (error instanceof Error && (error.name === "UsernameExistsException" || error.name === "AliasExistsException")) {
      throw new Error("An account with this email already exists. Accounts can belong to only one business, so use a different email.");
    }
    throw error;
  });
  const username = response.User?.Username;
  if (!username) throw new Error("Cognito did not return the invited user");

  try {
    await Promise.all(
      roles.map((GroupName) =>
        cognito.send(
          new AdminAddUserToGroupCommand({ UserPoolId: userPoolId(), Username: username, GroupName }),
        ),
      ),
    );
  } catch (error) {
    await cognito
      .send(new AdminDeleteUserCommand({ UserPoolId: userPoolId(), Username: username }))
      .catch(() => undefined);
    throw error;
  }

  return getCognitoUser(username);
};

export const resendCognitoInvitation = async (username: string) => {
  await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: userPoolId(),
      Username: username,
      MessageAction: "RESEND",
      DesiredDeliveryMediums: ["EMAIL"],
    }),
  );
  return getCognitoUser(username);
};

export const setCognitoUserRoles = async (username: string, requestedRoles: UserRole[]) => {
  const roles = normalizeRoles(requestedRoles);
  if (roles.length === 0) throw new Error("At least one application role is required");
  const currentRoles = await groupsForUser(username);

  await Promise.all([
    ...roles
      .filter((role) => !currentRoles.includes(role))
      .map((GroupName) => cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: userPoolId(), Username: username, GroupName }))),
    ...currentRoles
      .filter((role) => !roles.includes(role))
      .map((GroupName) => cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: userPoolId(), Username: username, GroupName }))),
  ]);
  return getCognitoUser(username);
};

export const setCognitoUserEnabled = async (username: string, enabled: boolean) => {
  const command = enabled
    ? new AdminEnableUserCommand({ UserPoolId: userPoolId(), Username: username })
    : new AdminDisableUserCommand({ UserPoolId: userPoolId(), Username: username });
  await cognito.send(command);
  return getCognitoUser(username);
};

export const updateCognitoUserEmail = async (username: string, email: string) => {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("Enter a valid email address");
  await cognito.send(new AdminUpdateUserAttributesCommand({
    UserPoolId: userPoolId(),
    Username: username,
    UserAttributes: [
      { Name: "email", Value: normalized },
      { Name: "email_verified", Value: "false" },
    ],
  }));
  return getCognitoUser(username);
};

export const deleteCognitoUser = async (username: string) => {
  await cognito.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId(), Username: username }));
};
