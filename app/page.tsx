import BlockOneExperience from "./block-one-experience";
import BlockOneNavigationFix from "./block-one-navigation-fix";
import InventoryApp from "./inventory-app";
import SalesExperience from "./sales-experience";

export const dynamic = "force-dynamic";

export default function Home() {
  return <><InventoryApp /><SalesExperience /><BlockOneExperience /><BlockOneNavigationFix /></>;
}
