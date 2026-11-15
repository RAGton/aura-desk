import React from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";

import "./styles/globals.css";
import i18n from "./lib/i18n";
import { applyVisualPrefs, loadVisualPrefs, registerSystemThemeListener } from "./lib/theme";
import { AppRouter } from "./app/router";

applyVisualPrefs(loadVisualPrefs());
registerSystemThemeListener();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <AppRouter />
    </I18nextProvider>
  </React.StrictMode>
);
