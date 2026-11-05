import React from "react";
import ReactDOM from "react-dom";
import "./index.css";
import "./theme/brand-theme.css";
import { applyTheme, getStoredTheme } from "./theme/useTheme";
import { ToasterProvider } from "./ui/toast/Toaster";
import OrdersPage from "./Forms/Orders/OrdersPage";

// The API address comes from public/config.js (window.__APP_CONFIG__), so a client install only edits that file.
applyTheme(getStoredTheme());

ReactDOM.render(
    <ToasterProvider>
        <OrdersPage />
    </ToasterProvider>,
    document.getElementById("root")
);
