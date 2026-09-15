"use client";

import { useEffect } from "react";

const BASE_PATH = "/jackson-running";

export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const register = async () => {
      try {
        await navigator.serviceWorker.register(`${BASE_PATH}/sw.js`, {
          scope: `${BASE_PATH}/`,
        });
      } catch (error) {
        console.warn("PWA service worker registration failed:", error);
      }
    };

    if (document.readyState === "complete") {
      void register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
