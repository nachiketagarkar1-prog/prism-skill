import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { StoreProvider } from "./state/store";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </React.StrictMode>,
);

// Dev hook: lets tests speed up the simulated build stages (window.__prismMock.speed = 0.1).
if (import.meta.env.DEV) {
  import("./api/mockApi").then(({ mockApi }) => ((window as unknown as { __prismMock: unknown }).__prismMock = mockApi));
}
