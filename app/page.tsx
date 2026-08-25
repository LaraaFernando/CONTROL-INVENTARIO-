import AdvancedReceivingExperience from "./advanced-receiving-experience";
import BlockOneExperience from "./block-one-experience";
import BlockOneNavigationFix from "./block-one-navigation-fix";
import BlockTwoExperience from "./block-two-experience";
import BusinessInsightsExperience from "./business-insights-experience";
import CommercialMovementExperience from "./commercial-movement-experience";
import FieldOrderExperience from "./field-order-experience";
import FieldOrderWarehouseExperience from "./field-order-warehouse-experience";
import InventoryApp from "./inventory-app";
import InventoryQuickSearchExperience from "./inventory-quick-search-experience";
import InventoryReservationExperience from "./inventory-reservation-experience";
import LiveInventorySync from "./live-inventory-sync";
import ProductCommercialExperience from "./product-commercial-experience";
import ProductSuppliersExperience from "./product-suppliers-experience";
import PurchaseOrderCommercialExperience from "./purchase-order-commercial-experience";
import ReplenishmentExperience from "./replenishment-experience";
import SaleCancellationExperience from "./sale-cancellation-experience";
import SaleDeliveryExperience from "./sale-delivery-experience";
import SalesExperience from "./sales-experience";
import SalesUnitPolicy from "./sales-unit-policy";
import SimpleNavigationRepair from "./simple-navigation-repair";
import TransactionSafetyExperience from "./transaction-safety-experience";
import VisualCodeReaderExperience from "./visual-code-reader-experience";

export const dynamic = "force-dynamic";

export default function Home() {
  return <><InventoryApp /><LiveInventorySync /><SalesUnitPolicy /><SalesExperience /><BlockOneExperience /><SimpleNavigationRepair /><BlockOneNavigationFix /><BlockTwoExperience /><AdvancedReceivingExperience /><ProductCommercialExperience /><CommercialMovementExperience /><PurchaseOrderCommercialExperience /><InventoryQuickSearchExperience /><InventoryReservationExperience /><VisualCodeReaderExperience /><ReplenishmentExperience /><BusinessInsightsExperience /><TransactionSafetyExperience /><SaleCancellationExperience /><ProductSuppliersExperience /><SaleDeliveryExperience /><FieldOrderExperience /><FieldOrderWarehouseExperience /></>;
}