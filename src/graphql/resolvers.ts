import { forbiddenError, requireIdentity, requireRole, type GraphQLContext, type UserRole } from "../auth";
import {
  getCognitoUser,
  deleteCognitoUser,
  inviteCognitoUser,
  resendCognitoInvitation,
  setCognitoUserEnabled,
  setCognitoUserRoles,
  updateCognitoUserEmail,
} from "../services/cognito";
import {
  createTenant,
  deleteTenantMembership,
  getTenantMembership,
  listTenantMemberships,
  putTenantMembership,
  updateTenantMembershipRoles,
} from "../repositories/tenant-repository";
import {
  adjustStock,
  adjustStocks,
  completeSale,
  createCategory,
  createProduct,
  dashboardSummary,
  businessReport,
  effectiveProductPrice,
  ensureBusinessSettings,
  findProduct,
  getBusinessSettings,
  deleteStaffProfile,
  getProduct,
  getProductPage,
  getSale,
  getStaffProfile,
  getStaffProfiles,
  listAudits,
  listCategories,
  listProducts,
  listSales,
  listSalesByStaff,
  updateProduct,
  updateBusinessSettings,
  upsertStaffProfile,
  type ProductRecord,
  type SaleRecord,
} from "../repositories/pos-repository";
const requireStaff = (context: GraphQLContext) => requireRole(context, ["admin", "staff"]);
const requireAdmin = (context: GraphQLContext) => requireRole(context, ["admin"]);
const actor = (context: GraphQLContext) => ({ id: context.auth.id, name: context.auth.username });
const tenant = (context: GraphQLContext) => {
  const value = context.auth.tenantId;
  if (!value) throw forbiddenError();
  return value;
};
const activeRole = (user: GraphQLContext["auth"]) =>
  user.activeRole ?? (user.roles.includes("admin") ? "admin" : "staff");

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

