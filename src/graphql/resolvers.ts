import { randomUUID, scryptSync, timingSafeEqual } from "crypto";
import {
  createUser,
  getAdminsAndStaff,
  getItem,
  getUserByEmail,
} from "../utils/db-helpers";
import { Keys } from "../config/db";

const tenantId = process.env.SEED_TENANT_ID || "tenant_001";

const getPermissionsForRole = (role: string) => {
  if (role === "admin") return ["*"];
  if (role === "staff") {
    return ["orders:read", "orders:create", "products:read"];
  }

  return [];
};

const hashPassword = (password: string) => {
  const salt = randomUUID();
  const hash = scryptSync(password, salt, 64).toString("hex");

  return `${salt}:${hash}`;
};

const verifyPassword = (password: string, passwordHash: string) => {
  const [salt, storedHash] = passwordHash.split(":");

  if (!salt || !storedHash) {
    return false;
  }

  const hash = scryptSync(password, salt, 64);
  const stored = Buffer.from(storedHash, "hex");

  return stored.length === hash.length && timingSafeEqual(stored, hash);
};

const sanitizeUser = (user: any) => {
  if (!user) return null;

  const {
    PK,
    SK,
    GSI1PK,
    GSI1SK,
    GSI2PK,
    GSI2SK,
    passwordHash,
    ...safeUser
  } = user;

  return safeUser;
};

type MockOrder = {
  id: string;
  orderNumber: string;
  customerId: string | null;
  customerName: string;
  items: Array<{
    productId: string;
    quantity: number;
    price: number;
  }>;
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

// Mock data (replace with actual AWS DynamoDB operations)
const mockUsers = [
  {
    id: "1",
    email: "admin@example.com",
    name: "Admin User",
    role: "admin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "2",
    email: "staff@example.com",
    name: "Staff User",
    role: "staff",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

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
    // User queries
    me: async () => null,
    users: async () => {
      const users = await getAdminsAndStaff();
      return users.map(sanitizeUser);
    },
    user: async (_: any, { id }: { id: string }) => {
      const user = await getItem(Keys.user(id).PK, Keys.user(id).SK);
      return sanitizeUser(user);
    },

    // Product queries
    products: () => mockProducts,
    product: (_: any, { id }: { id: string }) =>
      mockProducts.find((product) => product.id === id),
    productsByCategory: (_: any, { category }: { category: string }) =>
      mockProducts.filter((product) => product.category === category),

    // Order queries
    orders: () => mockOrders,
    order: (_: any, { id }: { id: string }) =>
      mockOrders.find((order) => order.id === id),
    ordersByCustomer: (_: any, { customerId }: { customerId: string }) =>
      mockOrders.filter((order) => order.customerId === customerId),
    todayOrders: () =>
      mockOrders.filter((order) => {
        const today = new Date().toDateString();
        return new Date(order.createdAt).toDateString() === today;
      }),

    // Customer queries
    customers: () => [],
    customer: (_: any, { id }: { id: string }) => null,
  },

  Mutation: {
    // Auth mutations
    register: async (_: any, { email, password, name, role }: any) => {
      const existingUser = await getUserByEmail(email);

      if (existingUser) {
        throw new Error("User already exists");
      }

      const user = await createUser({
        email,
        name,
        role,
        tenantId,
        status: "active",
        permissions: getPermissionsForRole(role),
        passwordHash: hashPassword(password),
      });

      return {
        token: "mock-jwt-token",
        user: sanitizeUser(user),
      };
    },

    login: async (_: any, { email, password }: any) => {
      const user = await getUserByEmail(email);

      if (!user) {
        throw new Error("User not found");
      }

      if (!verifyPassword(password, user.passwordHash)) {
        throw new Error("Invalid password");
      }

      return {
        token: "mock-jwt-token",
        user: sanitizeUser(user),
      };
    },

    // Product mutations
    createProduct: (_: any, args: any) => {
      const product = {
        id: randomUUID(),
        ...args,
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      mockProducts.push(product);
      return product;
    },

    updateProduct: (_: any, { id, ...updates }: any) => {
      const index = mockProducts.findIndex((p) => p.id === id);
      if (index === -1) throw new Error("Product not found");
      mockProducts[index] = {
        ...mockProducts[index],
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      return mockProducts[index];
    },

    deleteProduct: (_: any, { id }: { id: string }) => {
      const index = mockProducts.findIndex((p) => p.id === id);
      if (index === -1) return false;
      mockProducts.splice(index, 1);
      return true;
    },

    // Order mutations
    createOrder: (
      _: any,
      { customerId, customerName, items, paymentMethod }: any,
    ) => {
      const subtotal = items.reduce(
        (sum: number, item: any) => sum + item.price * item.quantity,
        0,
      );
      const tax = subtotal * 0.16; // 16% tax
      const totalAmount = subtotal + tax;

      const order = {
        id: randomUUID(),
        orderNumber: `ORD-${Date.now()}`,
        customerId: customerId || null,
        customerName,
        items,
        totalAmount,
        tax,
        discount: 0,
        subtotal,
        status: "pending",
        paymentMethod,
        paymentStatus: "unpaid",
        createdBy: "1", // Mock user ID
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      mockOrders.push(order);
      return order;
    },

    updateOrderStatus: (_: any, { id, status }: any) => {
      const order = mockOrders.find((o) => o.id === id);
      if (!order) throw new Error("Order not found");
      order.status = status;
      order.updatedAt = new Date().toISOString();
      return order;
    },

    cancelOrder: (_: any, { id }: { id: string }) => {
      const order = mockOrders.find((o) => o.id === id);
      if (!order) throw new Error("Order not found");
      order.status = "cancelled";
      order.updatedAt = new Date().toISOString();
      return order;
    },

    // Customer mutations
    createCustomer: (_: any, args: any) => {
      return {
        id: randomUUID(),
        ...args,
        totalSpent: 0,
        orders: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },

    updateCustomer: (_: any, { id, ...updates }: any) => {
      // Mock implementation
      return {
        id,
        ...updates,
        updatedAt: new Date().toISOString(),
      };
    },
  },
};
