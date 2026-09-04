import { useEffect } from "react";
import { errMessage } from "../../lib/tauriInvoke";
import { loadCvLibrary, loadCvRewrites } from "../cv";
import type { CvLibraryState } from "./useCvLibraryState";

export function useCvLibraryData(state: CvLibraryState) {
  const { activeProfileId, reloadNonce, setDocs, setLoading, setError, setRewrites } = state;
  const requestKey = `${activeProfileId ?? ""}:${reloadNonce}`;
  if (state.loadingKey !== requestKey) {
    state.setLoadingKey(requestKey);
    state.setLoading(true);
    state.setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    loadCvLibrary(activeProfileId ?? "")
      .then((rows) => {
        if (cancelled) return;
        setDocs(rows);
        setLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setDocs([]);
        setError(errMessage(error));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProfileId, reloadNonce, setDocs, setError, setLoading]);

  useEffect(() => {
    let cancelled = false;
    loadCvRewrites(activeProfileId ?? "")
      .then((rows) => {
        if (!cancelled) setRewrites(rows);
      })
      .catch(() => {
        if (!cancelled) setRewrites([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProfileId, reloadNonce, setRewrites]);
}
