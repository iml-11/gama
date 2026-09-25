"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { MaterialInputState, Resolution } from "@/lib/types";

/** Debounced material resolution (formula / database / PubChem / composite). */
export function useResolution(state: MaterialInputState, delay = 350) {
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const key = JSON.stringify([state.input.trim(), state.choices, state.composition ?? null]);

  useEffect(() => {
    const text = state.input.trim();
    if (!text && !state.composition) {
      setResolution(null);
      setResolvedKey(null);
      setError(null);
      setLoading(false);
      return;
    }
    const id = ++seq.current;
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      api
        .resolve(state, ctrl.signal)
        .then((r) => {
          if (id === seq.current) {
            setResolution(r);
            setResolvedKey(key);
            setError(null);
          }
        })
        .catch((e: unknown) => {
          if (id !== seq.current || (e instanceof DOMException && e.name === "AbortError")) return;
          setError(e instanceof ApiError ? e.message : "Resolution failed.");
          setResolution(null);
        })
        .finally(() => id === seq.current && setLoading(false));
    }, delay);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, delay]);

  // `current` is true only when the resolution belongs to the present input.
  const current = resolvedKey === key && !loading;
  return { resolution, loading, error, current };
}
