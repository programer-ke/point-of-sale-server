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
  effectiveProductPrice,
  findProduct,
  getBusinessSettings,
  getProduct,
  getProductPage,
  getSale,
  getStaffProfile,
  getStaffProfiles,
  listAudits,
  listCategories,
  listProducts,
  listSales,
  updateProduct,
  updateBusinessSettings,
  upsertStaffProfile,
  type ProductRecord,
  type SaleRecord,
} from "../repositories/pos-repository";
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

let cashierDirectory: { expiresAt: number; names: Map<string, string> } | undefined;
const cashierNames = async () => {
  if (cashierDirectory && cashierDirectory.expiresAt > Date.now()) return cashierDirectory.names;
  const users = await listCognitoUsers();
  const names = new Map<string, string>();
  for (const user of users) {
    names.set(user.id, user.name);
    names.set(user.username, user.name);
  }
  cashierDirectory = { expiresAt: Date.now() + 5 * 60 * 1000, names };
  return names;
};

const resolveCashierNames = async <T extends SaleRecord>(sales: T[]) => {
  const names = await cashierNames();
  const profiles = await getStaffProfiles([...new Set(sales.map((sale) => sale.createdBy))]);
  return sales.map((sale) => ({
    ...sale,
    createdByName: names.get(sale.createdBy) ?? sale.createdByName,
    cashierDisplayName: [
      (names.get(sale.createdBy) ?? sale.createdByName).trim().split(/\s+/)[0],
      profiles.get(sale.createdBy)?.employeeCode ? `(${profiles.get(sale.createdBy)!.employeeCode})` : "",
    ].filter(Boolean).join(" "),
  }));
};

export const resolvers = {
  Product: {
    effectivePrice: (product: ProductRecord) => effectiveProductPrice(product),
    onPromotion: (product: ProductRecord) => effectiveProductPrice(product) < product.price,
  },
  Sale: {
    receiptBranding: (sale: SaleRecord) => sale.receiptBranding ?? getBusinessSettings(),
  },
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
    productPage: (
      _: unknown,
      args: { search?: string; limit?: number; cursor?: string; activeOnly?: boolean },
      context: GraphQLContext,
    ) => {
      requireStaff(context);
      return getProductPage(args);
    },
    product: (_: unknown, { id }: { id: string }, context: GraphQLContext) => {
      requireStaff(context);
      return getProduct(id);
    },
    productLookup: (_: unknown, { term }: { term: string }, context: GraphQLContext) => {
      requireStaff(context);
      return findProduct(term);
    },
    sales: async (_: unknown, { limit }: { limit: number }, context: GraphQLContext) => {
      requireStaff(context);
      return resolveCashierNames(await listSales(Math.min(Math.max(limit, 1), 100)));
    },
    sale: async (_: unknown, { id }: { id: string }, context: GraphQLContext) => {
      requireStaff(context);
      const sale = await getSale(id);
      return sale ? (await resolveCashierNames([sale]))[0] : null;
    },
    stockAudits: (_: unknown, { limit }: { limit: number }, context: GraphQLContext) => {
      requireAdmin(context);
      return listAudits(Math.min(Math.max(limit, 1), 200));
    },
    businessSettings: (_: unknown, _args: unknown, context: GraphQLContext) => {
      requireStaff(context);
      return getBusinessSettings();
    },
    dashboard: async (_: unknown, { days, personal }: { days: number; personal: boolean }, context: GraphQLContext) => {
      const authenticated = requireStaff(context);
      const isAdmin = authenticated.roles.includes("admin");
      const personalView = personal || !isAdmin;
      const summary = await dashboardSummary(days, personalView ? authenticated.id : undefined);
      const [names, recentSales] = await Promise.all([
        cashierNames(),
        resolveCashierNames(summary.recentSales),
      ]);
      return {
        ...summary,
        grossProfit: isAdmin && !personalView ? summary.grossProfit : 0,
        recentSales,
        recentAudits: isAdmin && !personalView ? summary.recentAudits : [],
        cashierPerformance: summary.cashierPerformance
          .filter((staff) => !personalView || staff.staffId === authenticated.id)
          .map((staff) => ({ ...staff, grossProfit: isAdmin && !personalView ? staff.grossProfit : 0, staffName: names.get(staff.staffId) ?? staff.staffName })),
      };
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
    updateBusinessSettings: (
      _: unknown,
      input: { businessName: string; address: string; phone: string; email: string; thankYouMessage: string; returnPolicy: string },
      context: GraphQLContext,
    ) => {
      requireAdmin(context);
      if (input.businessName.trim().length < 2) throw new Error("Business name is required");
      if (input.address.trim().length < 3) throw new Error("Business address is required");
      if (input.thankYouMessage.trim().length < 3) throw new Error("Thank-you message is required");
      if (input.returnPolicy.trim().length < 3) throw new Error("Return policy is required");
      if (input.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) throw new Error("Enter a valid contact email");
      return updateBusinessSettings(input, actor(context));
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
    updateProduct: async (
      _: unknown,
      { id, ...updates }: { id: string } & Partial<ProductRecord>,
      context: GraphQLContext,
    ) => {
      requireAdmin(context);
      if (updates.price !== undefined) validateMoney(updates.price, "Price");
      if (updates.cost !== undefined) validateMoney(updates.cost, "Cost");
      if (updates.promotionPrice !== undefined && updates.promotionPrice !== null) {
        validateMoney(updates.promotionPrice, "Promotion price");
        const current = await getProduct(id);
        if (!current) throw new Error("Product not found");
        if (updates.promotionPrice >= (updates.price ?? current.price)) throw new Error("Promotion price must be lower than the regular selling price");
      }
      if (updates.promotionStartsAt && Number.isNaN(Date.parse(updates.promotionStartsAt))) throw new Error("Promotion start date is invalid");
      if (updates.promotionEndsAt && Number.isNaN(Date.parse(updates.promotionEndsAt))) throw new Error("Promotion end date is invalid");
      if (updates.promotionStartsAt && updates.promotionEndsAt && Date.parse(updates.promotionEndsAt) <= Date.parse(updates.promotionStartsAt)) throw new Error("Promotion end must be after its start");
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
    completeSale: async (
      _: unknown,
      args: {
        customerName?: string;
        paymentMethod: "cash" | "mpesa";
        amountTendered?: number | null;
        mpesaReference?: string | null;
        items: Array<{ productId: string; quantity: number }>;
      },
      context: GraphQLContext,
    ) => {
      const authenticated = requireStaff(context);
      if (!(args.paymentMethod === "cash" || args.paymentMethod === "mpesa")) throw new Error("Payment method must be cash or M-Pesa");
      const [user, profile] = await Promise.all([getCognitoUser(authenticated.username), getStaffProfile(authenticated.id)]);
      return completeSale(args, { id: authenticated.id, name: user.name, employeeCode: profile?.employeeCode });
    },
  },
};
