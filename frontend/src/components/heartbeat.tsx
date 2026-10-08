"use client";
import { useEffect } from "react";

/**
 * Tells the local engine that a window is still open. The macOS app launcher
 * uses this to stop the engine shortly after the window is closed.
 */
export function Heartbeat() {
  useEffect(() => {
    const ping = () => fetch("/api/heartbeat", { cache: "no-store" }).catch(() => {});
    ping();
    const id = setInterval(ping, 5000);
    return () => clearInterval(id);
  }, []);
  return null;
}
