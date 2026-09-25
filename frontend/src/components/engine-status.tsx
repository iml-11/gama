"use client";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { api } from "@/lib/api";

/** Shows a banner when the backend is unreachable or XCOM data is missing. */
export function EngineStatus() {
  const [state, setState] = useState<"ok" | "unreachable" | "unconfigured" | "loading">("loading");
  useEffect(() => {
    api
      .meta()
      .then((m) => setState(m.engine_configured ? "ok" : "unconfigured"))
      .catch(() => setState("unreachable"));
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
            : "Start the FastAPI backend (see README): uvicorn api.main:app --port 8000 in the backend directory."}
        </AlertDescription>
      </Alert>
    </div>
  );
}
