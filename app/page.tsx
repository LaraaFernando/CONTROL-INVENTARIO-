import AdvancedReceivingExperience from "./advanced-receiving-experience";
import BlockOneExperience from "./block-one-experience";
import BlockOneNavigationFix from "./block-one-navigation-fix";
import BlockTwoExperience from "./block-two-experience";
import CommercialMovementExperience from "./commercial-movement-experience";
import InventoryApp from "./inventory-app";
import InventoryQuickSearchExperience from "./inventory-quick-search-experience";
import ProductCommercialExperience from "./product-commercial-experience";
import PurchaseOrderCommercialExperience from "./purchase-order-commercial-experience";
import SalesExperience from "./sales-experience";

export const dynamic = "force-dynamic";

export default function Home() {
  return <><InventoryApp /><SalesExperience /><BlockOneExperience /><BlockOneNavigationFix /><BlockTwoExperience /><AdvancedReceivingExperience /><ProductCommercialExperience /><CommercialMovementExperience /><PurchaseOrderCommercialExperience /><InventoryQuickSearchExperience /></>;
}
