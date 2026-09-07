// SPDX-License-Identifier: AGPL-3.0-or-later
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// The two faces the design system is set in, bundled from npm so the site
// depends on no third-party font host: Fraunces (the serif display face the
// wordmark and headlines use) and JetBrains Mono (every number on the site).
// Each @font-face is subset-ranged, so a browser downloads only the Latin cut.
import "@fontsource-variable/fraunces/wght.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "./styles.css";
import { App } from "./App";
import { RouterProvider } from "./lib/router";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider>
      <App />
    </RouterProvider>
  </StrictMode>
);
