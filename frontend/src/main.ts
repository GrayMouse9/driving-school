import "./ui/style.css";
import { mountUI } from "./ui/layout";
import { initAuth } from "./auth/auth";
import { startApplication } from "./app/application";

mountUI();
initAuth();
startApplication();
