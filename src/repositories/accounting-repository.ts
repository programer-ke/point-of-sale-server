import { businessReport, getBusinessSettings, listSales } from "./pos-repository";
import { listMovements, listSupplierInvoices, type SupplierInvoiceStatus } from "./supply-chain-repository";

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export const accountingSummary = async (tenantId: string, input: { from: string; to: string; storeId?: string; supplierId?: string }) => {
  const fromTime = Date.parse(input.from); const toTime = Date.parse(input.to);
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) || fromTime > toTime) throw new Error("Enter a valid accounting date range");
  if (toTime - fromTime > 366 * 24 * 60 * 60 * 1000) throw new Error("Accounting periods cannot exceed 366 days");
  const invoiceRange = { from: input.from.slice(0, 10), to: input.to.slice(0, 10) };
  const [sales, movements, periodInvoices, allInvoices, stock, settings] = await Promise.all([
    listSales(tenantId, 1000, { from: input.from, to: input.to }),
    listMovements(tenantId, { from: input.from, to: input.to }),
    listSupplierInvoices(tenantId, { ...invoiceRange, storeId: input.storeId, supplierId: input.supplierId }),
    listSupplierInvoices(tenantId, { storeId: input.storeId, supplierId: input.supplierId }),
    businessReport(tenantId, { from: input.from, to: input.to, storeId: input.storeId }),
    getBusinessSettings(tenantId),
  ]);
  const filteredSales = input.storeId ? sales.filter((sale) => sale.storeId === input.storeId) : sales;
  const filteredMovements = input.storeId ? movements.filter((movement) => movement.storeId === input.storeId) : movements;
  const grossSales = roundMoney(filteredSales.reduce((sum, sale) => sum + sale.totalAmount, 0));
  const outputVat = roundMoney(filteredSales.reduce((sum, sale) => sum + sale.tax, 0));
  const netRevenue = roundMoney(grossSales - outputVat);
  const costOfGoodsSold = roundMoney(filteredSales.flatMap((sale) => sale.items).reduce((sum, item) => sum + item.cost * item.quantity, 0));
  const lossTypes = new Set(["damage", "expiry", "transfer_damage", "transfer_shortage"]);
  const stockLoss = roundMoney(filteredMovements.filter((movement) => lossTypes.has(movement.type) || (movement.type === "count_correction" && movement.quantity < 0)).reduce((sum, movement) => sum + Math.abs(movement.quantity) * movement.unitCost, 0));
  const grossMargin = roundMoney(netRevenue - costOfGoodsSold);
  const tradingResult = roundMoney(grossMargin - stockLoss);
  const payments = allInvoices.flatMap((invoice) => invoice.payments).filter((payment) => payment.status === "active" && payment.paidAt >= invoiceRange.from && payment.paidAt <= invoiceRange.to);
  const supplierPayments = roundMoney(payments.reduce((sum, payment) => sum + payment.amount, 0));
  const supplierCashPaid = roundMoney(payments.reduce((sum, payment) => sum + payment.supplierPaidAmount, 0));
  const withholdingVat = roundMoney(payments.reduce((sum, payment) => sum + payment.withholdingVatAmount, 0));
  const estimatedInputVat = roundMoney(periodInvoices.reduce((sum, invoice) => sum + invoice.vatAmount, 0));
  const outstandingPayables = roundMoney(allInvoices.reduce((sum, invoice) => sum + invoice.balance, 0));
  const overduePayables = roundMoney(allInvoices.filter((invoice) => invoice.status === "overdue").reduce((sum, invoice) => sum + invoice.balance, 0));
  return {
    from: input.from, to: input.to, vatRegistered: settings.vatRegistered, grossSales, netRevenue, outputVat, costOfGoodsSold, grossMargin, stockLoss, tradingResult,
    supplierPayments, supplierCashPaid, withholdingVat, estimatedInputVat, estimatedVatPosition: roundMoney(outputVat - estimatedInputVat),
    inventoryCostValue: stock.stockCostValue, inventoryRetailValue: stock.stockRetailValue, potentialMargin: stock.potentialMargin,
    outstandingPayables, overduePayables, invoiceCount: periodInvoices.length,
  };
};

export type { SupplierInvoiceStatus };
