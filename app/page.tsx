import AdvancedReceivingExperience from "./advanced-receiving-experience";
import BlockOneExperience from "./block-one-experience";
import BlockOneNavigationFix from "./block-one-navigation-fix";
import BlockTwoExperience from "./block-two-experience";
import BusinessInsightsExperience from "./business-insights-experience";
import CommercialMovementExperience from "./commercial-movement-experience";
import InventoryApp from "./inventory-app";
import InventoryQuickSearchExperience from "./inventory-quick-search-experience";
import ProductCommercialExperience from "./product-commercial-experience";
import ProductSuppliersExperience from "./product-suppliers-experience";
import PurchaseOrderCommercialExperience from "./purchase-order-commercial-experience";
import ReplenishmentExperience from "./replenishment-experience";
import SaleCancellationExperience from "./sale-cancellation-experience";
import SalesExperience from "./sales-experience";
import TransactionSafetyExperience from "./transaction-safety-experience";
import VisualCodeReaderExperience from "./visual-code-reader-experience";

export const dynamic = "force-dynamic";

export default function Home() {
  return <><InventoryApp /><SalesExperience /><BlockOneExperience /><BlockOneNavigationFix /><BlockTwoExperience /><AdvancedReceivingExperience /><ProductCommercialExperience /><CommercialMovementExperience /><PurchaseOrderCommercialExperience /><InventoryQuickSearchExperience /><VisualCodeReaderExperience /><ReplenishmentExperience /><BusinessInsightsExperience /><TransactionSafetyExperience /><SaleCancellationExperience /><ProductSuppliersExperience /></>;
}
