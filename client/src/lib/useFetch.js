import { useCallback, useEffect, useRef, useState } from 'react';

/** Loads data with a fetcher function; returns { data, error, loading, reload }. */
export function useFetch(fetcher, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const mounted = useRef(true);
  const load = useCallback(async (silent = false) => {
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetcher();
      if (mounted.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (mounted.current) setState((s) => ({ ...s, error, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { mounted.current = true; load(); return () => { mounted.current = false; }; }, [load]);
  return { ...state, reload: load };
}
