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
  completeSale,
  createCategory,
  createProduct,
  deleteCategory,
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
  listCashShifts,
  getOpenCashShift,
  openCashShift,
  recordCashMovement,
  closeCashShift,
  updateProduct,
  updateCategory,
  updateBusinessSettings,
  upsertStaffProfile,
  type ProductRecord,
  type SaleRecord,
} from "../repositories/pos-repository";
import {
  createPurchaseOrder,
  createStore,
  createSupplier,
  createTransfer,
  createRequisition,
  decideRequisition,
  convertRequisitionToTransfer,
  cancelTransfer,
  createStocktake,
  completeStocktake,
  cancelStocktake,
  countLot,
  dispatchTransfer,
  getPurchaseOrder,
  getGoodsReceipt,
  getTransfer,
  getRequisition,
  getStocktake,
  getStore,
  listGoodsReceipts,
  listLots,
  listMovements,
  listPurchaseOrders,
  listStorePolicies,
  listStores,
  listSupplierProducts,
  listSuppliers,
  listTransfers,
  listRequisitions,
  listStocktakes,
  receivePurchaseOrder,
  receiveTransfer,
  replenishmentSuggestions,
  setPurchaseOrderStatus,
  storeStock,
  supplyChainReport,
  updateStore,
  updateSupplier,
  updatePurchaseOrder,
  upsertStorePolicy,
  upsertSupplierProduct,
  writeOffLot,
  type ReceiptLineInput,
} from "../repositories/supply-chain-repository";
const requireStaff = (context: GraphQLContext) => requireRole(context, ["admin", "staff"]);
const requireAdmin = (context: GraphQLContext) => requireRole(context, ["admin"]);
const actor = (context: GraphQLContext) => ({ id: context.auth.id, name: context.auth.username });
const tenant = (context: GraphQLContext) => {
  const value = context.auth.tenantId;
  if (!value) throw forbiddenError();
  return value;
};
const selectedStore = async (context: GraphQLContext, requested?: string | null) => {
  const authenticated = requireStaff(context);
  const tenantId = tenant(context);
  if (activeRole(authenticated) === "admin" && requested) {
    const store = await getStore(tenantId, requested);
    if (!store || store.status !== "active") throw new Error("Select an active store");
    return store;
  }
  const profile = await getStaffProfile(tenantId, authenticated.id);
  if (requested && profile?.storeIds?.includes(requested)) {
    const assigned = await getStore(tenantId, requested); if (assigned?.status === "active") return assigned;
  }
  if (profile?.storeId) {
    const store = await getStore(tenantId, profile.storeId);
    if (store?.status === "active") return store;
  }
  const fallback = (await listStores(tenantId)).find((store) => store.status === "active");
  if (!fallback) throw new Error("No active store is configured");
  return fallback;
};
const ensureMainStore = async (tenantId: string) => {
  const existing = (await listStores(tenantId)).find((store) => store.code === "MAIN");
  if (existing) return existing;
  return createStore(tenantId, { code: "MAIN", name: "Main Store", address: "" }, { id: "system", name: "Business onboarding" });
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


const validateCategory = (input: { code: string; name: string; description: string; parentId?: string | null }) => {
  const category = { code: input.code.trim().toUpperCase(), name: input.name.trim(), description: input.description.trim(), parentId: input.parentId?.trim() || null };
  if (!category.code || !category.name) throw new Error("Category code and name are required");
  if (category.code.length > 40) throw new Error("Category code must be 40 characters or fewer");
  if (category.name.length > 80) throw new Error("Category name must be 80 characters or fewer");
  if (category.description.length > 240) throw new Error("Category description must be 240 characters or fewer");
  return category;
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
    onPromotion: (product: ProductRecord) => effectiveProductPrice(product) < product.sellingPrice,
  },
  Sale: {
    receiptBranding: (sale: SaleRecord) => sale.receiptBranding,
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
    products: async (_: unknown, { storeId }: { storeId?: string }, context: GraphQLContext) => {
      requireStaff(context);
      const tenantId = tenant(context); const store = await selectedStore(context, storeId); const [products, stock] = await Promise.all([listProducts(tenantId), storeStock(tenantId, store.id)]); const byProduct = new Map(stock.map((item) => [item.productId, item]));
      return products.map((product) => ({ ...product, storeStock: byProduct.get(product.id) ?? { storeId: store.id, productId: product.id, quantity: 0, inventoryValue: 0, reorderPoint: 0, targetQuantity: 0, lowStock: false } }));
    },
    productPage: async (
      _: unknown,
      args: { search?: string; limit?: number; cursor?: string; activeOnly?: boolean; storeId?: string },
      context: GraphQLContext,
    ) => {
      requireStaff(context);
      const tenantId = tenant(context); const store = await selectedStore(context, args.storeId); const [page, stock] = await Promise.all([getProductPage(tenantId, args), storeStock(tenantId, store.id)]); const byProduct = new Map(stock.map((item) => [item.productId, item]));
      return { ...page, items: page.items.map((product) => ({ ...product, storeStock: byProduct.get(product.id) ?? { storeId: store.id, productId: product.id, quantity: 0, inventoryValue: 0, reorderPoint: 0, targetQuantity: 0, lowStock: false } })) };
    },
    product: (_: unknown, { id }: { id: string }, context: GraphQLContext) => {
      requireStaff(context);
      return getProduct(tenant(context), id);
    },
    productLookup: async (_: unknown, { term, storeId }: { term: string; storeId?: string }, context: GraphQLContext) => {
      requireStaff(context);
      const tenantId = tenant(context); const [product, store] = await Promise.all([findProduct(tenantId, term), selectedStore(context, storeId)]); if (!product) return null; const stock = (await storeStock(tenantId, store.id)).find((item) => item.productId === product.id); return { ...product, storeStock: stock ?? { storeId: store.id, productId: product.id, quantity: 0, inventoryValue: 0, reorderPoint: 0, targetQuantity: 0, lowStock: false } };
    },
    sales: async (
      _: unknown,
      { limit, personal, from, to, storeId }: { limit: number; personal: boolean; from?: string; to?: string; storeId?: string },
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
      return resolveCashierNames(tenantId, storeId && !personalView ? sales.filter((sale) => sale.storeId === storeId) : sales);
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
      return { id: tenant(context), name: admin.tenantName ?? settings.businessName };
    },
    dashboard: async (_: unknown, { days, personal, compact }: { days: number; personal: boolean; compact: boolean }, context: GraphQLContext) => {
      const authenticated = requireStaff(context);
      const isAdmin = activeRole(authenticated) === "admin";
      const personalView = personal || !isAdmin;
      const tenantId = tenant(context);
      const store = await selectedStore(context);
      const summary = await dashboardSummary(tenantId, days, personalView ? authenticated.id : undefined, !compact, store.id);
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
    businessReport: (_: unknown, { from, to, storeId }: { from: string; to: string; storeId?: string }, context: GraphQLContext) => {
      requireAdmin(context);
      const range = validateDateRange(from, to);
      if (!range.from || !range.to) throw new Error("A report start and end date are required");
      return businessReport(tenant(context), { from: range.from, to: range.to, storeId });
    },
    stores: async (_: unknown, { activeOnly }: { activeOnly: boolean }, context: GraphQLContext) => { const authenticated = requireStaff(context); const tenantId = tenant(context); let values = await listStores(tenantId); if (activeRole(authenticated) !== "admin") { const profile = await getStaffProfile(tenantId, authenticated.id); const allowed = new Set(profile?.storeIds?.length ? profile.storeIds : profile?.storeId ? [profile.storeId] : []); values = values.filter((store) => allowed.has(store.id)); } return activeOnly ? values.filter((value) => value.status === "active") : values; },
    requisitionStores: async (_: unknown, _args: unknown, context: GraphQLContext) => { requireStaff(context); return (await listStores(tenant(context))).filter((store) => store.status === "active"); },
    suppliers: async (_: unknown, { activeOnly }: { activeOnly: boolean }, context: GraphQLContext) => { requireAdmin(context); const values = await listSuppliers(tenant(context)); return activeOnly ? values.filter((value) => value.status === "active") : values; },
    supplierProducts: (_: unknown, { supplierId }: { supplierId?: string }, context: GraphQLContext) => { requireAdmin(context); return listSupplierProducts(tenant(context), supplierId); },
    storePolicies: (_: unknown, { storeId }: { storeId: string }, context: GraphQLContext) => { requireAdmin(context); return listStorePolicies(tenant(context), storeId); },
    storeStock: async (_: unknown, { storeId }: { storeId?: string }, context: GraphQLContext) => storeStock(tenant(context), (await selectedStore(context, storeId)).id),
    purchaseOrders: (_: unknown, _args: unknown, context: GraphQLContext) => { requireAdmin(context); return listPurchaseOrders(tenant(context)); },
    purchaseOrder: (_: unknown, { id }: { id: string }, context: GraphQLContext) => { requireAdmin(context); return getPurchaseOrder(tenant(context), id); },
    goodsReceipts: (_: unknown, _args: unknown, context: GraphQLContext) => { requireAdmin(context); return listGoodsReceipts(tenant(context)); },
    goodsReceipt: (_: unknown, { id }: { id: string }, context: GraphQLContext) => { requireAdmin(context); return getGoodsReceipt(tenant(context), id); },
    inventoryLots: (_: unknown, { storeId, includeExhausted }: { storeId?: string; includeExhausted: boolean }, context: GraphQLContext) => { requireAdmin(context); return listLots(tenant(context), storeId, includeExhausted); },
    stockMovements: async (_: unknown, { from, to, storeId }: { from?: string; to?: string; storeId?: string }, context: GraphQLContext) => { requireAdmin(context); const values = await listMovements(tenant(context), validateDateRange(from, to)); return storeId ? values.filter((value) => value.storeId === storeId) : values; },
    stockTransfers: (_: unknown, _args: unknown, context: GraphQLContext) => { requireAdmin(context); return listTransfers(tenant(context)); },
    stockTransfer: (_: unknown, { id }: { id: string }, context: GraphQLContext) => { requireAdmin(context); return getTransfer(tenant(context), id); },
    stockRequisitions: async (_: unknown, _args: unknown, context: GraphQLContext) => { const authenticated = requireStaff(context); const tenantId = tenant(context); const values = await listRequisitions(tenantId); if (activeRole(authenticated) === "admin") return values; const profile = await getStaffProfile(tenantId, authenticated.id); const allowed = new Set(profile?.storeIds ?? []); return values.filter((item) => allowed.has(item.fromStoreId) || allowed.has(item.toStoreId)); },
    stockRequisition: async (_: unknown, { id }: { id: string }, context: GraphQLContext) => { const authenticated = requireStaff(context); const tenantId = tenant(context); const value = await getRequisition(tenantId, id); if (!value || activeRole(authenticated) === "admin") return value; const profile = await getStaffProfile(tenantId, authenticated.id); const allowed = new Set(profile?.storeIds ?? []); if (!allowed.has(value.fromStoreId) && !allowed.has(value.toStoreId)) throw forbiddenError(); return value; },
    stocktakes: (_: unknown, { storeId }: { storeId?: string }, context: GraphQLContext) => { requireAdmin(context); return listStocktakes(tenant(context), storeId); },
    stocktake: (_: unknown, { id }: { id: string }, context: GraphQLContext) => { requireAdmin(context); return getStocktake(tenant(context), id); },
    myOpenCashShift: async (_: unknown, { storeId }: { storeId?: string }, context: GraphQLContext) => { const user = requireStaff(context); const store = await selectedStore(context, storeId); return getOpenCashShift(tenant(context), store.id, user.id); },
    cashShifts: (_: unknown, { limit, from, to, storeId }: { limit: number; from?: string; to?: string; storeId?: string }, context: GraphQLContext) => { requireAdmin(context); return listCashShifts(tenant(context), Math.min(Math.max(limit, 1), 500), { from, to, storeId }); },
    replenishmentSuggestions: (_: unknown, { storeId, supplierId }: { storeId: string; supplierId: string }, context: GraphQLContext) => { requireAdmin(context); return replenishmentSuggestions(tenant(context), storeId, supplierId); },
    supplyChainReport: (_: unknown, args: { from: string; to: string; storeId?: string; supplierId?: string; productId?: string; status?: string; expiryDays?: number }, context: GraphQLContext) => { requireAdmin(context); const range = validateDateRange(args.from, args.to) as { from: string; to: string }; return supplyChainReport(tenant(context), { ...range, storeId: args.storeId, supplierId: args.supplierId, productId: args.productId, status: args.status, expiryDays: args.expiryDays }); },
  },

  Mutation: {
    createBusiness: async (_: unknown, { name }: { name: string }, context: GraphQLContext) => {
      const identity = requireIdentity(context);
      if (identity.tenantId) {
        const user = await setCognitoUserRoles(identity.username, identity.roles);
        const store = await ensureMainStore(identity.tenantId);
        if (!(await getStaffProfile(identity.tenantId, identity.id))) {
          await upsertStaffProfile(identity.tenantId, identity.id, { employeeCode: "OWNER", jobTitle: "Owner", storeId: store.id, storeName: store.name, phone: "" });
        }
        await ensureBusinessSettings(identity.tenantId, identity.tenantName ?? name, user.email);
        return mergeProfile(identity.tenantId, { ...user, roles: identity.roles });
      }
      const { membership } = await createTenant({ name, ownerUserId: identity.id, ownerUsername: identity.username });
      const store = await ensureMainStore(membership.tenantId);
      await upsertStaffProfile(membership.tenantId, identity.id, { employeeCode: "OWNER", jobTitle: "Owner", storeId: store.id, storeName: store.name, phone: "" });
      const user = await getCognitoUser(identity.username);
      await ensureBusinessSettings(membership.tenantId, name, user.email);
      await setCognitoUserRoles(identity.username, membership.roles);
      return mergeProfile(membership.tenantId, { ...user, roles: membership.roles });
    },
    inviteUser: async (
      _: unknown,
      args: { email: string; firstName: string; lastName: string; roles: string[]; employeeCode: string; jobTitle: string; storeId: string; storeIds: string[]; phone: string },
      context: GraphQLContext,
    ) => {
      requireAdmin(context);
      if (!args.email.trim() || !args.firstName.trim() || !args.lastName.trim()) throw new Error("First name, last name, and email are required");
      const admin = requireAdmin(context);
      const roles = parseRoles(args.roles);
      const tenantId = tenant(context);
      const assignedIds = [...new Set([args.storeId, ...args.storeIds])]; const assignedStores = await Promise.all(assignedIds.map((id) => getStore(tenantId, id))); const store = assignedStores[0];
      if (assignedStores.some((value) => !value || value.status !== "active")) throw new Error("All assigned stores must be active");
      if (!store || store.status !== "active") throw new Error("Select an active store");
      const user = await inviteCognitoUser({ email: args.email, firstName: args.firstName, lastName: args.lastName, roles });
      try {
        await putTenantMembership({ userId: user.id, username: user.username, tenantId, tenantName: admin.tenantName ?? "Business", roles });
        await upsertStaffProfile(tenantId, user.id, { employeeCode: args.employeeCode, jobTitle: args.jobTitle, storeId: store.id, storeName: store.name, storeIds: assignedIds, phone: args.phone });
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
        storeId: current?.storeId,
        storeName: current?.storeName,
        phone: input.phone,
      });
    },
    updateStaffProfile: async (
      _: unknown,
      { userId, ...input }: { userId: string; employeeCode: string; jobTitle: string; storeId: string; storeIds: string[]; phone: string },
      context: GraphQLContext,
    ) => {
      requireAdmin(context);
      const tenantId = tenant(context);
      const membership = await getTenantMembership(userId);
      if (!membership || membership.tenantId !== tenantId) throw new Error("Staff user was not found in this business");
      const assignedIds = [...new Set([input.storeId, ...input.storeIds])]; const assignedStores = await Promise.all(assignedIds.map((id) => getStore(tenantId, id))); const store = assignedStores[0];
      if (!store || assignedStores.some((value) => !value || value.status !== "active")) throw new Error("All assigned stores must be active");
      return upsertStaffProfile(tenantId, userId, { ...input, storeIds: assignedIds, storeName: store.name });
    },
    updateBusinessSettings: async (
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
      return updateBusinessSettings(tenant(context), input, actor(context));
    },
    createCategory: (_: unknown, args: { code: string; name: string; description: string; parentId?: string | null }, context: GraphQLContext) => {
      requireAdmin(context);
      return createCategory(tenant(context), { ...validateCategory(args), status: "active" }, actor(context));
    },
    updateCategory: (_: unknown, { id, ...input }: { id: string; code: string; name: string; description: string; parentId?: string | null }, context: GraphQLContext) => {
      requireAdmin(context);
      return updateCategory(tenant(context), id, validateCategory(input), actor(context));
    },
    deleteCategory: async (_: unknown, { id }: { id: string }, context: GraphQLContext) => {
      requireAdmin(context);
      await deleteCategory(tenant(context), id, actor(context));
      return true;
    },
    createProduct: (
      _: unknown,
      args: Pick<ProductRecord, "name" | "description" | "sku" | "barcode" | "categoryId" | "sellingPrice" | "buyingPrice" | "stockUnit" | "tracksExpiry" | "saleVariants">,
      context: GraphQLContext,
    ) => {
      requireAdmin(context);
      validateMoney(args.sellingPrice, "Selling price");
      validateMoney(args.buyingPrice, "Buying price");
      if (!args.stockUnit.trim()) throw new Error("Stock and pricing unit is required");
      return createProduct(tenant(context), args, actor(context));
    },
    updateProduct: async (
      _: unknown,
      { id, ...updates }: { id: string } & Partial<ProductRecord>,
      context: GraphQLContext,
    ) => {
      requireAdmin(context);
      if (updates.sellingPrice !== undefined) validateMoney(updates.sellingPrice, "Selling price");
      if (updates.buyingPrice !== undefined) validateMoney(updates.buyingPrice, "Buying price");
      if (updates.promotionPrice !== undefined && updates.promotionPrice !== null) {
        validateMoney(updates.promotionPrice, "Promotion price");
        const current = await getProduct(tenant(context), id);
        if (!current) throw new Error("Product not found");
        if (updates.promotionPrice >= (updates.sellingPrice ?? current.sellingPrice)) throw new Error("Promotion price must be lower than the regular selling price");
      }
      if (updates.promotionStartsAt && Number.isNaN(Date.parse(updates.promotionStartsAt))) throw new Error("Promotion start date is invalid");
      if (updates.promotionEndsAt && Number.isNaN(Date.parse(updates.promotionEndsAt))) throw new Error("Promotion end date is invalid");
      if (updates.promotionStartsAt && updates.promotionEndsAt && Date.parse(updates.promotionEndsAt) <= Date.parse(updates.promotionStartsAt)) throw new Error("Promotion end must be after its start");
      return updateProduct(tenant(context), id, updates, actor(context));
    },
    archiveProduct: (_: unknown, { id }: { id: string }, context: GraphQLContext) => {
      requireAdmin(context);
      const tenantId = tenant(context);
      return listLots(tenantId).then((lots) => {
        if (lots.some((lot) => lot.productId === id && lot.remainingQuantity > 0)) throw new Error("Transfer, sell, or write off this product's stock before archiving it");
        return updateProduct(tenantId, id, { status: "inactive" }, actor(context));
      });
    },
    completeSale: async (
      _: unknown,
      args: {
        storeId?: string;
        customerName?: string;
        paymentMethod: "cash" | "mpesa";
        amountTendered?: number | null;
        mpesaReference?: string | null;
        items: Array<{ productId: string; variantId?: string | null; quantity: number }>;
        requestId: string;
      },
      context: GraphQLContext,
    ) => {
      const authenticated = requireStaff(context);
      if (!(args.paymentMethod === "cash" || args.paymentMethod === "mpesa")) throw new Error("Payment method must be cash or M-Pesa");
      const tenantId = tenant(context);
      const [user, profile, store] = await Promise.all([getCognitoUser(authenticated.username), getStaffProfile(tenantId, authenticated.id), selectedStore(context, args.storeId)]);
      return completeSale(tenantId, { ...args, storeId: store.id }, { id: authenticated.id, name: user.name, employeeCode: profile?.employeeCode, storeName: store.name });
    },
    createStore: (_: unknown, input: Parameters<typeof createStore>[1], context: GraphQLContext) => { requireAdmin(context); return createStore(tenant(context), input, actor(context)); },
    updateStore: async (_: unknown, { id, ...input }: { id: string } & Parameters<typeof updateStore>[2], context: GraphQLContext) => { requireAdmin(context); const tenantId = tenant(context); if (input.status === "inactive") { const memberships = await listTenantMemberships(tenantId); const profiles = await getStaffProfiles(tenantId, memberships.map(({ userId }) => userId)); if ([...profiles.values()].some((profile) => profile.storeIds?.includes(id) || profile.storeId === id)) throw new Error("Reassign staff before deactivating this store"); } return updateStore(tenantId, id, input); },
    createSupplier: (_: unknown, input: { code: string; name: string; contactName: string; phone: string; email: string; address: string }, context: GraphQLContext) => { requireAdmin(context); return createSupplier(tenant(context), input); },
    updateSupplier: (_: unknown, { id, ...input }: { id: string; name?: string; contactName?: string; phone?: string; email?: string; address?: string; status?: "active" | "inactive" }, context: GraphQLContext) => { requireAdmin(context); return updateSupplier(tenant(context), id, input); },
    upsertSupplierProduct: (_: unknown, input: { supplierId: string; productId: string; supplierSku: string; purchaseUnit: string; purchaseQuantity: number; purchaseMeasurementUnit: string; lastPurchasePrice?: number | null; preferred: boolean }, context: GraphQLContext) => { requireAdmin(context); return upsertSupplierProduct(tenant(context), { ...input, lastPurchasePrice: input.lastPurchasePrice ?? null }); },
    upsertStorePolicy: (_: unknown, input: { storeId: string; productId: string; reorderPoint: number; targetQuantity: number }, context: GraphQLContext) => { requireAdmin(context); return upsertStorePolicy(tenant(context), input); },
    createPurchaseOrder: (_: unknown, input: { supplierId: string; storeId: string; expectedDeliveryDate?: string; notes: string; lines: Array<{ productId: string; orderedPurchaseQuantity: number; pricePerPurchaseUnit?: number }>; requestId: string }, context: GraphQLContext) => { requireAdmin(context); return createPurchaseOrder(tenant(context), input, actor(context), input.requestId); },
    updatePurchaseOrder: (_: unknown, { id, ...input }: { id: string; supplierId: string; storeId: string; expectedDeliveryDate?: string; notes: string; lines: Array<{ productId: string; orderedPurchaseQuantity: number; pricePerPurchaseUnit?: number }> }, context: GraphQLContext) => { requireAdmin(context); return updatePurchaseOrder(tenant(context), id, input); },
    issuePurchaseOrder: (_: unknown, { id }: { id: string }, context: GraphQLContext) => { requireAdmin(context); return setPurchaseOrderStatus(tenant(context), id, "issue", ""); },
    closePurchaseOrder: (_: unknown, { id, reason }: { id: string; reason: string }, context: GraphQLContext) => { requireAdmin(context); return setPurchaseOrderStatus(tenant(context), id, "close", reason); },
    cancelPurchaseOrder: (_: unknown, { id, reason }: { id: string; reason: string }, context: GraphQLContext) => { requireAdmin(context); return setPurchaseOrderStatus(tenant(context), id, "cancel", reason); },
    receivePurchaseOrder: (_: unknown, { purchaseOrderId, deliveryNote, invoiceNumber, lines, requestId }: { purchaseOrderId: string; deliveryNote: string; invoiceNumber: string; lines: ReceiptLineInput[]; requestId: string }, context: GraphQLContext) => { requireAdmin(context); return receivePurchaseOrder(tenant(context), purchaseOrderId, deliveryNote, invoiceNumber, lines, actor(context), requestId); },
    writeOffLot: (_: unknown, { lotId, quantity, type, reason, requestId }: { lotId: string; quantity: number; type: "damage" | "expiry"; reason: string; requestId: string }, context: GraphQLContext) => { requireAdmin(context); if (!(type === "damage" || type === "expiry")) throw new Error("Write-off type must be damage or expiry"); return writeOffLot(tenant(context), lotId, quantity, type, reason, actor(context), requestId); },
    countInventoryLot: (_: unknown, { lotId, physicalQuantity, reason, requestId }: { lotId: string; physicalQuantity: number; reason: string; requestId: string }, context: GraphQLContext) => { requireAdmin(context); return countLot(tenant(context), lotId, physicalQuantity, reason, actor(context), requestId); },
    createStockTransfer: (_: unknown, input: { fromStoreId: string; toStoreId: string; notes: string; lines: Array<{ productId: string; quantity: number }>; requestId: string }, context: GraphQLContext) => { requireAdmin(context); return createTransfer(tenant(context), input, actor(context), input.requestId); },
    dispatchStockTransfer: (_: unknown, { id, requestId }: { id: string; requestId: string }, context: GraphQLContext) => { requireAdmin(context); return dispatchTransfer(tenant(context), id, actor(context), requestId); },
    receiveStockTransfer: (_: unknown, { id, lines, requestId }: { id: string; lines: Array<{ lotId: string; receivedQuantity: number; damagedQuantity: number; missingQuantity: number; reason: string }>; requestId: string }, context: GraphQLContext) => { requireAdmin(context); return receiveTransfer(tenant(context), id, lines, actor(context), requestId); },
    cancelStockTransfer: (_: unknown, { id, reason }: { id: string; reason: string }, context: GraphQLContext) => { requireAdmin(context); return cancelTransfer(tenant(context), id, reason); },
    createStockRequisition: async (_: unknown, { toStoreId, requestId, ...input }: { fromStoreId: string; toStoreId?: string; notes: string; lines: Array<{ productId: string; quantity: number }>; requestId: string }, context: GraphQLContext) => { requireStaff(context); const store = await selectedStore(context, toStoreId); return createRequisition(tenant(context), { ...input, toStoreId: store.id }, actor(context), requestId); },
    decideStockRequisition: (_: unknown, { id, decision, reason }: { id: string; decision: string; reason: string }, context: GraphQLContext) => { requireAdmin(context); if (!(["approve", "reject", "cancel"] as string[]).includes(decision)) throw new Error("Decision must be approve, reject, or cancel"); return decideRequisition(tenant(context), id, decision as "approve" | "reject" | "cancel", reason, actor(context)); },
    convertStockRequisition: (_: unknown, { id, requestId }: { id: string; requestId: string }, context: GraphQLContext) => { requireAdmin(context); return convertRequisitionToTransfer(tenant(context), id, actor(context), requestId); },
    createStocktake: (_: unknown, { storeId, name, productId, requestId }: { storeId: string; name: string; productId?: string; requestId: string }, context: GraphQLContext) => { requireAdmin(context); return createStocktake(tenant(context), storeId, name, actor(context), requestId, productId); },
    completeStocktake: (_: unknown, { id, counts, reason, requestId }: { id: string; counts: Array<{ lotId: string; quantity: number }>; reason: string; requestId: string }, context: GraphQLContext) => { requireAdmin(context); return completeStocktake(tenant(context), id, counts, reason, actor(context), requestId); },
    cancelStocktake: (_: unknown, { id, reason }: { id: string; reason: string }, context: GraphQLContext) => { requireAdmin(context); return cancelStocktake(tenant(context), id, reason, actor(context)); },
    openCashShift: async (_: unknown, { storeId, openingFloat, requestId }: { storeId?: string; openingFloat: number; requestId: string }, context: GraphQLContext) => { const user = requireStaff(context); const store = await selectedStore(context, storeId); const cognito = await getCognitoUser(user.username); return openCashShift(tenant(context), store, openingFloat, { id: user.id, name: cognito.name }, requestId); },
    recordCashMovement: (_: unknown, { shiftId, type, amount, reason, requestId }: { shiftId: string; type: "cash_in" | "cash_out"; amount: number; reason: string; requestId: string }, context: GraphQLContext) => { const user = requireStaff(context); if (!(type === "cash_in" || type === "cash_out")) throw new Error("Cash movement type must be cash_in or cash_out"); return recordCashMovement(tenant(context), shiftId, type, amount, reason, { id: user.id, name: user.username }, requestId); },
    closeCashShift: (_: unknown, { id, countedCash, requestId }: { id: string; countedCash: number; requestId: string }, context: GraphQLContext) => { const user = requireStaff(context); return closeCashShift(tenant(context), id, countedCash, { id: user.id, name: user.username }, requestId); },
  },
};
