export const typeDefs = `#graphql
  type StaffProfile {
    employeeCode: String!
    jobTitle: String!
    storeId: ID
    storeName: String
    phone: String!
  }

  type User {
    id: ID!
    username: String!
    email: String!
    name: String!
    firstName: String!
    lastName: String!
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
    sellingPrice: Float!
    buyingPrice: Float!
    baseUnit: String!
    tracksExpiry: Boolean!
    promotionPrice: Float
    promotionStartsAt: String
    promotionEndsAt: String
    effectivePrice: Float!
    onPromotion: Boolean!
    storeStock: StoreProductStock
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
    regularPrice: Float
    promotionApplied: Boolean
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
    cashShiftId: ID
    createdBy: String!
    createdByName: String!
    storeId: ID
    storeName: String
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
    savings: Float!
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

  type StockReportProduct {
    productId: ID!
    productName: String!
    sku: String!
    quantity: Int!
    reorderPoint: Int!
    actualCostValue: Float!
    sellingPrice: Float!
    retailValue: Float!
    status: String!
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

  type Business {
    id: ID!
    name: String!
  }

  type ReportProduct {
    productId: ID!
    productName: String!
    units: Int!
    revenue: Float!
    grossProfit: Float!
    savings: Float!
  }

  type BusinessReport {
    from: String!
    to: String!
    salesCount: Int!
    revenue: Float!
    grossProfit: Float!
    unitsSold: Int!
    promotionUnitsSold: Int!
    promotionRevenue: Float!
    promotionSavings: Float!
    stockUnits: Int!
    stockCostValue: Float!
    stockRetailValue: Float!
    potentialMargin: Float!
    lowStockCount: Int!
    outOfStockCount: Int!
    netStockAdjustment: Int!
    stockAdjustmentCount: Int!
    priceChangeCount: Int!
    topProducts: [ReportProduct!]!
    promotionProducts: [ReportProduct!]!
    stockProducts: [StockReportProduct!]!
    stockAdjustments: [AuditEvent!]!
    priceChanges: [AuditEvent!]!
  }

  input SaleItemInput {
    productId: ID!
    quantity: Int!
  }

  type Store {
    id: ID!
    code: String!
    name: String!
    address: String!
    status: String!
    createdAt: String!
    updatedAt: String!
  }

  type Supplier {
    id: ID!
    code: String!
    name: String!
    contactName: String!
    phone: String!
    email: String!
    address: String!
    status: String!
    createdAt: String!
    updatedAt: String!
  }

  type SupplierProduct {
    supplierId: ID!
    productId: ID!
    supplierSku: String!
    purchaseUnit: String!
    unitsPerPurchaseUnit: Int!
    lastPurchasePrice: Float!
    preferred: Boolean!
    updatedAt: String!
  }

  type StoreProductPolicy {
    storeId: ID!
    productId: ID!
    reorderPoint: Int!
    targetQuantity: Int!
    updatedAt: String!
  }

  type StoreProductStock {
    storeId: ID!
    productId: ID!
    quantity: Int!
    inventoryValue: Float!
    reorderPoint: Int!
    targetQuantity: Int!
    lowStock: Boolean!
  }

  type PurchaseOrderLine {
    id: ID!
    productId: ID!
    productName: String!
    supplierSku: String!
    purchaseUnit: String!
    unitsPerPurchaseUnit: Int!
    orderedPurchaseQuantity: Int!
    acceptedBaseQuantity: Int!
    pricePerPurchaseUnit: Float!
  }

  type PurchaseOrder {
    id: ID!
    orderNumber: String!
    supplierId: ID!
    supplierName: String!
    storeId: ID!
    storeName: String!
    status: String!
    expectedDeliveryDate: String
    notes: String!
    closeReason: String
    lines: [PurchaseOrderLine!]!
    totalAmount: Float!
    createdBy: ID!
    createdByName: String!
    issuedAt: String
    receiptCount: Int!
    createdAt: String!
    updatedAt: String!
  }

  type GoodsReceiptLine {
    purchaseOrderLineId: ID!
    productId: ID!
    productName: String!
    batchNumber: String
    expiryDate: String
    deliveredBaseQuantity: Int!
    acceptedBaseQuantity: Int!
    damagedBaseQuantity: Int!
    rejectedBaseQuantity: Int!
    orderedPricePerPurchaseUnit: Float!
    actualPricePerPurchaseUnit: Float!
    priceVariance: Float!
    unitCost: Float!
    lotId: ID
  }

  type GoodsReceipt {
    id: ID!
    receiptNumber: String!
    purchaseOrderId: ID!
    orderNumber: String!
    supplierId: ID!
    supplierName: String!
    storeId: ID!
    storeName: String!
    deliveryNote: String!
    invoiceNumber: String!
    lines: [GoodsReceiptLine!]!
    createdBy: ID!
    createdByName: String!
    createdAt: String!
  }

  type InventoryLot {
    id: ID!
    storeId: ID!
    productId: ID!
    productName: String!
    supplierId: ID
    receiptId: ID
    batchNumber: String!
    expiryDate: String
    receivedQuantity: Int!
    remainingQuantity: Int!
    unitCost: Float!
    origin: String!
    status: String!
    receivedAt: String!
    updatedAt: String!
  }

  type StockMovement {
    id: ID!
    type: String!
    storeId: ID!
    productId: ID!
    productName: String!
    lotId: ID
    quantity: Int!
    unitCost: Float!
    reason: String!
    referenceId: ID
    actorId: ID!
    actorName: String!
    createdAt: String!
  }

  type TransferAllocation { lotId: ID!, quantity: Int!, unitCost: Float!, batchNumber: String!, expiryDate: String, supplierId: ID }
  type TransferReceiptLine { lotId: ID!, productId: ID!, productName: String!, dispatchedQuantity: Int!, receivedQuantity: Int!, damagedQuantity: Int!, missingQuantity: Int!, reason: String!, destinationLotId: ID }
  type StockTransferLine { productId: ID!, productName: String!, quantity: Int!, allocations: [TransferAllocation!] }
  type StockTransfer {
    id: ID!
    transferNumber: String!
    fromStoreId: ID!
    fromStoreName: String!
    toStoreId: ID!
    toStoreName: String!
    status: String!
    notes: String!
    lines: [StockTransferLine!]!
    createdBy: ID!
    createdByName: String!
    dispatchedAt: String
    receivedAt: String
    receivedBy: ID
    receivedByName: String
    receiptLines: [TransferReceiptLine!]
    createdAt: String!
    updatedAt: String!
  }

  type StocktakeLine { lotId: ID!, productId: ID!, productName: String!, batchNumber: String!, expectedQuantity: Int!, countedQuantity: Int, variance: Int, unitCost: Float! }
  type StocktakeSession { id: ID!, stocktakeNumber: String!, storeId: ID!, storeName: String!, name: String!, status: String!, lines: [StocktakeLine!]!, createdBy: ID!, createdByName: String!, completedBy: ID, completedByName: String, reason: String, createdAt: String!, completedAt: String, updatedAt: String! }
  type CashShift { id: ID!, shiftNumber: String!, storeId: ID!, storeName: String!, cashierId: ID!, cashierName: String!, status: String!, openingFloat: Float!, cashSalesTotal: Float!, cashInTotal: Float!, cashOutTotal: Float!, expectedCash: Float, countedCash: Float, variance: Float, openedAt: String!, closedAt: String, updatedAt: String! }
  type CashMovement { id: ID!, shiftId: ID!, storeId: ID!, type: String!, amount: Float!, reason: String!, actorId: ID!, actorName: String!, createdAt: String! }

  type ReplenishmentSuggestion {
    storeId: ID!
    supplierId: ID!
    productId: ID!
    availableQuantity: Int!
    projectedQuantity: Int!
    reorderPoint: Int!
    targetQuantity: Int!
    openPurchaseOrderQuantity: Int!
    inboundTransferQuantity: Int!
    suggestedPurchaseQuantity: Int!
    supplierProduct: SupplierProduct!
  }

  type SupplyChainReport {
    from: String!
    to: String!
    purchaseSpend: Float!
    orderedValue: Float!
    receivedValue: Float!
    priceVariance: Float!
    damagedValue: Float!
    inventoryValue: Float!
    inTransitValue: Float!
    purchaseOrders: [PurchaseOrder!]!
    receipts: [GoodsReceipt!]!
    movements: [StockMovement!]!
    transfers: [StockTransfer!]!
    stock: [StoreProductStock!]!
    expiryLots: [InventoryLot!]!
    replenishment: [ReplenishmentSuggestion!]!
  }

  input PurchaseOrderLineInput { productId: ID!, orderedPurchaseQuantity: Int!, pricePerPurchaseUnit: Float }
  input GoodsReceiptLineInput { purchaseOrderLineId: ID!, batchNumber: String, expiryDate: String, deliveredBaseQuantity: Int!, acceptedBaseQuantity: Int!, damagedBaseQuantity: Int!, rejectedBaseQuantity: Int!, actualPricePerPurchaseUnit: Float! }
  input StockTransferLineInput { productId: ID!, quantity: Int! }
  input TransferReceiptLineInput { lotId: ID!, receivedQuantity: Int!, damagedQuantity: Int!, missingQuantity: Int!, reason: String = "" }
  input StocktakeCountInput { lotId: ID!, quantity: Int! }

  type Query {
    me: User!
    users: [User!]!
    user(username: String!): User
    categories: [Category!]!
    products(storeId: ID): [Product!]!
    productPage(search: String = "", limit: Int = 20, cursor: String, activeOnly: Boolean = false, storeId: ID): ProductPage!
    product(id: ID!): Product
    productLookup(term: String!, storeId: ID): Product
    sales(limit: Int = 50, personal: Boolean = false, from: String, to: String, storeId: ID): [Sale!]!
    sale(id: ID!, personal: Boolean = false): Sale
    stockAudits(limit: Int = 100): [AuditEvent!]!
    dashboard(days: Int = 1, personal: Boolean = false, compact: Boolean = false): DashboardSummary!
    businessSettings: BusinessSettings!
    business: Business!
    businessReport(from: String!, to: String!, storeId: ID): BusinessReport!
    stores(activeOnly: Boolean = false): [Store!]!
    suppliers(activeOnly: Boolean = false): [Supplier!]!
    supplierProducts(supplierId: ID): [SupplierProduct!]!
    storePolicies(storeId: ID!): [StoreProductPolicy!]!
    storeStock(storeId: ID): [StoreProductStock!]!
    purchaseOrders: [PurchaseOrder!]!
    purchaseOrder(id: ID!): PurchaseOrder
    goodsReceipts: [GoodsReceipt!]!
    goodsReceipt(id: ID!): GoodsReceipt
    inventoryLots(storeId: ID, includeExhausted: Boolean = false): [InventoryLot!]!
    stockMovements(from: String, to: String, storeId: ID): [StockMovement!]!
    stockTransfers: [StockTransfer!]!
    stockTransfer(id: ID!): StockTransfer
    stocktakes(storeId: ID): [StocktakeSession!]!
    stocktake(id: ID!): StocktakeSession
    myOpenCashShift(storeId: ID): CashShift
    cashShifts(limit: Int = 100, from: String, to: String, storeId: ID): [CashShift!]!
    replenishmentSuggestions(storeId: ID!, supplierId: ID!): [ReplenishmentSuggestion!]!
    supplyChainReport(from: String!, to: String!, storeId: ID, supplierId: ID, productId: ID, status: String, expiryDays: Int = 30): SupplyChainReport!
  }

  type Mutation {
    createBusiness(name: String!): User!
    inviteUser(email: String!, firstName: String!, lastName: String!, roles: [String!]!, employeeCode: String = "", jobTitle: String = "", storeId: ID!, phone: String = ""): User!
    resendUserInvitation(username: String!): User!
    updateUserRoles(username: String!, roles: [String!]!): User!
    setUserEnabled(username: String!, enabled: Boolean!): User!
    updateStaffEmail(username: String!, email: String!): User!
    deleteStaffUser(username: String!): Boolean!
    updateMyProfile(phone: String!): StaffProfile!
    updateStaffProfile(userId: ID!, employeeCode: String!, jobTitle: String!, storeId: ID!, phone: String!): StaffProfile!
    updateBusinessSettings(businessName: String!, address: String!, phone: String = "", email: String = "", thankYouMessage: String!, returnPolicy: String!): BusinessSettings!

    createCategory(code: String!, name: String!, description: String = ""): Category!
    updateCategory(id: ID!, code: String!, name: String!, description: String = ""): Category!
    deleteCategory(id: ID!): Boolean!
    createProduct(name: String!, description: String = "", sku: String!, barcode: String!, categoryId: ID!, sellingPrice: Float!, buyingPrice: Float!, baseUnit: String!, tracksExpiry: Boolean!): Product!
    updateProduct(id: ID!, name: String, description: String, sku: String, barcode: String, categoryId: ID, sellingPrice: Float, buyingPrice: Float, baseUnit: String, tracksExpiry: Boolean, promotionPrice: Float, promotionStartsAt: String, promotionEndsAt: String, status: String): Product!
    archiveProduct(id: ID!): Product!
    completeSale(storeId: ID, customerName: String, paymentMethod: String!, amountTendered: Float, mpesaReference: String, items: [SaleItemInput!]!, requestId: ID!): Sale!
    createStore(code: String!, name: String!, address: String = ""): Store!
    updateStore(id: ID!, name: String, address: String, status: String): Store!
    createSupplier(code: String!, name: String!, contactName: String = "", phone: String = "", email: String = "", address: String = ""): Supplier!
    updateSupplier(id: ID!, name: String, contactName: String, phone: String, email: String, address: String, status: String): Supplier!
    upsertSupplierProduct(supplierId: ID!, productId: ID!, supplierSku: String!, purchaseUnit: String!, unitsPerPurchaseUnit: Int!, lastPurchasePrice: Float!, preferred: Boolean!): SupplierProduct!
    upsertStorePolicy(storeId: ID!, productId: ID!, reorderPoint: Int!, targetQuantity: Int!): StoreProductPolicy!
    createPurchaseOrder(supplierId: ID!, storeId: ID!, expectedDeliveryDate: String, notes: String = "", lines: [PurchaseOrderLineInput!]!, requestId: ID!): PurchaseOrder!
    updatePurchaseOrder(id: ID!, supplierId: ID!, storeId: ID!, expectedDeliveryDate: String, notes: String = "", lines: [PurchaseOrderLineInput!]!): PurchaseOrder!
    issuePurchaseOrder(id: ID!): PurchaseOrder!
    closePurchaseOrder(id: ID!, reason: String!): PurchaseOrder!
    cancelPurchaseOrder(id: ID!, reason: String = "Cancelled"): PurchaseOrder!
    receivePurchaseOrder(purchaseOrderId: ID!, deliveryNote: String = "", invoiceNumber: String = "", lines: [GoodsReceiptLineInput!]!, requestId: ID!): GoodsReceipt!
    writeOffLot(lotId: ID!, quantity: Int!, type: String!, reason: String!, requestId: ID!): StockMovement!
    countInventoryLot(lotId: ID!, physicalQuantity: Int!, reason: String!, requestId: ID!): StockMovement!
    createStockTransfer(fromStoreId: ID!, toStoreId: ID!, notes: String = "", lines: [StockTransferLineInput!]!, requestId: ID!): StockTransfer!
    dispatchStockTransfer(id: ID!, requestId: ID!): StockTransfer!
    receiveStockTransfer(id: ID!, lines: [TransferReceiptLineInput!]!, requestId: ID!): StockTransfer!
    cancelStockTransfer(id: ID!, reason: String!): StockTransfer!
    createStocktake(storeId: ID!, name: String!, productId: ID, requestId: ID!): StocktakeSession!
    completeStocktake(id: ID!, counts: [StocktakeCountInput!]!, reason: String!, requestId: ID!): StocktakeSession!
    cancelStocktake(id: ID!, reason: String!): StocktakeSession!
    openCashShift(storeId: ID, openingFloat: Float!, requestId: ID!): CashShift!
    recordCashMovement(shiftId: ID!, type: String!, amount: Float!, reason: String!, requestId: ID!): CashMovement!
    closeCashShift(id: ID!, countedCash: Float!, requestId: ID!): CashShift!
  }
`;
