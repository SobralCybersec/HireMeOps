import { useEffect, useMemo } from "react";
import type React from "react";
import { draftFromDto, TABS, toVariantView } from "./model";
import type { ProfileVariantsState } from "./useProfileVariantsState";

export function useProfileVariantsData(state: ProfileVariantsState) {
  const { activeProfileId, loadVariants } = state;
  const variants = useMemo(() => state.variantDtos.map(toVariantView), [state.variantDtos]);
  const selected = variants.find((variant) => variant.id === state.selectedId) ?? null;
  const selectedDto = state.variantDtos.find((variant) => variant.id === state.selectedId) ?? null;
  const docRewrites = state.allRewrites.filter(
    (rewrite) =>
      rewrite.cvDocumentId === state.pickedDocId && (rewrite.language ?? "pt") === state.language,
  );

  useEffect(() => {
    if (activeProfileId) loadVariants(activeProfileId);
  }, [activeProfileId, loadVariants]);

  useEffect(() => {
    state.setDraft(selectedDto ? draftFromDto(selectedDto) : null);
    state.setSaveError(null);
    state.setEditMode(false);
  }, [state.selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleTabKey(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const next = nextTabIndex(event.key, index);
    state.setActiveTab(TABS[next]);
    document.getElementById(`variant-tab-${TABS[next]}`)?.focus();
  }

  return { variants, selected, selectedDto, docRewrites, handleTabKey };
}

function nextTabIndex(key: string, index: number) {
  if (key === "ArrowRight" || key === "ArrowDown") return (index + 1) % TABS.length;
  if (key === "ArrowLeft" || key === "ArrowUp") return (index - 1 + TABS.length) % TABS.length;
  return key === "Home" ? 0 : TABS.length - 1;
}
