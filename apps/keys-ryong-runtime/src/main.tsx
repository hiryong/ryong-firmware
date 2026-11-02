import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./ryong/ryong.css";
import { setupAppLinks } from "./ryong/app";
import { setupLang } from "./ryong/i18n";
import { ErrorScreen } from "./ryong/ErrorScreen";

setupAppLinks();
setupLang();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorScreen>
      <App />
    </ErrorScreen>
  </React.StrictMode>
);
