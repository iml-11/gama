"use client";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { api } from "@/lib/api";

/** Shows a banner when the backend is unreachable or XCOM data is missing. */
export function EngineStatus() {
  const [state, setState] = useState<"ok" | "unreachable" | "unconfigured" | "loading">("loading");
  useEffect(() => {
    // Re-check until the engine answers: it may still be starting up.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const check = () =>
      api
        .meta()
        .then((m) => !stopped && setState(m.engine_configured ? "ok" : "unconfigured"))
        .catch(() => {
          if (stopped) return;
          setState("unreachable");
          timer = setTimeout(check, 3000);
        });
    check();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  if (state === "ok" || state === "loading") return null;
  return (
    <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>{state === "unconfigured" ? "Attenuation engine not yet configured" : "Scientific engine not reachable"}</AlertTitle>
        <AlertDescription>
          {state === "unconfigured"
            ? "The NIST XCOM data files are missing on the server. No attenuation values will be shown."
            : "Waiting for the calculation engine… If this does not disappear, check the \"Gamma - engine\" window for an error (or start it with: uvicorn api.main:app --port 8000 in the backend folder)."}
        </AlertDescription>
      </Alert>
    </div>
  );
}
