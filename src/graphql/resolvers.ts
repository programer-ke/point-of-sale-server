import { requireRole, type GraphQLContext, type UserRole } from "../auth";
import {
  getCognitoUser,
  inviteCognitoUser,
  listCognitoUsers,
  resendCognitoInvitation,
  setCognitoUserEnabled,
  setCognitoUserRoles,
} from "../services/cognito";
import {
  adjustStock,
  adjustStocks,
  completeSale,
  createCategory,
  createProduct,
  dashboardSummary,
  findProduct,
  getProduct,
  getStaffProfile,
  getStaffProfiles,
  listAudits,
  listCategories,
  listProducts,
  listSales,
  updateProduct,
  upsertStaffProfile,
  type ProductRecord,
  type SaleRecord,
} from "../repositories/pos-repository";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoDB, TABLE_NAME } from "../config/db";

const requireStaff = (context: GraphQLContext) => requireRole(context, ["admin", "staff"]);
const requireAdmin = (context: GraphQLContext) => requireRole(context, ["admin"]);
const actor = (context: GraphQLContext) => ({ id: context.auth.id, name: context.auth.username });

const parseRoles = (roles: string[]): UserRole[] => {
  const normalized = [...new Set(roles)];
  if (normalized.length === 0 || normalized.some((role) => role !== "admin" && role !== "staff")) {
    throw new Error("Roles must contain admin, staff, or both");
  }
  return normalized as UserRole[];
};

