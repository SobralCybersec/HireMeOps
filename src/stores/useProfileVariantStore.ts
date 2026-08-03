import { create } from "zustand";
import type { ProfileVariantDto, ProfileSyncPlan } from "../types/domain";
import { safeInvoke, invokeStrict, errMessage } from "../lib/tauriInvoke";

interface ProfileVariantStoreState {
  variants: ProfileVariantDto[];
  selectedId: string | null;
  isLoading: boolean;
  error: string | null;

  // Draft-and-review LinkedIn sync plan for the current variant. Inert:
  // building it writes NOTHING to LinkedIn - it only returns copy-ready text.
  syncPlan: ProfileSyncPlan | null;
  isBuildingPlan: boolean;
  planError: string | null;

  loadVariants: (profileId: string) => Promise<void>;
  selectVariant: (id: string | null) => void;
  createVariant: (
    profileId: string,
    rewriteId: string,
    name?: string,
  ) => Promise<ProfileVariantDto | null>;
  deleteVariant: (id: string) => Promise<void>;
  buildSyncPlan: (variantId: string) => Promise<void>;
  clearSyncPlan: () => void;
  reset: () => void;
}

const EMPTY = {
  variants: [] as ProfileVariantDto[],
  selectedId: null,
  isLoading: false,
  error: null,
  syncPlan: null,
  isBuildingPlan: false,
  planError: null,
};

export const useProfileVariantStore = create<ProfileVariantStoreState>((set, get) => ({
  ...EMPTY,

  // Optional read: an unwired/empty backend degrades to an empty list rather
  // than surfacing an error, matching the Phase-1 page conventions.
  loadVariants: async (profileId) => {
    set({ isLoading: true, error: null });
    const variants = await safeInvoke<ProfileVariantDto[]>("list_profile_variants", { profileId });
    const list = variants ?? [];
    set((s) => {
      // Preserve the current pick if it still exists; otherwise fall to the
      // newest variant (the backend returns newest-first).
      const stillThere = s.selectedId != null && list.some((v) => v.id === s.selectedId);
      return {
        variants: list,
        selectedId: stillThere ? s.selectedId : (list[0]?.id ?? null),
        isLoading: false,
      };
    });
  },

  // Switching variants invalidates any plan built for the previous one so the
  // UI can never show a stale sync plan against the wrong variant.
  selectVariant: (id) => {
    set((s) => (s.selectedId === id ? {} : { selectedId: id, syncPlan: null, planError: null }));
  },

  // Mutation: surface real backend failures to the caller via `error`.
  createVariant: async (profileId, rewriteId, name) => {
    set({ error: null });
    try {
      const variant = await invokeStrict<ProfileVariantDto>("create_profile_variant", {
        profileId,
        rewriteId,
        name: name ?? null,
      });
      set((s) => ({
        variants: [variant, ...s.variants.filter((v) => v.id !== variant.id)],
        selectedId: variant.id,
        syncPlan: null,
        planError: null,
      }));
      return variant;
    } catch (error) {
      set({ error: errMessage(error) });
      return null;
    }
  },

  deleteVariant: async (id) => {
    set({ error: null });
    try {
      await invokeStrict<void>("delete_profile_variant", { id });
    } catch (error) {
      set({ error: errMessage(error) });
      return;
    }
    set((s) => {
      const variants = s.variants.filter((v) => v.id !== id);
      const selectionGone = s.selectedId === id;
      return {
        variants,
        selectedId: selectionGone ? (variants[0]?.id ?? null) : s.selectedId,
        syncPlan: selectionGone ? null : s.syncPlan,
        planError: selectionGone ? null : s.planError,
      };
    });
  },

  // Build the inert LinkedIn draft-and-review plan for a variant.
  buildSyncPlan: async (variantId) => {
    set({ isBuildingPlan: true, planError: null });
    try {
      const plan = await invokeStrict<ProfileSyncPlan>("build_profile_sync_plan", { variantId });
      // Guard against a race: only adopt the plan if the variant is still the
      // selected one by the time the backend answers.
      if (get().selectedId === variantId) {
        set({ syncPlan: plan, isBuildingPlan: false });
      } else {
        set({ isBuildingPlan: false });
      }
    } catch (error) {
      set({ planError: errMessage(error), isBuildingPlan: false, syncPlan: null });
    }
  },

  clearSyncPlan: () => set({ syncPlan: null, planError: null }),

  reset: () => set({ ...EMPTY }),
}));