const validateDateRange = (from?: string, to?: string) => {
  const parseBoundary = (value: string, end: boolean) => {
    const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? Date.parse(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}+03:00`)
      : Date.parse(value);
    if (Number.isNaN(timestamp)) throw new Error("Report dates must be valid ISO dates");
    return new Date(timestamp).toISOString();
  };
  const range = { from: from ? parseBoundary(from, false) : undefined, to: to ? parseBoundary(to, true) : undefined };
  if (range.from && range.to && range.from > range.to) throw new Error("Report start date must not be after the end date");
  return range;
};

const mergeProfile = async <T extends { id: string }>(tenantId: string, user: T) => ({
  ...user,
  profile: await getStaffProfile(tenantId, user.id),
});

const cashierDirectories = new Map<string, { expiresAt: number; names: Map<string, string> }>();
const cashierNames = async (tenantId: string) => {
  const cached = cashierDirectories.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.names;
  const memberships = await listTenantMemberships(tenantId);
  const users = await Promise.all(memberships.map(({ username }) => getCognitoUser(username)));
  const names = new Map<string, string>();
  for (const user of users) {
    names.set(user.id, user.name);
    names.set(user.username, user.name);
  }
  cashierDirectories.set(tenantId, { expiresAt: Date.now() + 5 * 60 * 1000, names });
  return names;
};

const resolveCashierNames = async <T extends SaleRecord>(tenantId: string, sales: T[]) => {
  const names = await cashierNames(tenantId);
  const profiles = await getStaffProfiles(tenantId, [...new Set(sales.map((sale) => sale.createdBy))]);
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
    // Regenerated receipts intentionally use current branding. Sale prices and
    // payment facts remain immutable snapshots on the sale record.
    receiptBranding: (_sale: SaleRecord, _args: unknown, context: GraphQLContext) => getBusinessSettings(tenant(context)),
  },
  Query: {
    me: async (_: unknown, _args: unknown, context: GraphQLContext) => {
      const auth = requireStaff(context);
      return mergeProfile(tenant(context), await getCognitoUser(auth.username));
    },
    users: async (_: unknown, _args: unknown, context: GraphQLContext) => {
      requireAdmin(context);
      const tenantId = tenant(context);
      const memberships = await listTenantMemberships(tenantId);
      const users = await Promise.all(memberships.map(({ username }) => getCognitoUser(username)));
      const profiles = await getStaffProfiles(tenantId, users.map((user) => user.id));
      return users.map((user) => {
        const membership = memberships.find(({ userId }) => userId === user.id)!;
        return { ...user, role: membership.roles.includes("admin") ? "admin" : "staff", roles: membership.roles, profile: profiles.get(user.id) ?? null };
      });
    },
    user: async (_: unknown, { username }: { username: string }, context: GraphQLContext) => {
      requireAdmin(context);
      const tenantId = tenant(context);
      const membership = (await listTenantMemberships(tenantId)).find((value) => value.username === username);
      if (!membership) return null;
      return mergeProfile(tenantId, { ...(await getCognitoUser(username)), roles: membership.roles });
    },
    categories: (_: unknown, _args: unknown, context: GraphQLContext) => {
      requireStaff(context);
      return listCategories(tenant(context));
    },
    products: (_: unknown, _args: unknown, context: GraphQLContext) => {
      requireStaff(context);
      return listProducts(tenant(context));
    },
    productPage: (
      _: unknown,
      args: { search?: string; limit?: number; cursor?: string; activeOnly?: boolean },
      context: GraphQLContext,
    ) => {
      requireStaff(context);
      return getProductPage(tenant(context), args);
    },
    product: (_: unknown, { id }: { id: string }, context: GraphQLContext) => {
      requireStaff(context);
      return getProduct(tenant(context), id);
    },
    productLookup: (_: unknown, { term }: { term: string }, context: GraphQLContext) => {
      requireStaff(context);
      return findProduct(tenant(context), term);
    },
    sales: async (
      _: unknown,
      { limit, personal, from, to }: { limit: number; personal: boolean; from?: string; to?: string },
      context: GraphQLContext,
    ) => {
      const authenticated = requireStaff(context);
      const safeLimit = Math.min(Math.max(limit, 1), 1000);
      const personalView = personal || activeRole(authenticated) !== "admin";
      const range = validateDateRange(from, to);
      const tenantId = tenant(context);
      const sales = personalView
        ? await listSalesByStaff(tenantId, authenticated.id, safeLimit, range)
        : await listSales(tenantId, safeLimit, range);
      return resolveCashierNames(tenantId, sales);
    },
    sale: async (
      _: unknown,
      { id, personal }: { id: string; personal: boolean },
      context: GraphQLContext,
    ) => {
      const authenticated = requireStaff(context);
      const tenantId = tenant(context);
      const sale = await getSale(tenantId, id);
      const personalView = personal || activeRole(authenticated) !== "admin";
      if (sale && personalView && sale.createdBy !== authenticated.id) {
        throw forbiddenError();
      }
      return sale ? (await resolveCashierNames(tenantId, [sale]))[0] : null;
    },
    stockAudits: (_: unknown, { limit }: { limit: number }, context: GraphQLContext) => {
      requireAdmin(context);
      return listAudits(tenant(context), Math.min(Math.max(limit, 1), 200));
    },
    businessSettings: (_: unknown, _args: unknown, context: GraphQLContext) => {
      requireStaff(context);
      return getBusinessSettings(tenant(context));
    },
    business: async (_: unknown, _args: unknown, context: GraphQLContext) => {
      const admin = requireAdmin(context);
      const settings = await getBusinessSettings(tenant(context));
      return { id: tenant(context), name: admin.tenantName ?? settings.businessName, departments: settings.departments };
    },
    dashboard: async (_: unknown, { days, personal, compact }: { days: number; personal: boolean; compact: boolean }, context: GraphQLContext) => {
      const authenticated = requireStaff(context);
      const isAdmin = activeRole(authenticated) === "admin";
      const personalView = personal || !isAdmin;
      const tenantId = tenant(context);
      const summary = await dashboardSummary(tenantId, days, personalView ? authenticated.id : undefined, !compact);
      const [names, recentSales] = await Promise.all([
        compact ? Promise.resolve(new Map<string, string>()) : cashierNames(tenantId),
        compact ? Promise.resolve(summary.recentSales) : resolveCashierNames(tenantId, summary.recentSales),
      ]);
      return {
        ...summary,
        grossProfit: isAdmin && !personalView ? summary.grossProfit : 0,
        recentSales,
        recentAudits: !compact && isAdmin && !personalView ? summary.recentAudits : [],
        cashierPerformance: (compact ? [] : summary.cashierPerformance)
          .filter((staff) => !personalView || staff.staffId === authenticated.id)
          .map((staff) => ({ ...staff, grossProfit: isAdmin && !personalView ? staff.grossProfit : 0, staffName: names.get(staff.staffId) ?? staff.staffName })),
      };
    },
    businessReport: (_: unknown, { from, to }: { from: string; to: string }, context: GraphQLContext) => {
      requireAdmin(context);
      const range = validateDateRange(from, to);
      if (!range.from || !range.to) throw new Error("A report start and end date are required");
      return businessReport(tenant(context), { from: range.from, to: range.to });
    },
  },

  Mutation: {
    createBusiness: async (_: unknown, { name }: { name: string }, context: GraphQLContext) => {
      const identity = requireIdentity(context);
      if (identity.tenantId) {
        const user = await setCognitoUserRoles(identity.username, identity.roles);
        if (!(await getStaffProfile(identity.tenantId, identity.id))) {
          await upsertStaffProfile(identity.tenantId, identity.id, { employeeCode: "OWNER", jobTitle: "Owner", department: "Management", phone: "" });
        }
        await ensureBusinessSettings(identity.tenantId, identity.tenantName ?? name, user.email);
        return mergeProfile(identity.tenantId, { ...user, roles: identity.roles });
      }
      const { membership } = await createTenant({ name, ownerUserId: identity.id, ownerUsername: identity.username });
      await upsertStaffProfile(membership.tenantId, identity.id, { employeeCode: "OWNER", jobTitle: "Owner", department: "Management", phone: "" });
      const user = await getCognitoUser(identity.username);
      await ensureBusinessSettings(membership.tenantId, name, user.email);
      await setCognitoUserRoles(identity.username, membership.roles);
      return mergeProfile(membership.tenantId, { ...user, roles: membership.roles });
    },
    inviteUser: async (
      _: unknown,
      args: { email: string; firstName: string; lastName: string; roles: string[]; employeeCode: string; jobTitle: string; department: string; phone: string },
      context: GraphQLContext,
    ) => {
      requireAdmin(context);
      if (!args.email.trim() || !args.firstName.trim() || !args.lastName.trim()) throw new Error("First name, last name, and email are required");
      const admin = requireAdmin(context);
      const roles = parseRoles(args.roles);
      const tenantId = tenant(context);
      const departments = (await getBusinessSettings(tenantId)).departments;
      if (!departments.includes(args.department.trim())) throw new Error("Select a department configured for this business");
      const user = await inviteCognitoUser({ email: args.email, firstName: args.firstName, lastName: args.lastName, roles });
      try {
        await putTenantMembership({ userId: user.id, username: user.username, tenantId, tenantName: admin.tenantName ?? "Business", roles });
        await upsertStaffProfile(tenantId, user.id, { employeeCode: args.employeeCode, jobTitle: args.jobTitle, department: args.department, phone: args.phone });
      } catch (error) {
        await deleteTenantMembership(user.id, tenantId).catch(() => undefined);
        await deleteStaffProfile(tenantId, user.id).catch(() => undefined);
        await deleteCognitoUser(user.username).catch(() => undefined);
        throw error;
      }
      return mergeProfile(tenantId, { ...user, roles });
    },
    resendUserInvitation: async (_: unknown, { username }: { username: string }, context: GraphQLContext) => {
      requireAdmin(context);
      const tenantId = tenant(context);
      const membership = (await listTenantMemberships(tenantId)).find((value) => value.username === username);
      if (!membership) throw new Error("Staff user was not found in this business");
      return mergeProfile(tenantId, await resendCognitoInvitation(username));
    },
    updateUserRoles: async (_: unknown, { username, roles }: { username: string; roles: string[] }, context: GraphQLContext) => {
      const admin = requireAdmin(context);
      if (admin.username === username && !roles.includes("admin")) throw new Error("Administrators cannot remove their own admin role");
      const requestedRoles = parseRoles(roles);
      const memberships = await listTenantMemberships(tenant(context));
      const membership = memberships.find((value) => value.username === username);
      if (!membership) throw new Error("Staff user was not found in this business");
      const user = await setCognitoUserRoles(username, requestedRoles);
      await updateTenantMembershipRoles(membership.userId, tenant(context), requestedRoles);
      return mergeProfile(tenant(context), { ...user, roles: requestedRoles });
    },
    setUserEnabled: async (_: unknown, { username, enabled }: { username: string; enabled: boolean }, context: GraphQLContext) => {
      const admin = requireAdmin(context);
      if (admin.username === username && !enabled) throw new Error("Administrators cannot disable their own account");
      const membership = (await listTenantMemberships(tenant(context))).find((value) => value.username === username);
      if (!membership) throw new Error("Staff user was not found in this business");
      return mergeProfile(tenant(context), await setCognitoUserEnabled(username, enabled));
    },
    updateStaffEmail: async (_: unknown, { username, email }: { username: string; email: string }, context: GraphQLContext) => {
      requireAdmin(context);
      const membership = (await listTenantMemberships(tenant(context))).find((value) => value.username === username);
      if (!membership) throw new Error("Staff user was not found in this business");
      return mergeProfile(tenant(context), { ...(await updateCognitoUserEmail(username, email)), roles: membership.roles });
    },
    deleteStaffUser: async (_: unknown, { username }: { username: string }, context: GraphQLContext) => {
      const admin = requireAdmin(context);
      if (admin.username === username) throw new Error("Administrators cannot delete their own account");
      const tenantId = tenant(context);
      const memberships = await listTenantMemberships(tenantId);
      const membership = memberships.find((value) => value.username === username);
      if (!membership) throw new Error("Staff user was not found in this business");
      if (membership.roles.includes("admin") && memberships.filter(({ roles }) => roles.includes("admin")).length <= 1) {
        throw new Error("A business must retain at least one administrator");
      }
      await deleteCognitoUser(username);
      await Promise.all([deleteTenantMembership(membership.userId, tenantId), deleteStaffProfile(tenantId, membership.userId)]);
      cashierDirectories.delete(tenantId);
      return true;
    },
    updateMyProfile: async (_: unknown, input: { phone: string }, context: GraphQLContext) => {
      const user = requireStaff(context);
      const current = await getStaffProfile(tenant(context), user.id);
      return upsertStaffProfile(tenant(context), user.id, {
        employeeCode: current?.employeeCode ?? "",
        jobTitle: current?.jobTitle ?? "",
        department: current?.department ?? "",
        phone: input.phone,
      });
    },
    updateStaffProfile: async (
      _: unknown,
      { userId, ...input }: { userId: string; employeeCode: string; jobTitle: string; department?: string; phone: string },
      context: GraphQLContext,
    ) => {
      requireAdmin(context);
      const tenantId = tenant(context);
      const membership = await getTenantMembership(userId);
      if (!membership || membership.tenantId !== tenantId) throw new Error("Staff user was not found in this business");
      const current = input.department === undefined ? await getStaffProfile(tenantId, userId) : null;
      const department = input.department ?? current?.department ?? "";
      if (!(await getBusinessSettings(tenantId)).departments.includes(department.trim())) throw new Error("Select a department configured for this business");
      return upsertStaffProfile(tenantId, userId, { ...input, department });
    },
    updateBusinessSettings: async (
      _: unknown,
      input: { businessName: string; address: string; phone: string; email: string; departments: string[]; thankYouMessage: string; returnPolicy: string },
      context: GraphQLContext,
    ) => {
      requireAdmin(context);
      if (input.businessName.trim().length < 2) throw new Error("Business name is required");
      if (input.address.trim().length < 3) throw new Error("Business address is required");
      if (input.thankYouMessage.trim().length < 3) throw new Error("Thank-you message is required");
      if (input.returnPolicy.trim().length < 3) throw new Error("Return policy is required");
      if (input.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) throw new Error("Enter a valid contact email");
      const tenantId = tenant(context);
      const normalizedDepartments = [...new Set(input.departments.map((department) => department.trim().replace(/\s+/g, " ")).filter(Boolean))];
      const memberships = await listTenantMemberships(tenantId);
      const profiles = await getStaffProfiles(tenantId, memberships.map(({ userId }) => userId));
      const assigned = [...new Set([...profiles.values()].map(({ department }) => department).filter(Boolean))];
      const removedInUse = assigned.filter((department) => !normalizedDepartments.includes(department));
      if (removedInUse.length) throw new Error(`Reassign staff before removing: ${removedInUse.join(", ")}`);
      return updateBusinessSettings(tenantId, { ...input, departments: normalizedDepartments }, actor(context));
    },
    createCategory: (_: unknown, args: { code: string; name: string; description: string }, context: GraphQLContext) => {
      requireAdmin(context);
      if (!args.code.trim() || !args.name.trim()) throw new Error("Category code and name are required");
      return createCategory(tenant(context), { code: args.code.trim().toUpperCase(), name: args.name.trim(), description: args.description.trim(), status: "active" }, actor(context));
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
      return createProduct(tenant(context), args, actor(context));
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
        const current = await getProduct(tenant(context), id);
        if (!current) throw new Error("Product not found");
        if (updates.promotionPrice >= (updates.price ?? current.price)) throw new Error("Promotion price must be lower than the regular selling price");
      }
      if (updates.promotionStartsAt && Number.isNaN(Date.parse(updates.promotionStartsAt))) throw new Error("Promotion start date is invalid");
      if (updates.promotionEndsAt && Number.isNaN(Date.parse(updates.promotionEndsAt))) throw new Error("Promotion end date is invalid");
      if (updates.promotionStartsAt && updates.promotionEndsAt && Date.parse(updates.promotionEndsAt) <= Date.parse(updates.promotionStartsAt)) throw new Error("Promotion end must be after its start");
      return updateProduct(tenant(context), id, updates, actor(context));
    },
    archiveProduct: (_: unknown, { id }: { id: string }, context: GraphQLContext) => {
      requireAdmin(context);
      return updateProduct(tenant(context), id, { status: "inactive" }, actor(context));
    },
    adjustStock: (_: unknown, args: { productId: string; delta: number; reason: string }, context: GraphQLContext) => {
      requireAdmin(context);
      return adjustStock(tenant(context), args.productId, args.delta, args.reason, actor(context));
    },
    adjustStocks: (_: unknown, args: { adjustments: Array<{ productId: string; delta: number }>; reason: string }, context: GraphQLContext) => {
      requireAdmin(context);
      return adjustStocks(tenant(context), args.adjustments, args.reason, actor(context));
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
      const tenantId = tenant(context);
      const [user, profile] = await Promise.all([getCognitoUser(authenticated.username), getStaffProfile(tenantId, authenticated.id)]);
      return completeSale(tenantId, args, { id: authenticated.id, name: user.name, employeeCode: profile?.employeeCode, department: profile?.department });
    },
  },
};