const validateMoney = (value: number, name: string) => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be zero or greater`);
};

const mergeProfile = async <T extends { id: string }>(user: T) => ({
  ...user,
  profile: await getStaffProfile(user.id),
});

export const resolvers = {
  Query: {
    me: async (_: unknown, _args: unknown, context: GraphQLContext) => {
      const auth = requireStaff(context);
      return mergeProfile(await getCognitoUser(auth.username));
    },
    users: async (_: unknown, _args: unknown, context: GraphQLContext) => {
      requireAdmin(context);
      const users = await listCognitoUsers();
      const profiles = await getStaffProfiles(users.map((user) => user.id));
      return users.map((user) => ({ ...user, profile: profiles.get(user.id) ?? null }));
    },
    user: async (_: unknown, { username }: { username: string }, context: GraphQLContext) => {
      requireAdmin(context);
      return mergeProfile(await getCognitoUser(username));
    },
    categories: (_: unknown, _args: unknown, context: GraphQLContext) => {
      requireStaff(context);
      return listCategories();
    },
    products: (_: unknown, _args: unknown, context: GraphQLContext) => {
      requireStaff(context);
      return listProducts();
    },
    product: (_: unknown, { id }: { id: string }, context: GraphQLContext) => {
      requireStaff(context);
      return getProduct(id);
    },
    productLookup: (_: unknown, { term }: { term: string }, context: GraphQLContext) => {
      requireStaff(context);
      return findProduct(term);
    },
    sales: (_: unknown, { limit }: { limit: number }, context: GraphQLContext) => {
      requireStaff(context);
      return listSales(Math.min(Math.max(limit, 1), 100));
    },
    sale: async (_: unknown, { id }: { id: string }, context: GraphQLContext) => {
      requireStaff(context);
      const response = await dynamoDB.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: `SALE#${id}`, SK: "RECEIPT" } }));
      if (!response.Item) return null;
      const { PK: _pk, SK: _sk, GSI1PK: _gsiPk, GSI1SK: _gsiSk, entityType: _type, ...sale } = response.Item;
      return sale as unknown as SaleRecord;
    },
    stockAudits: (_: unknown, { limit }: { limit: number }, context: GraphQLContext) => {
      requireAdmin(context);
      return listAudits(Math.min(Math.max(limit, 1), 200));
    },
    dashboard: (_: unknown, _args: unknown, context: GraphQLContext) => {
      requireStaff(context);
      return dashboardSummary();
    },
  },

  Mutation: {
    inviteUser: async (
      _: unknown,
      args: { email: string; name: string; roles: string[]; employeeCode: string; jobTitle: string; phone: string },
      context: GraphQLContext,
    ) => {
      requireAdmin(context);
      if (!args.email.trim() || !args.name.trim()) throw new Error("Name and email are required");
      const user = await inviteCognitoUser({ email: args.email, name: args.name, roles: parseRoles(args.roles) });
      await upsertStaffProfile(user.id, { employeeCode: args.employeeCode, jobTitle: args.jobTitle, phone: args.phone });
      return mergeProfile(user);
    },
    resendUserInvitation: async (_: unknown, { username }: { username: string }, context: GraphQLContext) => {
      requireAdmin(context);
      return mergeProfile(await resendCognitoInvitation(username));
    },
    updateUserRoles: async (_: unknown, { username, roles }: { username: string; roles: string[] }, context: GraphQLContext) => {
      const admin = requireAdmin(context);
      if (admin.username === username && !roles.includes("admin")) throw new Error("Administrators cannot remove their own admin role");
      return mergeProfile(await setCognitoUserRoles(username, parseRoles(roles)));
    },
    setUserEnabled: async (_: unknown, { username, enabled }: { username: string; enabled: boolean }, context: GraphQLContext) => {
      const admin = requireAdmin(context);
      if (admin.username === username && !enabled) throw new Error("Administrators cannot disable their own account");
      return mergeProfile(await setCognitoUserEnabled(username, enabled));
    },
    updateMyProfile: async (_: unknown, input: { phone: string }, context: GraphQLContext) => {
      const user = requireStaff(context);
      const current = await getStaffProfile(user.id);
      return upsertStaffProfile(user.id, {
        employeeCode: current?.employeeCode ?? "",
        jobTitle: current?.jobTitle ?? "",
        phone: input.phone,
      });
    },
    updateStaffProfile: (
      _: unknown,
      { userId, ...input }: { userId: string; employeeCode: string; jobTitle: string; phone: string },
      context: GraphQLContext,
    ) => {
      requireAdmin(context);
      return upsertStaffProfile(userId, input);
    },
    createCategory: (_: unknown, args: { code: string; name: string; description: string }, context: GraphQLContext) => {
      requireAdmin(context);
      if (!args.code.trim() || !args.name.trim()) throw new Error("Category code and name are required");
      return createCategory({ code: args.code.trim().toUpperCase(), name: args.name.trim(), description: args.description.trim(), status: "active" }, actor(context));
    },
    createProduct: (
      _: unknown,
      args: Omit<ProductRecord, "id" | "categoryName" | "stock" | "status" | "createdAt" | "updatedAt"> & { initialStock: number },
      context: GraphQLContext,
    ) => {
      requireAdmin(context);
      validateMoney(args.price, "Price");
      validateMoney(args.cost, "Cost");
      if (!Number.isInteger(args.initialStock) || args.initialStock < 0 || !Number.isInteger(args.minStock) || args.minStock < 0) throw new Error("Stock values must be whole numbers of zero or greater");
      return createProduct(args, actor(context));
    },
    updateProduct: (
      _: unknown,
      { id, ...updates }: { id: string } & Partial<ProductRecord>,
      context: GraphQLContext,
    ) => {
      requireAdmin(context);
      if (updates.price !== undefined) validateMoney(updates.price, "Price");
      if (updates.cost !== undefined) validateMoney(updates.cost, "Cost");
      return updateProduct(id, updates, actor(context));
    },
    archiveProduct: (_: unknown, { id }: { id: string }, context: GraphQLContext) => {
      requireAdmin(context);
      return updateProduct(id, { status: "inactive" }, actor(context));
    },
    adjustStock: (_: unknown, args: { productId: string; delta: number; reason: string }, context: GraphQLContext) => {
      requireAdmin(context);
      return adjustStock(args.productId, args.delta, args.reason, actor(context));
    },
    adjustStocks: (_: unknown, args: { adjustments: Array<{ productId: string; delta: number }>; reason: string }, context: GraphQLContext) => {
      requireAdmin(context);
      return adjustStocks(args.adjustments, args.reason, actor(context));
    },
    completeSale: (
      _: unknown,
      args: { customerName?: string; paymentMethod: SaleRecord["paymentMethod"]; items: Array<{ productId: string; quantity: number }> },
      context: GraphQLContext,
    ) => {
      requireStaff(context);
      if (!(["cash", "card", "mobile_money"] as const).includes(args.paymentMethod)) throw new Error("Unsupported payment method");
      return completeSale(args, actor(context));
    },
  },
};
