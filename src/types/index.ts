// Base entity with common fields
export interface BaseEntity {
  PK: string; // Partition Key
  SK: string; // Sort Key
  entityType: string;
  createdAt: string;
  updatedAt: string;
  GSI1PK?: string;
  GSI1SK?: string;
  GSI2PK?: string;
  GSI2SK?: string;
}

// User/Staff entity
export interface User extends BaseEntity {
  id: string;
  email: string;
  name: string;
  role: "admin" | "staff" | "manager";
  passwordHash: string;
  tenantId: string;
  status: "active" | "inactive" | "suspended";
  lastLogin?: string;
  permissions: string[];
}

// Product entity
export interface Product extends BaseEntity {
  id: string;
  name: string;
  description: string;
  price: number;
  cost: number;
  sku: string;
  category: string;
  stock: number;
  minStock: number;
  maxStock: number;
  imageUrl?: string;
  status: "active" | "inactive" | "out_of_stock";
  tenantId: string;
}

// Order entity
export interface Order extends BaseEntity {
  id: string;
  orderNumber: string;
  customerId?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  discount: number;
  totalAmount: number;
  status: "pending" | "processing" | "completed" | "cancelled" | "refunded";
  paymentMethod: "cash" | "card" | "mobile_money" | "bank_transfer";
  paymentStatus: "paid" | "unpaid" | "partial" | "refunded";
  createdBy: string; // User ID
  tenantId: string;
  notes?: string;
}

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  cost: number;
  total: number;
  tax: number;
}

// Customer entity
export interface Customer extends BaseEntity {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  totalSpent: number;
  ordersCount: number;
  lastOrderDate?: string;
  tenantId: string;
  status: "active" | "inactive";
}

// Inventory entity
export interface Inventory extends BaseEntity {
  id: string;
  productId: string;
  productName: string;
  location: string; // e.g., 'warehouse', 'storefront'
  quantity: number;
  lastCountDate?: string;
  tenantId: string;
}

// Category entity
export interface Category extends BaseEntity {
  id: string;
  name: string;
  description?: string;
  parentId?: string;
  tenantId: string;
}

// Activity/Log entity
export interface ActivityLog extends BaseEntity {
  id: string;
  entityId: string; // User, Product, Order, etc.
  entityType: string;
  action:
    | "created"
    | "updated"
    | "deleted"
    | "viewed"
    | "logged_in"
    | "logged_out";
  userId: string;
  userName: string;
  changes?: Record<string, any>;
  ipAddress?: string;
  tenantId: string;
}

// Settings entity
export interface Settings extends BaseEntity {
  tenantId: string;
  businessName: string;
  businessAddress: string;
  businessPhone: string;
  businessEmail: string;
  taxRate: number;
  currency: string;
  receiptFooter: string;
  timezone: string;
}
