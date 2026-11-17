import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, isAbort } from "../api/client";

export interface ApiResource<T> {
  data: T | null;
  loading: boolean;
  error: string;
  status: number;
  reload: () => void;
  setData: (value: T | null) => void;
}

/**
 * Consulta com cancelamento: cada recarga aborta a anterior, evitando corrida
 * e requisição duplicada quando o operador troca de contexto rapidamente.
 */
export function useApiResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  options: { enabled?: boolean; reuseLoaded?: boolean } = {},
): ApiResource<T> {
  const enabled = options.enabled !== false;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const lastLoadedKey = useRef("");
  const lastLoadedAttempt = useRef(-1);
  const dependencyKey = JSON.stringify(deps);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }
    if (
      options.reuseLoaded === true &&
      data !== null &&
      lastLoadedKey.current === dependencyKey &&
      lastLoadedAttempt.current === attempt
    ) {
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    loader(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setData(value);
        lastLoadedKey.current = dependencyKey;
        lastLoadedAttempt.current = attempt;
        setStatus(200);
      })
      .catch((cause: unknown) => {
        if (isAbort(cause) || controller.signal.aborted) return;
        setStatus(cause instanceof ApiError ? cause.status : 0);
        setError((cause as Error)?.message || "A consulta não respondeu.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt, enabled]);

  return { data, loading, error, status, reload, setData };
}
