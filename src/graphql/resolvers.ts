import { randomUUID } from "crypto";
import { requireRole, type GraphQLContext, type UserRole } from "../auth";
import {
  getCognitoUser,
  inviteCognitoUser,
  listCognitoUsers,
  resendCognitoInvitation,
  setCognitoUserEnabled,
  setCognitoUserRoles,
} from "../services/cognito";

const requireStaff = (context: GraphQLContext) =>
  requireRole(context, ["admin", "staff"]);
const requireAdmin = (context: GraphQLContext) => requireRole(context, ["admin"]);

const parseRoles = (roles: string[]): UserRole[] => {
  const normalized = [...new Set(roles)];
  if (
    normalized.length === 0 ||
    normalized.some((role) => role !== "admin" && role !== "staff")
  ) {
    throw new Error("Roles must contain admin, staff, or both");
  }
  return normalized as UserRole[];
};

type MockOrder = {
  id: string;
  orderNumber: string;
  customerId: string | null;
  customerName: string;
  items: Array<{ productId: string; quantity: number; price: number }>;
  totalAmount: number;
  tax: number;
  discount: number;
  subtotal: number;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

// The remaining POS domain data is still in memory until its DynamoDB migration.
const mockProducts = [
  {
    id: "1",
    name: "Product 1",
    description: "Description 1",
    price: 100,
    cost: 80,
    sku: "SKU001",
    category: "Category 1",
    stock: 50,
    minStock: 10,
    maxStock: 100,
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const mockOrders: MockOrder[] = [];

export const resolvers = {
  Query: {
    me: async (_: unknown, _args: unknown, context: GraphQLContext) => {
      const auth = requireStaff(context);
      return getCognitoUser(auth.username);
    },
    users: async (_: unknown, _args: unknown, context: GraphQLContext) => {
      requireAdmin(context);
      return listCognitoUsers();
    },
    user: async (_: unknown, { id }: { id: string }, context: GraphQLContext) => {
      requireAdmin(context);
      return getCognitoUser(id);
    },

    products: (_: unknown, _args: unknown, context: GraphQLContext) => {
      requireStaff(context);
      return mockProducts;
    },
    product: (_: unknown, { id }: { id: string }, context: GraphQLContext) => {
      requireStaff(context);
      return mockProducts.find((product) => product.id === id);
    },
    productsByCategory: (
      _: unknown,
      { category }: { category: string },
      context: GraphQLContext,
    ) => {
      requireStaff(context);
      return mockProducts.filter((product) => product.category === category);
    },

    orders: (_: unknown, _args: unknown, context: GraphQLContext) => {
      requireStaff(context);
      return mockOrders;
    },
    order: (_: unknown, { id }: { id: string }, context: GraphQLContext) => {
      requireStaff(context);
      return mockOrders.find((order) => order.id === id);
    },
    ordersByCustomer: (
      _: unknown,
      { customerId }: { customerId: string },
      context: GraphQLContext,
    ) => {
      requireStaff(context);
      return mockOrders.filter((order) => order.customerId === customerId);
    },
    todayOrders: (_: unknown, _args: unknown, context: GraphQLContext) => {
      requireStaff(context);
      const today = new Date().toDateString();
      return mockOrders.filter(
        (order) => new Date(order.createdAt).toDateString() === today,
      );
    },

    customers: (_: unknown, _args: unknown, context: GraphQLContext) => {
      requireStaff(context);
      return [];
    },
    customer: (_: unknown, _args: unknown, context: GraphQLContext) => {
      requireStaff(context);
      return null;
    },
  },

  Mutation: {
    inviteUser: async (
      _: unknown,
      { email, name, roles }: { email: string; name: string; roles: string[] },
      context: GraphQLContext,
    ) => {
      requireAdmin(context);
      if (!email.trim() || !name.trim()) throw new Error("Name and email are required");
      return inviteCognitoUser({ email, name, roles: parseRoles(roles) });
    },
    resendUserInvitation: async (
      _: unknown,
      { username }: { username: string },
      context: GraphQLContext,
    ) => {
      requireAdmin(context);
      return resendCognitoInvitation(username);
    },
    updateUserRoles: async (
      _: unknown,
      { username, roles }: { username: string; roles: string[] },
      context: GraphQLContext,
    ) => {
      const admin = requireAdmin(context);
      if (admin.username === username && !roles.includes("admin")) {
        throw new Error("Administrators cannot remove their own admin role");
      }
      return setCognitoUserRoles(username, parseRoles(roles));
    },
    setUserEnabled: async (
      _: unknown,
      { username, enabled }: { username: string; enabled: boolean },
      context: GraphQLContext,
    ) => {
      const admin = requireAdmin(context);
      if (admin.username === username && !enabled) {
        throw new Error("Administrators cannot disable their own account");
      }
      return setCognitoUserEnabled(username, enabled);
    },

    createProduct: (_: unknown, args: Record<string, unknown>, context: GraphQLContext) => {
      requireAdmin(context);
      const product = {
        id: randomUUID(),
        ...args,
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as (typeof mockProducts)[number];
      mockProducts.push(product);
      return product;
    },
    updateProduct: (
      _: unknown,
      { id, ...updates }: { id: string } & Record<string, unknown>,
      context: GraphQLContext,
    ) => {
      requireAdmin(context);
      const index = mockProducts.findIndex((product) => product.id === id);
      if (index === -1) throw new Error("Product not found");
      mockProducts[index] = {
        ...mockProducts[index],
        ...updates,
        updatedAt: new Date().toISOString(),
      } as (typeof mockProducts)[number];
      return mockProducts[index];
    },
    deleteProduct: (_: unknown, { id }: { id: string }, context: GraphQLContext) => {
      requireAdmin(context);
      const index = mockProducts.findIndex((product) => product.id === id);
      if (index === -1) return false;
      mockProducts.splice(index, 1);
      return true;
    },

    createOrder: (
      _: unknown,
      { customerId, customerName, items, paymentMethod }: any,
      context: GraphQLContext,
    ) => {
      const auth = requireStaff(context);
      const subtotal = items.reduce(
        (sum: number, item: any) => sum + item.price * item.quantity,
        0,
      );
      const tax = subtotal * 0.16;
      const now = new Date().toISOString();
      const order: MockOrder = {
        id: randomUUID(),
        orderNumber: `ORD-${Date.now()}`,
        customerId: customerId || null,
        customerName,
        items,
        totalAmount: subtotal + tax,
        tax,
        discount: 0,
        subtotal,
        status: "pending",
        paymentMethod,
        paymentStatus: "unpaid",
        createdBy: auth.id,
        createdAt: now,
        updatedAt: now,
      };
      mockOrders.push(order);
      return order;
    },
    updateOrderStatus: (
      _: unknown,
      { id, status }: { id: string; status: string },
      context: GraphQLContext,
    ) => {
      requireAdmin(context);
      const order = mockOrders.find((candidate) => candidate.id === id);
      if (!order) throw new Error("Order not found");
      order.status = status;
      order.updatedAt = new Date().toISOString();
      return order;
    },
    cancelOrder: (_: unknown, { id }: { id: string }, context: GraphQLContext) => {
      requireAdmin(context);
      const order = mockOrders.find((candidate) => candidate.id === id);
      if (!order) throw new Error("Order not found");
      order.status = "cancelled";
      order.updatedAt = new Date().toISOString();
      return order;
    },

    createCustomer: (_: unknown, args: Record<string, unknown>, context: GraphQLContext) => {
      requireStaff(context);
      return {
        id: randomUUID(),
        ...args,
        totalSpent: 0,
        orders: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    updateCustomer: (
      _: unknown,
      { id, ...updates }: { id: string } & Record<string, unknown>,
      context: GraphQLContext,
    ) => {
      requireStaff(context);
      return { id, ...updates, updatedAt: new Date().toISOString() };
    },
  },
};
