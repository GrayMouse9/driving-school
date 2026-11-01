import "./ui/style.css";
import { mountUI } from "./ui/layout";
import { initAuth } from "./auth/auth";
import { startApplication } from "./app/application";

if (location.pathname === '/admin/' || location.pathname === '/admin') {
  void import('./admin/admin').then(({ startAdmin }) => startAdmin());
} else {
  mountUI();
  initAuth();
  startApplication();
}
