export const typeDefs = `#graphql
  type StaffProfile {
    employeeCode: String!
    jobTitle: String!
    department: String!
    phone: String!
  }

  type User {
    id: ID!
    username: String!
    email: String!
    name: String!
    role: String!
    roles: [String!]!
    status: String!
    emailVerified: Boolean!
    profile: StaffProfile
    createdAt: String!
    updatedAt: String!
  }

  type Category {
    id: ID!
    code: String!
    name: String!
    description: String!
    status: String!
    createdAt: String!
    updatedAt: String!
  }

  type Product {
    id: ID!
    name: String!
    description: String!
    sku: String!
    barcode: String!
    categoryId: ID!
    categoryName: String!
    price: Float!
    cost: Float!
    promotionPrice: Float
    promotionStartsAt: String
    promotionEndsAt: String
    effectivePrice: Float!
    onPromotion: Boolean!
    stock: Int!
    minStock: Int!
    status: String!
    createdAt: String!
    updatedAt: String!
  }

  type ProductPage {
    items: [Product!]!
    totalCount: Int!
    nextCursor: String
  }

  type SaleItem {
    productId: ID!
    productName: String!
    sku: String!
    barcode: String!
    quantity: Int!
    price: Float!
    cost: Float!
    total: Float!
  }

  type Sale {
    id: ID!
    orderNumber: String!
    customerName: String!
    items: [SaleItem!]!
    subtotal: Float!
    tax: Float!
    discount: Float!
    totalAmount: Float!
    status: String!
    paymentMethod: String!
    paymentStatus: String!
    amountTendered: Float
    changeDue: Float
    paymentReference: String
    createdBy: String!
    createdByName: String!
    sellerDepartment: String
    cashierDisplayName: String!
    receiptBranding: BusinessSettings!
    createdAt: String!
    updatedAt: String!
  }

  type AuditEvent {
    id: ID!
    action: String!
    entityType: String!
    entityId: ID!
    productName: String
    quantityBefore: Int
    quantityAfter: Int
    quantityDelta: Int
    reason: String!
    referenceId: String
    actorId: String!
    actorName: String!
    createdAt: String!
  }

  type DashboardSummary {
    periodDays: Int!
    periodStart: String!
    revenue: Float!
    grossProfit: Float!
    averageSale: Float!
    unitsSold: Int!
    salesTotal: Float!
    salesCount: Int!
    itemsSold: Int!
    productCount: Int!
    lowStockCount: Int!
    lowStock: [Product!]!
    recentSales: [Sale!]!
    recentAudits: [AuditEvent!]!
    cashierPerformance: [CashierPerformance!]!
  }

  type CashierPerformance {
    staffId: ID!
    staffName: String!
    salesCount: Int!
    unitsSold: Int!
    revenue: Float!
    grossProfit: Float!
  }

  type BusinessSettings {
    businessName: String!
    address: String!
    phone: String!
    email: String!
    thankYouMessage: String!
    returnPolicy: String!
    updatedAt: String!
  }

  input SaleItemInput {
    productId: ID!
    quantity: Int!
  }

  input StockAdjustmentInput {
    productId: ID!
    delta: Int!
  }

  type Query {
    me: User!
    users: [User!]!
    user(username: String!): User
    categories: [Category!]!
    products: [Product!]!
    productPage(search: String = "", limit: Int = 20, cursor: String, activeOnly: Boolean = false): ProductPage!
    product(id: ID!): Product
    productLookup(term: String!): Product
    sales(limit: Int = 50, personal: Boolean = false): [Sale!]!
    sale(id: ID!, personal: Boolean = false): Sale
    stockAudits(limit: Int = 100): [AuditEvent!]!
    dashboard(days: Int = 1, personal: Boolean = false, compact: Boolean = false): DashboardSummary!
    businessSettings: BusinessSettings!
  }

  type Mutation {
    inviteUser(email: String!, name: String!, roles: [String!]!, employeeCode: String = "", jobTitle: String = "", department: String = "", phone: String = ""): User!
    resendUserInvitation(username: String!): User!
    updateUserRoles(username: String!, roles: [String!]!): User!
    setUserEnabled(username: String!, enabled: Boolean!): User!
    updateMyProfile(phone: String!): StaffProfile!
    updateStaffProfile(userId: ID!, employeeCode: String!, jobTitle: String!, department: String, phone: String!): StaffProfile!
    updateBusinessSettings(businessName: String!, address: String!, phone: String = "", email: String = "", thankYouMessage: String!, returnPolicy: String!): BusinessSettings!

    createCategory(code: String!, name: String!, description: String = ""): Category!
    createProduct(name: String!, description: String = "", sku: String!, barcode: String!, categoryId: ID!, price: Float!, cost: Float!, initialStock: Int!, minStock: Int!): Product!
    updateProduct(id: ID!, name: String, description: String, sku: String, barcode: String, categoryId: ID, price: Float, cost: Float, promotionPrice: Float, promotionStartsAt: String, promotionEndsAt: String, minStock: Int, status: String): Product!
    archiveProduct(id: ID!): Product!
    adjustStock(productId: ID!, delta: Int!, reason: String!): Product!
    adjustStocks(adjustments: [StockAdjustmentInput!]!, reason: String!): [Product!]!
    completeSale(customerName: String, paymentMethod: String!, amountTendered: Float, mpesaReference: String, items: [SaleItemInput!]!): Sale!
  }
`;
