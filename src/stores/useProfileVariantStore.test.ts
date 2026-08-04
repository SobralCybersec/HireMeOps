import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProfileVariantStore } from "./useProfileVariantStore";
import { invokeStrict, safeInvoke } from "../lib/tauriInvoke";
import type { ProfileVariantDto, ProfileSyncPlan } from "../types/domain";

// vi.mock is hoisted above imports - tauriInvoke is replaced before the store
// module runs. Preserve the real errMessage so error strings stay stable.
vi.mock("../lib/tauriInvoke", () => ({
  safeInvoke: vi.fn(),
  invokeStrict: vi.fn(),
  errMessage: (e: unknown): string =>
    typeof e === "string" ? e : e instanceof Error ? e.message : String(e),
}));

const mockSafeInvoke = vi.mocked(safeInvoke);
const mockInvokeStrict = vi.mocked(invokeStrict);

function variant(id: string, over: Partial<ProfileVariantDto> = {}): ProfileVariantDto {
  return {
    id,
    profileId: "p1",
    name: `Variant ${id}`,
    targetTitle: "Senior Backend Engineer",
    headline: "Headline",
    summary: "Summary",
    aboutText: "About",
    keywords: ["rust", "java"],
    positions: ["Backend Engineer @ Acme"],
    skills: [{ category: "Languages", skills: "Rust, Java" }],
    experience: [
      {
        title: "Engineer",
        organization: "Acme",
        location: "Remote",
        dates: "2020-2025",
        bullets: ["Shipped X"],
      },
    ],
    education: [],
    contact: { name: "Ana", location: "BR", email: null, phone: null, website: null },
    sourceCvDocumentId: "cv1",
    sourceRewriteId: "rw1",
    createdAt: "2026-01-02T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    ...over,
  };
}

function plan(variantId: string): ProfileSyncPlan {
  return {
    variantId,
    profileId: "p1",
    variantName: "Variant",
    targetTitle: "Senior Backend Engineer",
    sections: [
      {
        id: "s1",
        kind: "headline",
        label: "Headline",
        editUrl: "https://www.linkedin.com/in/me/edit/intro/",
        copyText: "Senior Backend Engineer",
        charLimit: 220,
        overLimit: false,
      },
    ],
    disclaimer: "Nothing is written to LinkedIn. Copy each section and paste it yourself.",
    generatedAt: "2026-01-02T00:00:00Z",
  };
}

const INITIAL = {
  variants: [],
  selectedId: null,
  isLoading: false,
  error: null,
  syncPlan: null,
  isBuildingPlan: false,
  planError: null,
};

