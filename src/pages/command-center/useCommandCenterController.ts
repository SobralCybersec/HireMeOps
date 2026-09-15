import { useCallback, useEffect, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import type { CvDocument } from "../types/domain";
import { invokeStrict, safeInvoke } from "../lib/tauriInvoke";
import { useJobStore } from "../stores/useJobStore";
import { useProfileStore } from "../stores/useProfileStore";
import { useProfileVariantStore } from "../stores/useProfileVariantStore";

const CV_KEY = "hiremeops-selected-cv";
const AC_KEY = "hiremeops-autoconnect";
let autoConnectRunActive = false;

function useAutoConnect(activeProfileId: string | null) {
  const [autoConnect, setAutoConnectState] = useState(() => localStorage.getItem(AC_KEY) === "1");
  const setAutoConnect = useCallback((value: boolean) => {
    setAutoConnectState(value);
    localStorage.setItem(AC_KEY, value ? "1" : "0");
  }, []);
  const [acStatus, setAcStatus] = useState("");

  useEffect(() => {
    if (!autoConnect || !activeProfileId || autoConnectRunActive) return;
    autoConnectRunActive = true;
    let cancelled = false;
    (async () => {
      try {
        let total = 0;
        setAcStatus("Connecting…");
        while (!cancelled) {
          const base = total;
          const channel = new Channel<{ sent: number; status: "ok" | "limit" }>();
          channel.onmessage = (payload) => {
            if (cancelled) return;
            setAcStatus(
              payload.status === "limit"
                ? `⚠ Weekly connection limit reached — sent ${base + payload.sent}.`
                : `Sent ${base + payload.sent}…`,
            );
          };
          try {
            const result = await invokeStrict<{ sent: number; status: "ok" | "limit" }>(
              "auto_connect_linkedin",
              { maxCount: 200, channel },
            );
            total += result.sent;
            setAcStatus(`Sent ${total}…`);
            if (result.status === "limit" || result.sent === 0) {
              setAcStatus(
                result.status === "limit"
                  ? `Weekly limit reached — sent ${total}.`
                  : `Done — sent ${total}.`,
              );
              setAutoConnect(false);
              break;
            }
          } catch (error) {
            setAcStatus(error instanceof Error ? error.message : String(error));
            setAutoConnect(false);
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      } finally {
        autoConnectRunActive = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoConnect, activeProfileId, setAutoConnect]);

  return { autoConnect, setAutoConnect, acStatus };
}

export function useCommandCenterController() {
  const activeProfileId = useProfileStore((state) => state.activeProfileId);
  const profiles = useProfileStore((state) => state.profiles);
  const loadProfiles = useProfileStore((state) => state.loadProfiles);
  const setActiveProfile = useProfileStore((state) => state.setActiveProfile);
  const variants = useProfileVariantStore((state) => state.variants);
  const loadVariants = useProfileVariantStore((state) => state.loadVariants);
  const jobs = useJobStore((state) => state.jobs);
  const loadJobs = useJobStore((state) => state.loadJobs);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [cvs, setCvs] = useState<CvDocument[]>([]);
  const [selectedCvId, setSelectedCvId] = useState(() => localStorage.getItem(CV_KEY) ?? "");
  const [opening, setOpening] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const { autoConnect, setAutoConnect, acStatus } = useAutoConnect(activeProfileId);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (!activeProfileId) return;
    void loadJobs(activeProfileId);
    void loadVariants(activeProfileId);
    void safeInvoke<CvDocument[]>("list_cv_documents", { profileId: activeProfileId }).then(
      (list) => setCvs(list ?? []),
    );
  }, [activeProfileId, loadJobs, loadVariants]);

  useEffect(() => {
    if (variants.length && !variants.some((variant) => variant.id === selectedVariantId)) {
      setSelectedVariantId(variants[0].id);
    }
  }, [variants, selectedVariantId]);

  const selectedVariant = variants.find((variant) => variant.id === selectedVariantId) ?? null;
  const openAllLogins = useCallback(async () => {
    if (!activeProfileId || opening) return;
    setOpening(true);
    setLoginError(null);
    try {
      await invokeStrict("open_all_logins", { profileId: activeProfileId });
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpening(false);
    }
  }, [activeProfileId, opening]);

  const openGmail = useCallback(() => {
    if (activeProfileId) void safeInvoke("open_gmail", { profileId: activeProfileId });
  }, [activeProfileId]);
  const pickCv = (id: string) => {
    setSelectedCvId(id);
    if (id) localStorage.setItem(CV_KEY, id);
    else localStorage.removeItem(CV_KEY);
  };
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const brand = "HireMeOps";
  const [typed, setTyped] = useState(reduceMotion ? brand : "");
  useEffect(() => {
    if (reduceMotion) return;
    let index = 0;
    const id = window.setInterval(() => {
      index += 1;
      setTyped(brand.slice(0, index));
      if (index >= brand.length) window.clearInterval(id);
    }, 120);
    return () => window.clearInterval(id);
  }, [brand, reduceMotion]);

  return {
    brand,
    typed,
    activeProfileId,
    profiles,
    variants,
    selectedVariantId,
    selectedVariant,
    onProfileChange: setActiveProfile,
    onVariantChange: setSelectedVariantId,
    cvs,
    selectedCvId,
    onCvChange: pickCv,
    onOpenGmail: openGmail,
    jobCount: jobs.length,
    recentJobs: jobs.slice(0, 12),
    opening,
    onOpenAllLogins: openAllLogins,
    autoConnect,
    onAutoConnectChange: setAutoConnect,
    acStatus,
    loginError,
  };
}
