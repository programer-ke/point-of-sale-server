export const typeDefs = `#graphql
  type StaffProfile {
    employeeCode: String!
    jobTitle: String!
    storeId: ID
    storeName: String
    storeIds: [ID!]!
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
    parentId: ID
    parentName: String
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
    vatClass: String
    baseUnit: String!
    stockUnit: String!
    tracksExpiry: Boolean!
    saleVariants: [SaleVariant!]!
    productUnits: [ProductUnit!]!
    promotionPrice: Float
    promotionStartsAt: String
    promotionEndsAt: String
    pendingPriceAdjustment: ProductPriceAdjustment
    effectivePrice: Float!
    onPromotion: Boolean!
    storeStock: StoreProductStock
    status: String!
    createdAt: String!
    updatedAt: String!
    itemType: String!
    serviceComponents: [ServiceComponent!]!
  }

  type CatalogItem {
    id: ID!
    name: String!
    description: String!
    sku: String!
    barcode: String!
    categoryId: ID!
    categoryName: String!
    sellingPrice: Float!
    buyingPrice: Float!
    vatClass: String
    baseUnit: String!
    stockUnit: String!
    tracksExpiry: Boolean!
    saleVariants: [SaleVariant!]!
    productUnits: [ProductUnit!]!
    promotionPrice: Float
    promotionStartsAt: String
    promotionEndsAt: String
    pendingPriceAdjustment: ProductPriceAdjustment
    effectivePrice: Float!
    onPromotion: Boolean!
    storeStock: StoreProductStock
    status: String!
    createdAt: String!
    updatedAt: String!
    itemType: String!
    serviceComponents: [ServiceComponent!]!
  }

  type ServiceComponent { productId: ID!, productName: String!, quantity: Int!, stockUnit: String! }
  type SaleVariant { id: ID!, name: String!, sku: String!, barcode: String!, quantityInBaseUnits: Int!, sellingPrice: Float!, status: String!, availableQuantity: Int }
  type ProductUnit { id: ID!, labelCode: String!, name: String!, parentUnitId: ID, multiplier: Int!, quantityInBaseUnits: Int!, sellable: Boolean!, purchasable: Boolean!, sellingPrice: Float, unitRate: Float, estimatedCost: Float, marginAmount: Float, marginPercent: Float, belowCost: Boolean!, sku: String!, barcode: String!, status: String! }
  type ProductPriceAdjustmentLine { productUnitId: ID!, productUnitName: String!, previousPrice: Float!, newPrice: Float! }
  type ProductPriceAdjustment { id: ID!, effectiveAt: String!, reason: String!, lines: [ProductPriceAdjustmentLine!]!, createdBy: ID!, createdByName: String!, createdAt: String! }

  type ProductPage {
    items: [Product!]!
    totalCount: Int!
    nextCursor: String
  }
  type CatalogItemPage { items: [CatalogItem!]!, totalCount: Int!, nextCursor: String }

  type SaleItem {
    productId: ID!
    productName: String!
    sku: String!
    barcode: String!
    quantity: Int!
    variantId: ID!
    variantName: String!
    quantityInBaseUnits: Int!
    inventoryQuantity: Int!
    price: Float!
    priceBeforeOverride: Float
    priceOverrideReason: String
    regularPrice: Float
    promotionApplied: Boolean
    cost: Float!
    total: Float!
    vatClass: String
    vatRateBasisPoints: Int
    taxableAmount: Float
    vatAmount: Float
    consumedComponents: [ConsumedComponent!]!
  }
  type ConsumedComponent { productId: ID!, productName: String!, quantity: Int!, unitCost: Float!, totalCost: Float! }

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
    paymentEvidence: String
    paymentAmountKes: Float
    paymentRoundingAdjustment: Float
    mpesaPaymentId: ID
    payerPhoneLast4: String
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
    baseUnit: String!
    stockUnit: String!
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
    storeName: String!
    vatRegistered: Boolean!
    kraPin: String!
    vatEffectiveFrom: String
    withholdingVatAgent: Boolean!
    updatedAt: String!
  }

  type BusinessCheckoutSettings {
    enabledPaymentMethods: [String!]!
    defaultPaymentMethod: String!
    requireCustomerName: Boolean!
    allowStaffPriceOverrides: Boolean!
    maxStaffPriceDiscountPercent: Float!
    mpesaConfirmationMode: String!
    updatedAt: String!
  }

  type MpesaCallbackUrls { stk: String!, validation: String!, confirmation: String! }
  type MpesaConfiguration {
    id: ID!, scope: String!, storeId: ID, environment: String!, shortcode: String!, transactionType: String!, stkEnabled: Boolean!, c2bEnabled: Boolean!, enabled: Boolean!,
    credentialsSaved: Boolean!, passkeySaved: Boolean!, consumerKeyLast4: String!, connectionStatus: String!, connectionTestedAt: String, connectionMessage: String!,
    c2bRegistrationStatus: String!, c2bRegistrationAttemptedAt: String, c2bRegistrationMessage: String!, providerRequestId: String, providerResponseCode: String, callbackUrls: MpesaCallbackUrls!, createdAt: String!, updatedAt: String!
  }
  type EffectiveMpesaConfiguration { eligible: Boolean!, storeOverridesAllowed: Boolean!, configuration: MpesaConfiguration }
  type MpesaCheckoutIntent { id: ID!, storeId: ID!, saleTotal: Float!, amountKes: Float!, phoneLast4: String!, status: String!, checkoutRequestId: String, merchantRequestId: String, resultCode: String, resultDescription: String, paymentId: ID, saleId: ID, orderNumber: String, createdAt: String!, updatedAt: String! }
  type MpesaPayment { id: ID!, configurationId: ID!, scope: String!, storeId: ID, environment: String!, shortcode: String!, receiptNumber: String!, amountKes: Float!, transactionAt: String!, receivedAt: String!, phoneLast4: String, evidenceSources: [String!]!, status: String!, conflictReasons: [String!]!, saleId: ID, orderNumber: String, resolution: String, resolutionReason: String, resolvedAt: String, updatedAt: String! }

  type Business {
    id: ID!
    name: String!
  }

  type BillingPlan {
    code: String!
    name: String!
    monthlyPriceKes: Int!
    activeUserLimit: Int
    activeStoreLimit: Int
    vatAccounting: Boolean!
    multiStore: Boolean!
    capabilities: [String!]!
  }

  type BillingUsage { activeUsers: Int!, activeStores: Int! }
  type BillingPayment { id: ID!, tenantId: ID!, tenantName: String!, planCode: String!, billingInterval: String!, billingMonths: Int!, amountKes: Int!, baseAmountKes: Int, annualDiscountKes: Int!, promotionCreditKes: Int!, customPriceAdjustmentKes: Int!, creditAppliedKes: Int!, chargeId: ID, periodStartsOn: String, periodEndsOn: String, offerId: ID, offerPricePercent: Int, offerLabel: String, mpesaReference: String!, paidOn: String!, status: String!, submittedBy: String!, submittedAt: String!, reviewedBy: String, reviewedAt: String, rejectionReason: String }
  type BillingDocument { id: ID!, number: String!, tenantId: ID!, kind: String!, planCode: String!, planName: String!, billingInterval: String!, billingMonths: Int!, amountKes: Int!, baseAmountKes: Int!, annualDiscountKes: Int!, promotionCreditKes: Int!, customPriceAdjustmentKes: Int!, creditAppliedKes: Int!, cashAmountKes: Int!, chargeId: ID, promotionLabel: String, subtotalKes: Int, vatAmountKes: Int, issuedOn: String!, paymentId: ID!, externalEtimsReference: String, notice: String!, createdAt: String! }
  type BillingAudit { id: ID!, tenantId: ID!, action: String!, actorId: String!, reason: String!, before: String!, after: String!, createdAt: String! }
  type BillingCredit { id: ID!, tenantId: ID!, originalAmountKes: Int!, remainingAmountKes: Int!, status: String!, expiresOn: String, customerMessage: String!, issuedBy: String!, requestId: String!, issuedAt: String!, updatedAt: String! }
  type BillingCreditEvent { id: ID!, tenantId: ID!, creditId: ID!, type: String!, amountKes: Int!, actorId: String!, reason: String!, chargeId: ID, paymentId: ID, requestId: String, createdAt: String! }
  type BillingCharge { id: ID!, tenantId: ID!, tenantName: String!, status: String!, settlementKind: String, planCode: String!, planName: String!, billingInterval: String!, billingMonths: Int!, listAmountKes: Int!, customPriceAdjustmentKes: Int!, annualDiscountKes: Int!, promotionDiscountKes: Int!, creditAppliedKes: Int!, cashAmountKes: Int!, netRevenueKes: Int!, recognizedListAmountKes: Int, recognizedCustomPriceAdjustmentKes: Int, recognizedAnnualDiscountKes: Int, recognizedPromotionDiscountKes: Int, recognizedCreditImpactKes: Int, recognizedRevenueKes: Int, periodStartsOn: String!, periodEndsOn: String!, dueOn: String!, offerId: ID, promotionId: ID, promotionLabel: String, paymentId: ID, issuedAt: String!, settledAt: String }
  type BillingAccount {
    tenantId: ID!, tenantName: String!, ownerUserId: ID!, ownerUsername: String!, billingContactName: String!, billingContactEmail: String!, billingContactPhone: String!, planCode: String!, status: String!, statusLabel: String!, plan: BillingPlan!,
    trialStartedOn: String!, trialEndsOn: String!, paidThrough: String, graceEndsOn: String!, cancelledAt: String, pendingPlanCode: String, billingInterval: String!, pendingBillingInterval: String,
    termsVersion: String!, privacyVersion: String!, acceptedAt: String!, createdAt: String!, updatedAt: String!, customTerms: Boolean!, offer: BillingOffer, creditBalanceKes: Int!, creditReservedKes: Int!, workspaceState: String!, delinquentSince: String, archivedAt: String, deletionScheduledOn: String, suspendedAt: String, suspendedBy: String, suspensionReason: String
  }
  type BillingOffer { id: ID!, promotionId: ID, label: String!, pricePercent: Int!, durationMonths: Int!, remainingPayments: Int!, billingInterval: String!, planCode: String, startsOn: String!, reason: String!, assignedAt: String!, assignedBy: String! }
  type BillingPromotion { id: ID!, name: String!, description: String!, pricePercent: Int!, durationMonths: Int!, audience: String!, planCodes: [String!]!, billingIntervals: [String!]!, startsOn: String!, endsOn: String!, enabled: Boolean!, createdAt: String!, createdBy: String!, updatedAt: String!, updatedBy: String! }
  type NextBillingPayment { planCode: String!, planName: String!, billingInterval: String!, billingMonths: Int!, dueOn: String!, periodStartsOn: String!, periodEndsOn: String!, baseAmountKes: Int!, amountKes: Int!, savingsKes: Int!, annualDiscountKes: Int!, promotionCreditKes: Int!, customPriceAdjustmentKes: Int!, creditAvailableKes: Int!, creditToApplyKes: Int!, cashDueKes: Int!, offerId: ID, offerLabel: String, offerPricePercent: Int, offerRemainingPayments: Int!, paymentPending: Boolean! }
  type BillingConfiguration { enforcementEnabled: Boolean!, vendorLegalName: String!, vendorKraPin: String!, vendorVatRegistered: Boolean!, vendorVatRate: Float!, billingAddress: String!, supportEmail: String!, supportPhone: String!, tillNumber: String!, paymentInstructions: String! }
  type BillingOverview { account: BillingAccount!, nextPayment: NextBillingPayment!, usage: BillingUsage!, payments: [BillingPayment!]!, documents: [BillingDocument!]!, audits: [BillingAudit!]!, credits: [BillingCredit!]!, creditEvents: [BillingCreditEvent!]!, charges: [BillingCharge!]!, configuration: BillingConfiguration!, availablePromotions: [BillingPromotion!]! }
  type PlatformBusinessSummary { tenantId: ID!, tenantName: String!, planCode: String!, planName: String!, subscriptionStatus: String!, monthlyPriceKes: Int!, activeUsers: Int!, activeStores: Int!, pendingPayments: Int!, pendingPaymentAmountKes: Int!, trialEndsOn: String, paidThrough: String, billingContactEmail: String!, createdAt: String!, updatedAt: String! }
  type PlatformBusinessConnection { items: [PlatformBusinessSummary!]!, nextCursor: String }
  type PlatformMetrics { activeBusinesses: Int!, trialingBusinesses: Int!, expiringTrials: Int!, pastDueBusinesses: Int!, restrictedBusinesses: Int!, projectedMrrKes: Int!, trialPipelineKes: Int!, collectedThisMonthKes: Int!, collectedAllTimeKes: Int!, pendingPayments: Int!, pendingPaymentAmountKes: Int!, calculatedAt: String! }
  type PlatformRevenueSummary { listPriceRevenueKes: Int!, customPriceAdjustmentKes: Int!, annualDiscountKes: Int!, promotionDiscountKes: Int!, creditImpactKes: Int!, recognizedRevenueKes: Int!, cashCollectedKes: Int!, deferredRevenueKes: Int!, creditsIssuedKes: Int!, creditsAppliedKes: Int!, creditsExpiredOrVoidedKes: Int!, outstandingCreditKes: Int!, promotionRedemptions: Int! }
  type PlatformRevenueReport { from: String!, to: String!, summary: PlatformRevenueSummary!, rows: [BillingCharge!]!, calculatedAt: String! }
  type PlatformContact { name: String!, email: String!, phone: String!, address: String! }
  type PlatformAdminContact { id: ID!, name: String!, email: String!, status: String! }
  type PlatformStore { id: ID!, code: String!, name: String!, address: String!, status: String! }
  type PlatformBusinessMetadata { summary: PlatformBusinessSummary!, businessContact: PlatformContact!, admins: [PlatformAdminContact!]!, stores: [PlatformStore!]! }
  type PlatformBusinessDetail { metadata: PlatformBusinessMetadata!, billing: BillingOverview! }
  type PlatformPaymentConnection { items: [BillingPayment!]!, nextCursor: String }
  type PlatformAdminUser { id: ID!, username: String!, email: String!, name: String!, firstName: String!, lastName: String!, status: String!, emailVerified: Boolean!, createdAt: String!, updatedAt: String! }
  type SubscriptionAccess { status: String!, statusLabel: String!, workspaceState: String!, suspended: Boolean!, planCode: String!, planName: String!, trialEndsOn: String, paidThrough: String, graceEndsOn: String, archivedAt: String, deletionScheduledOn: String, staffAccessAllowed: Boolean! }

  type StandardMeasurementUnit { code: String!, dimension: String!, baseUnit: String!, baseUnits: Int! }
  type PackageUnitLabel { code: String!, name: String!, pluralName: String!, symbol: String!, status: String! }
  input PackageUnitLabelInput { code: String!, name: String!, pluralName: String!, symbol: String!, status: String = "active" }
  type BusinessMeasurementSettings { standardUnits: [StandardMeasurementUnit!]!, packageLabels: [PackageUnitLabel!]!, updatedAt: String! }

  type ReportProduct {
    productId: ID!
    productName: String!
    baseUnit: String!
    stockUnit: String!
    units: Float!
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
    variantId: ID
    quantity: Int!
    expectedCatalogPrice: Float
    unitPriceOverride: Float
    priceOverrideReason: String
  }
  input SaleVariantInput { id: ID, name: String!, sku: String = "", barcode: String = "", quantityInBaseUnits: Int!, sellingPrice: Float!, status: String = "active" }
  input ProductUnitInput { id: ID, labelCode: String!, name: String!, parentUnitId: ID, multiplier: Int!, quantityInBaseUnits: Int, sellable: Boolean!, purchasable: Boolean!, sellingPrice: Float, sku: String = "", barcode: String = "", status: String = "active" }
  input ProductPriceAdjustmentLineInput { productUnitId: ID!, newPrice: Float! }
  input ServiceComponentInput { productId: ID!, quantity: Int! }
  input OpeningStockLineInput { productId: ID!, quantity: Int!, unitCost: Float, batchNumber: String, expiryDate: String }
  type OpeningStockLine { lotId: ID!, productId: ID!, productName: String!, quantity: Int!, unitCost: Float!, batchNumber: String!, expiryDate: String }
  type OpeningStock { id: ID!, openingStockNumber: String!, storeId: ID!, storeName: String!, effectiveDate: String!, notes: String!, lines: [OpeningStockLine!]!, createdBy: ID!, createdByName: String!, createdAt: String! }
  input CatalogImportRowInput { rowNumber: Int!, itemType: String!, name: String!, categoryPath: String!, sku: String = "", barcode: String = "", sellingPrice: Float!, vatClass: String, description: String = "", stockUnit: String, buyingPrice: Float, tracksExpiry: Boolean, openingQuantity: Float, openingUnitCost: Float, batchNumber: String, expiryDate: String }
  type CatalogImportRowResult { rowNumber: Int!, itemType: String!, name: String!, categoryPath: String!, valid: Boolean!, status: String!, itemId: ID, errors: [String!]! }
  type CatalogImportPreview { rows: [CatalogImportRowResult!]!, categoriesToCreate: [String!]!, importableRows: Int!, hasOpeningStock: Boolean! }
  type CatalogImportResult { requestId: ID!, importedCount: Int!, failedCount: Int!, categoriesCreated: [String!]!, rows: [CatalogImportRowResult!]! }

  type Store {
    id: ID!
    code: String!
    name: String!
    address: String!
    receiptBusinessName: String!
    receiptAddress: String!
    receiptPhone: String!
    receiptEmail: String!
    receiptFooter: String!
    receiptReturnPolicy: String!
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
    vatRegistered: Boolean
    defaultPaymentTermsDays: Int
    status: String!
    createdAt: String!
    updatedAt: String!
  }

  type SupplierProduct {
    supplierId: ID!
    productId: ID!
    productUnitId: ID
    supplierSku: String!
    purchaseUnit: String!
    purchaseQuantity: Float!
    purchaseMeasurementUnit: String!
    unitsPerPurchaseUnit: Int!
    lastPurchasePrice: Float
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
    baseUnit: String!
    stockUnit: String!
    supplierSku: String!
    productUnitId: ID
    purchaseUnit: String!
    purchaseQuantity: Float!
    purchaseMeasurementUnit: String!
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
    emailStatus: String
    emailRecipient: String
    emailMessageId: String
    emailAttemptedAt: String
    emailError: String
    receiptCount: Int!
    createdAt: String!
    updatedAt: String!
  }

  type Notification {
    id: ID!
    type: String!
    title: String!
    message: String!
    actionPath: String!
    readAt: String
    createdAt: String!
  }

  type GoodsReceiptLine {
    purchaseOrderLineId: ID!
    productId: ID!
    productName: String!
    baseUnit: String!
    stockUnit: String!
    purchaseUnit: String!
    purchaseQuantity: Float!
    purchaseMeasurementUnit: String!
    unitsPerPurchaseUnit: Int!
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
    grossUnitCost: Float
    vatClass: String
    vatRateBasisPoints: Int
    taxableAmount: Float
    vatAmount: Float
    grossAmount: Float
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
    accountingTracked: Boolean
    supplierInvoiceId: ID
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
  type StockTransferLine { productId: ID!, productName: String!, baseUnit: String!, stockUnit: String!, quantity: Int!, allocations: [TransferAllocation!] }
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
  type StockRequisitionLine { productId: ID!, productName: String!, baseUnit: String!, stockUnit: String!, quantity: Int! }
  type StockRequisition { id: ID!, requisitionNumber: String!, fromStoreId: ID!, fromStoreName: String!, toStoreId: ID!, toStoreName: String!, status: String!, notes: String!, decisionReason: String, lines: [StockRequisitionLine!]!, requestedBy: ID!, requestedByName: String!, decidedBy: ID, decidedByName: String, transferId: ID, createdAt: String!, updatedAt: String! }

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

  type SupplierPayment {
    id: ID!
    invoiceId: ID!
    supplierId: ID!
    amount: Float!
    supplierPaidAmount: Float!
    withholdingVatAmount: Float!
    method: String!
    reference: String!
    paidAt: String!
    status: String!
    voidReason: String
    voidedAt: String
    voidedBy: String
    actorName: String!
    createdAt: String!
  }

  type SupplierInvoice {
    id: ID!
    invoiceNumber: String!
    receiptId: ID!
    receiptNumber: String!
    purchaseOrderId: ID!
    orderNumber: String!
    supplierId: ID!
    supplierName: String!
    storeId: ID!
    storeName: String!
    invoiceDate: String!
    dueDate: String!
    paymentTermsDays: Int!
    grossAmount: Float!
    taxableAmount: Float!
    withholdingTaxableAmount: Float!
    vatAmount: Float!
    paidAmount: Float!
    balance: Float!
    status: String!
    payments: [SupplierPayment!]!
    createdByName: String!
    createdAt: String!
    updatedAt: String!
  }

  type AccountingSummary {
    from: String!
    to: String!
    vatRegistered: Boolean!
    grossSales: Float!
    netRevenue: Float!
    outputVat: Float!
    costOfGoodsSold: Float!
    grossMargin: Float!
    stockLoss: Float!
    tradingResult: Float!
    supplierPayments: Float!
    supplierCashPaid: Float!
    withholdingVat: Float!
    estimatedInputVat: Float!
    estimatedVatPosition: Float!
    inventoryCostValue: Float!
    inventoryRetailValue: Float!
    potentialMargin: Float!
    outstandingPayables: Float!
    overduePayables: Float!
    invoiceCount: Int!
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
    catalogItems(storeId: ID): [CatalogItem!]!
    catalogItemPage(search: String = "", limit: Int = 20, cursor: String, activeOnly: Boolean = false, storeId: ID): CatalogItemPage!
    products(storeId: ID): [Product!]!
    productPage(search: String = "", limit: Int = 20, cursor: String, activeOnly: Boolean = false, storeId: ID): ProductPage!
    product(id: ID!): Product
    productLookup(term: String!, storeId: ID): Product
    sales(limit: Int = 50, personal: Boolean = false, from: String, to: String, storeId: ID): [Sale!]!
    sale(id: ID!, personal: Boolean = false): Sale
    stockAudits(limit: Int = 100): [AuditEvent!]!
    dashboard(days: Int = 1, personal: Boolean = false, compact: Boolean = false): DashboardSummary!
    businessSettings: BusinessSettings!
    businessCheckoutSettings: BusinessCheckoutSettings!
    businessMeasurementSettings: BusinessMeasurementSettings!
    business: Business!
    businessReport(from: String!, to: String!, storeId: ID): BusinessReport!
    stores(activeOnly: Boolean = false): [Store!]!
    requisitionStores: [Store!]!
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
    stockRequisitions: [StockRequisition!]!
    stockRequisition(id: ID!): StockRequisition
    stocktakes(storeId: ID): [StocktakeSession!]!
    stocktake(id: ID!): StocktakeSession
    myOpenCashShift(storeId: ID): CashShift
    cashShifts(limit: Int = 100, from: String, to: String, storeId: ID): [CashShift!]!
    replenishmentSuggestions(storeId: ID!, supplierId: ID!): [ReplenishmentSuggestion!]!
    supplyChainReport(from: String!, to: String!, storeId: ID, supplierId: ID, productId: ID, status: String, expiryDays: Int = 30): SupplyChainReport!
    notifications(limit: Int = 20): [Notification!]!
    supplierInvoices(from: String, to: String, storeId: ID, supplierId: ID, status: String): [SupplierInvoice!]!
    unbilledGoodsReceipts: [GoodsReceipt!]!
    accountingSummary(from: String!, to: String!, storeId: ID, supplierId: ID): AccountingSummary!
    billingOverview: BillingOverview!
    platformBusinesses(first: Int = 25, after: String, search: String, planCode: String, status: String): PlatformBusinessConnection!
    platformMetrics: PlatformMetrics!
    platformRevenueReport(from: String!, to: String!, tenantId: ID, promotionId: ID): PlatformRevenueReport!
    platformPayments(first: Int = 25, after: String, status: String = "submitted", from: String, to: String, tenantId: ID, reference: String): PlatformPaymentConnection!
    platformBusiness(tenantId: ID!): PlatformBusinessDetail!
    platformAdmins: [PlatformAdminUser!]!
    platformBillingPromotions: [BillingPromotion!]!
    platformBillingConfiguration: BillingConfiguration!
    platformBillingAccount(tenantId: ID!): BillingOverview!
    subscriptionAccess: SubscriptionAccess!
    mpesaConfiguration(scope: String!, storeId: ID): MpesaConfiguration
    effectiveMpesaConfiguration(storeId: ID!): EffectiveMpesaConfiguration!
    mpesaCheckoutIntent(id: ID!): MpesaCheckoutIntent
    recentUnassignedMpesaPayments(storeId: ID!, amountKes: Float): [MpesaPayment!]!
    mpesaPayments(limit: Int = 100): [MpesaPayment!]!
  }

  type Mutation {
    createBusiness(name: String!, planCode: String!, billingInterval: String = "monthly", promotionId: ID, termsVersion: String!, privacyVersion: String!, vatRegistered: Boolean = false, kraPin: String = "", vatEffectiveFrom: String, withholdingVatAgent: Boolean = false): User!
    inviteUser(email: String!, firstName: String!, lastName: String!, roles: [String!]!, employeeCode: String = "", jobTitle: String = "", storeId: ID!, storeIds: [ID!] = [], phone: String = ""): User!
    resendUserInvitation(username: String!): User!
    updateUserRoles(username: String!, roles: [String!]!): User!
    setUserEnabled(username: String!, enabled: Boolean!): User!
    updateStaffEmail(username: String!, email: String!): User!
    deleteStaffUser(username: String!): Boolean!
    updateMyProfile(phone: String!): StaffProfile!
    updateStaffProfile(userId: ID!, employeeCode: String!, jobTitle: String!, storeId: ID!, storeIds: [ID!] = [], phone: String!): StaffProfile!
    updateBusinessSettings(businessName: String!, address: String!, phone: String = "", email: String = "", thankYouMessage: String!, returnPolicy: String!, vatRegistered: Boolean, kraPin: String, vatEffectiveFrom: String, withholdingVatAgent: Boolean): BusinessSettings!
    updateBusinessDetails(businessName: String!, address: String!, phone: String = "", email: String = "", vatRegistered: Boolean!, kraPin: String = "", vatEffectiveFrom: String, withholdingVatAgent: Boolean = false): BusinessSettings!
    updateBusinessReceiptSettings(thankYouMessage: String!, returnPolicy: String!): BusinessSettings!
    updateBusinessCheckoutSettings(enabledPaymentMethods: [String!]!, defaultPaymentMethod: String!, requireCustomerName: Boolean!, allowStaffPriceOverrides: Boolean!, maxStaffPriceDiscountPercent: Float!, mpesaConfirmationMode: String = "manual_or_verified"): BusinessCheckoutSettings!
    updateBusinessMeasurementSettings(packageLabels: [PackageUnitLabelInput!]!): BusinessMeasurementSettings!

    createCategory(code: String = "", name: String!, description: String = "", parentId: ID): Category!
    updateCategory(id: ID!, code: String!, name: String!, description: String = "", parentId: ID): Category!
    deleteCategory(id: ID!): Boolean!
    createProduct(name: String!, description: String = "", sku: String = "", barcode: String = "", categoryId: ID!, sellingPrice: Float!, buyingPrice: Float!, vatClass: String, stockUnit: String!, tracksExpiry: Boolean!, saleVariants: [SaleVariantInput!]!, productUnits: [ProductUnitInput!], acknowledgeBelowCost: Boolean = false, requestId: ID): Product!
    createService(name: String!, description: String = "", sku: String = "", barcode: String = "", categoryId: ID!, sellingPrice: Float!, vatClass: String, serviceComponents: [ServiceComponentInput!] = []): Product!
    updateService(id: ID!, name: String!, description: String = "", sku: String = "", barcode: String = "", categoryId: ID!, sellingPrice: Float!, vatClass: String, serviceComponents: [ServiceComponentInput!] = [], status: String!): Product!
    updateProduct(id: ID!, name: String, description: String, sku: String, barcode: String, categoryId: ID, sellingPrice: Float, buyingPrice: Float, vatClass: String, stockUnit: String, tracksExpiry: Boolean, saleVariants: [SaleVariantInput!], productUnits: [ProductUnitInput!], acknowledgeBelowCost: Boolean = false, promotionPrice: Float, promotionStartsAt: String, promotionEndsAt: String, status: String): Product!
    adjustProductPrices(productId: ID!, lines: [ProductPriceAdjustmentLineInput!]!, effectiveAt: String!, reason: String!, requestId: ID!): Product!
    cancelProductPriceAdjustment(productId: ID!, reason: String!, requestId: ID!): Product!
    archiveProduct(id: ID!): Product!
    recordOpeningStock(storeId: ID!, effectiveDate: String, notes: String = "", lines: [OpeningStockLineInput!]!, requestId: ID!): OpeningStock!
    validateCatalogImport(rows: [CatalogImportRowInput!]!, storeId: ID, effectiveDate: String): CatalogImportPreview!
    executeCatalogImport(rows: [CatalogImportRowInput!]!, storeId: ID, effectiveDate: String, requestId: ID!): CatalogImportResult!
    completeSale(storeId: ID, customerName: String, paymentMethod: String!, amountTendered: Float, mpesaReference: String, items: [SaleItemInput!]!, requestId: ID!): Sale!
    saveMpesaConfiguration(scope: String!, storeId: ID, environment: String!, shortcode: String!, transactionType: String!, stkEnabled: Boolean!, c2bEnabled: Boolean!, consumerKey: String!, consumerSecret: String!, passkey: String): MpesaConfiguration!
    testMpesaConfiguration(scope: String!, storeId: ID): MpesaConfiguration!
    registerMpesaCallbacks(scope: String!, storeId: ID): MpesaConfiguration!
    disableMpesaConfiguration(scope: String!, storeId: ID): MpesaConfiguration!
    regenerateMpesaCallbackToken(scope: String!, storeId: ID): MpesaConfiguration!
    initiateMpesaStk(storeId: ID!, phone: String!, customerName: String, items: [SaleItemInput!]!, requestId: ID!): MpesaCheckoutIntent!
    refreshMpesaStkStatus(intentId: ID!): MpesaCheckoutIntent!
    attachMpesaPayment(storeId: ID!, receiptNumber: String!, customerName: String, items: [SaleItemInput!]!, requestId: ID!): Sale!
    resolveMpesaPayment(receiptNumber: String!, resolution: String!, reason: String!): MpesaPayment!
    createStore(code: String = "", name: String!, address: String = "", receiptBusinessName: String = "", receiptAddress: String = "", receiptPhone: String = "", receiptEmail: String = "", receiptFooter: String = "", receiptReturnPolicy: String = ""): Store!
    updateStore(id: ID!, name: String, address: String, receiptBusinessName: String, receiptAddress: String, receiptPhone: String, receiptEmail: String, receiptFooter: String, receiptReturnPolicy: String, status: String): Store!
    createSupplier(code: String = "", name: String!, contactName: String = "", phone: String = "", email: String = "", address: String = "", vatRegistered: Boolean = false, defaultPaymentTermsDays: Int = 0): Supplier!
    updateSupplier(id: ID!, name: String, contactName: String, phone: String, email: String, address: String, vatRegistered: Boolean, defaultPaymentTermsDays: Int, status: String): Supplier!
    upsertSupplierProduct(supplierId: ID!, productId: ID!, productUnitId: ID, supplierSku: String = "", purchaseUnit: String = "", purchaseQuantity: Float = 1, purchaseMeasurementUnit: String = "each", lastPurchasePrice: Float, preferred: Boolean!): SupplierProduct!
    removeSupplierProduct(supplierId: ID!, productId: ID!): Boolean!
    upsertStorePolicy(storeId: ID!, productId: ID!, reorderPoint: Int!, targetQuantity: Int!): StoreProductPolicy!
    createPurchaseOrder(supplierId: ID!, storeId: ID!, expectedDeliveryDate: String, notes: String = "", lines: [PurchaseOrderLineInput!]!, requestId: ID!): PurchaseOrder!
    updatePurchaseOrder(id: ID!, supplierId: ID!, storeId: ID!, expectedDeliveryDate: String, notes: String = "", lines: [PurchaseOrderLineInput!]!): PurchaseOrder!
    issuePurchaseOrder(id: ID!, sendEmail: Boolean = false): PurchaseOrder!
    sendPurchaseOrderEmail(id: ID!): PurchaseOrder!
    closePurchaseOrder(id: ID!, reason: String!): PurchaseOrder!
    cancelPurchaseOrder(id: ID!, reason: String = "Cancelled"): PurchaseOrder!
    receivePurchaseOrder(purchaseOrderId: ID!, deliveryNote: String = "", invoiceNumber: String = "", invoiceDate: String, paymentTermsDays: Int, lines: [GoodsReceiptLineInput!]!, requestId: ID!): GoodsReceipt!
    writeOffLot(lotId: ID!, quantity: Int!, type: String!, reason: String!, requestId: ID!): StockMovement!
    countInventoryLot(lotId: ID!, physicalQuantity: Int!, reason: String!, requestId: ID!): StockMovement!
    createStockTransfer(fromStoreId: ID!, toStoreId: ID!, notes: String = "", lines: [StockTransferLineInput!]!, requestId: ID!): StockTransfer!
    dispatchStockTransfer(id: ID!, requestId: ID!): StockTransfer!
    receiveStockTransfer(id: ID!, lines: [TransferReceiptLineInput!]!, requestId: ID!): StockTransfer!
    cancelStockTransfer(id: ID!, reason: String!): StockTransfer!
    createStockRequisition(fromStoreId: ID!, toStoreId: ID, notes: String = "", lines: [StockTransferLineInput!]!, requestId: ID!): StockRequisition!
    decideStockRequisition(id: ID!, decision: String!, reason: String = ""): StockRequisition!
    convertStockRequisition(id: ID!, requestId: ID!): StockTransfer!
    createStocktake(storeId: ID!, name: String!, productId: ID, requestId: ID!): StocktakeSession!
    completeStocktake(id: ID!, counts: [StocktakeCountInput!]!, reason: String!, requestId: ID!): StocktakeSession!
    cancelStocktake(id: ID!, reason: String!): StocktakeSession!
    openCashShift(storeId: ID, openingFloat: Float!, requestId: ID!): CashShift!
    recordCashMovement(shiftId: ID!, type: String!, amount: Float!, reason: String!, requestId: ID!): CashMovement!
    closeCashShift(id: ID!, countedCash: Float!, requestId: ID!): CashShift!
    markNotificationRead(id: ID!): Notification!
    markAllNotificationsRead: Boolean!
    createSupplierInvoice(receiptId: ID!, invoiceNumber: String!, invoiceDate: String, paymentTermsDays: Int, requestId: ID!): SupplierInvoice!
    recordSupplierPayment(invoiceId: ID!, amount: Float!, method: String!, reference: String = "", paidAt: String!, requestId: ID!): SupplierInvoice!
    voidSupplierPayment(invoiceId: ID!, paymentId: ID!, reason: String!, requestId: ID!): SupplierInvoice!
    submitBillingPayment(planCode: String, amountKes: Int, mpesaReference: String!, paidOn: String!): BillingPayment!
    scheduleBillingPlan(planCode: String!): BillingAccount!
    scheduleBillingInterval(billingInterval: String!): BillingAccount!
    cancelBillingSubscription: BillingAccount!
    confirmBillingPayment(tenantId: ID!, paymentId: ID!): BillingPayment!
    rejectBillingPayment(tenantId: ID!, paymentId: ID!, reason: String!): BillingPayment!
    assignPlatformBillingPlan(tenantId: ID!, planCode: String!, reason: String!): BillingAccount!
    updateBillingOverride(tenantId: ID!, monthlyPriceKes: Int, activeUserLimit: Int, unlimitedUsers: Boolean = false, activeStoreLimit: Int, unlimitedStores: Boolean = false, vatAccounting: Boolean, multiStore: Boolean, exempt: Boolean = false, expiresOn: String, reason: String!): BillingAccount!
    setBillingOffer(tenantId: ID!, label: String!, pricePercent: Int!, durationMonths: Int!, startsOn: String!, reason: String!): BillingAccount!
    clearBillingOffer(tenantId: ID!): BillingAccount!
    saveBillingPromotion(id: ID, name: String!, description: String!, pricePercent: Int!, durationMonths: Int!, audience: String!, planCodes: [String!]!, billingIntervals: [String!]!, startsOn: String!, endsOn: String!, enabled: Boolean!): BillingPromotion!
    setBillingPromotionEnabled(id: ID!, enabled: Boolean!): BillingPromotion!
    claimBillingPromotion(promotionId: ID!): BillingAccount!
    attachBillingEtimsReference(tenantId: ID!, documentId: ID!, reference: String!): BillingDocument!
    updateBillingContact(tenantId: ID, name: String!, email: String!, phone: String = ""): BillingAccount!
    issueBillingCredit(tenantId: ID!, amountKes: Int!, expiresOn: String, reason: String!, customerMessage: String = "", requestId: ID!): BillingCredit!
    voidBillingCredit(tenantId: ID!, creditId: ID!, reason: String!): BillingCredit!
    setPlatformBusinessSuspended(tenantId: ID!, suspended: Boolean!, reason: String!): BillingAccount!
    invitePlatformAdmin(email: String!, firstName: String!, lastName: String!): PlatformAdminUser!
    resendPlatformAdminInvitation(username: String!): PlatformAdminUser!
    setPlatformAdminEnabled(username: String!, enabled: Boolean!): PlatformAdminUser!
  }
`;
