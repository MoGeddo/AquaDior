import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

interface CapacitorWindow extends Window {
  Capacitor?: {
    getPlatform?: () => string;
  };
}

const userAgent = navigator.userAgent;
const capacitorPlatform = (window as CapacitorWindow).Capacitor?.getPlatform?.();
const isAndroidWebView = /Android/i.test(userAgent) && /;\s*wv\)/i.test(userAgent);

if (capacitorPlatform === "android" || isAndroidWebView) {
  document.documentElement.classList.add("capacitor-android");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
