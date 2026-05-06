import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { IridescentBackground } from "@/components/theme/IridescentBackground";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <>
    <IridescentBackground />
    <App />
  </>
);

