import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { NotificationCenterProvider } from "./notifications/notificationCenter";
import "./styles/base.scss";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <NotificationCenterProvider>
      <App />
    </NotificationCenterProvider>
  </React.StrictMode>,
);
