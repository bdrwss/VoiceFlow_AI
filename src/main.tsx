import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

import { ModalProvider } from "./components/ModalContext";

import { initSettingsStore } from "./utils/store";
import "./i18n";

initSettingsStore().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ModalProvider>
        <App />
      </ModalProvider>
    </React.StrictMode>,
  );
});