describe("useProfileVariantStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProfileVariantStore.setState({ ...INITIAL });
  });

  describe("loadVariants", () => {
    it("populates variants and auto-selects the newest when nothing is selected", async () => {
      mockSafeInvoke.mockResolvedValueOnce([variant("a"), variant("b")]);

      await useProfileVariantStore.getState().loadVariants("p1");

      expect(mockSafeInvoke).toHaveBeenCalledWith("list_profile_variants", { profileId: "p1" });
      const s = useProfileVariantStore.getState();
      expect(s.variants.map((v) => v.id)).toEqual(["a", "b"]);
      expect(s.selectedId).toBe("a");
      expect(s.isLoading).toBe(false);
    });

    it("preserves an existing selection that still exists", async () => {
      useProfileVariantStore.setState({ selectedId: "b" });
      mockSafeInvoke.mockResolvedValueOnce([variant("a"), variant("b")]);

      await useProfileVariantStore.getState().loadVariants("p1");

      expect(useProfileVariantStore.getState().selectedId).toBe("b");
    });

    it("degrades to an empty list when safeInvoke returns null", async () => {
      mockSafeInvoke.mockResolvedValueOnce(null);

      await useProfileVariantStore.getState().loadVariants("p1");

      const s = useProfileVariantStore.getState();
      expect(s.variants).toEqual([]);
      expect(s.selectedId).toBeNull();
    });
  });

  describe("selectVariant", () => {
    it("clears the sync plan when switching to a different variant", () => {
      useProfileVariantStore.setState({ selectedId: "a", syncPlan: plan("a"), planError: "boom" });

      useProfileVariantStore.getState().selectVariant("b");

      const s = useProfileVariantStore.getState();
      expect(s.selectedId).toBe("b");
      expect(s.syncPlan).toBeNull();
      expect(s.planError).toBeNull();
    });

    it("is a no-op (keeps the plan) when reselecting the same variant", () => {
      const p = plan("a");
      useProfileVariantStore.setState({ selectedId: "a", syncPlan: p });

      useProfileVariantStore.getState().selectVariant("a");

      expect(useProfileVariantStore.getState().syncPlan).toBe(p);
    });
  });

  describe("createVariant", () => {
    it("prepends the new variant and selects it on success", async () => {
      useProfileVariantStore.setState({ variants: [variant("a")], selectedId: "a" });
      mockInvokeStrict.mockResolvedValueOnce(variant("new"));

      const result = await useProfileVariantStore.getState().createVariant("p1", "rw1", "Targeted");

      expect(mockInvokeStrict).toHaveBeenCalledWith("create_profile_variant", {
        profileId: "p1",
        rewriteId: "rw1",
        name: "Targeted",
      });
      expect(result?.id).toBe("new");
      const s = useProfileVariantStore.getState();
      expect(s.variants.map((v) => v.id)).toEqual(["new", "a"]);
      expect(s.selectedId).toBe("new");
    });

    it("passes name: null when omitted", async () => {
      mockInvokeStrict.mockResolvedValueOnce(variant("new"));

      await useProfileVariantStore.getState().createVariant("p1", "rw1");

      expect(mockInvokeStrict).toHaveBeenCalledWith("create_profile_variant", {
        profileId: "p1",
        rewriteId: "rw1",
        name: null,
      });
    });

    it("captures the error and leaves the list untouched on failure", async () => {
      useProfileVariantStore.setState({ variants: [variant("a")] });
      mockInvokeStrict.mockRejectedValueOnce("no rewrite");

      const result = await useProfileVariantStore.getState().createVariant("p1", "bad");

      expect(result).toBeNull();
      const s = useProfileVariantStore.getState();
      expect(s.error).toBe("no rewrite");
      expect(s.variants.map((v) => v.id)).toEqual(["a"]);
    });
  });

  describe("deleteVariant", () => {
    it("removes the variant and reselects the newest when the pick was deleted", async () => {
      useProfileVariantStore.setState({
        variants: [variant("a"), variant("b")],
        selectedId: "a",
        syncPlan: plan("a"),
      });
      mockInvokeStrict.mockResolvedValueOnce(undefined);

      await useProfileVariantStore.getState().deleteVariant("a");

      expect(mockInvokeStrict).toHaveBeenCalledWith("delete_profile_variant", { id: "a" });
      const s = useProfileVariantStore.getState();
      expect(s.variants.map((v) => v.id)).toEqual(["b"]);
      expect(s.selectedId).toBe("b");
      expect(s.syncPlan).toBeNull();
    });

    it("keeps the current selection and plan when a different variant is deleted", async () => {
      const p = plan("a");
      useProfileVariantStore.setState({
        variants: [variant("a"), variant("b")],
        selectedId: "a",
        syncPlan: p,
      });
      mockInvokeStrict.mockResolvedValueOnce(undefined);

      await useProfileVariantStore.getState().deleteVariant("b");

      const s = useProfileVariantStore.getState();
      expect(s.selectedId).toBe("a");
      expect(s.syncPlan).toBe(p);
    });

    it("captures the error and keeps the variant on failure", async () => {
      useProfileVariantStore.setState({ variants: [variant("a")], selectedId: "a" });
      mockInvokeStrict.mockRejectedValueOnce("db locked");

      await useProfileVariantStore.getState().deleteVariant("a");

      const s = useProfileVariantStore.getState();
      expect(s.error).toBe("db locked");
      expect(s.variants.map((v) => v.id)).toEqual(["a"]);
    });
  });

  describe("buildSyncPlan", () => {
    it("stores the plan when the variant is still selected", async () => {
      useProfileVariantStore.setState({ selectedId: "a" });
      mockInvokeStrict.mockResolvedValueOnce(plan("a"));

      await useProfileVariantStore.getState().buildSyncPlan("a");

      expect(mockInvokeStrict).toHaveBeenCalledWith("build_profile_sync_plan", { variantId: "a" });
      const s = useProfileVariantStore.getState();
      expect(s.syncPlan?.variantId).toBe("a");
      expect(s.isBuildingPlan).toBe(false);
    });

    it("discards the plan if the selection changed mid-flight", async () => {
      useProfileVariantStore.setState({ selectedId: "b" });
      mockInvokeStrict.mockResolvedValueOnce(plan("a"));

      await useProfileVariantStore.getState().buildSyncPlan("a");

      const s = useProfileVariantStore.getState();
      expect(s.syncPlan).toBeNull();
      expect(s.isBuildingPlan).toBe(false);
    });

    it("captures planError on failure", async () => {
      useProfileVariantStore.setState({ selectedId: "a" });
      mockInvokeStrict.mockRejectedValueOnce("variant not found");

      await useProfileVariantStore.getState().buildSyncPlan("a");

      const s = useProfileVariantStore.getState();
      expect(s.planError).toBe("variant not found");
      expect(s.syncPlan).toBeNull();
      expect(s.isBuildingPlan).toBe(false);
    });
  });
});
