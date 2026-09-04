import { useProfileVariantStore } from "../../stores/useProfileVariantStore";
import { invokeStrict } from "../../lib/tauriInvoke";
import { loadCvLibrary } from "../cv/library";
import { loadCvRewrites } from "../cv/rewrite";
import type { ProfileVariantDto } from "../../types/domain";
import type { CvRewriteSummary } from "../cv/types";
import { variantUpdateInput } from "./model";
import type { ProfileVariantsState } from "./useProfileVariantsState";
import type { useProfileVariantsData } from "./useProfileVariantsData";

type Data = ReturnType<typeof useProfileVariantsData>;

type ActionContext = { state: ProfileVariantsState; data: Data };

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function useProfileVariantCreateActions({ state }: ActionContext) {
  const handleDocChange = (docId: string) => {
    state.setPickedDocId(docId);
    const first = state.allRewrites.find(
      (rewrite) => rewrite.cvDocumentId === docId && (rewrite.language ?? "pt") === state.language,
    );
    state.setPickedRewriteId(first?.id ?? "");
  };
  const handleLanguageChange = (language: "pt" | "en") => {
    state.setLanguage(language);
    const first = state.allRewrites.find(
      (rewrite) =>
        rewrite.cvDocumentId === state.pickedDocId && (rewrite.language ?? "pt") === language,
    );
    state.setPickedRewriteId(first?.id ?? "");
  };
  async function openCreateForm() {
    if (!state.activeProfileId) return;
    state.setCreating(true);
    state.setPickedDocId("");
    state.setPickedRewriteId("");
    state.setNewVariantName("");
    state.setFormLoading(true);
    try {
      const [docs, rewrites] = await Promise.all([
        loadCvLibrary(state.activeProfileId),
        loadCvRewrites(state.activeProfileId),
      ]);
      selectFirstRewriteSource(state, docs, rewrites);
    } catch {
      state.setDocs([]);
      state.setAllRewrites([]);
    } finally {
      state.setFormLoading(false);
    }
  }
  return { handleDocChange, handleLanguageChange, openCreateForm };
}

function selectFirstRewriteSource(
  state: ProfileVariantsState,
  docs: Awaited<ReturnType<typeof loadCvLibrary>>,
  rewrites: CvRewriteSummary[],
) {
  state.setDocs(docs);
  state.setAllRewrites(rewrites);
  const inLanguage = (rewrite: CvRewriteSummary) => (rewrite.language ?? "pt") === state.language;
  const firstDoc = docs.find((doc) =>
    rewrites.some((rewrite) => rewrite.cvDocumentId === doc.id && inLanguage(rewrite)),
  );
  if (firstDoc) {
    state.setPickedDocId(firstDoc.id);
    const firstRewrite = rewrites.find(
      (rewrite) => rewrite.cvDocumentId === firstDoc.id && inLanguage(rewrite),
    );
    state.setPickedRewriteId(firstRewrite?.id ?? "");
  } else if (docs[0]) {
    state.setPickedDocId(docs[0].id);
  }
}

export function useProfileVariantBuildActions({ state }: ActionContext) {
  async function buildFromFile() {
    if (!state.activeProfileId || !state.pickedDocId || state.submitting) return;
    state.setSubmitting(true);
    state.setSubmitStatus("Reading CV and structuring with GPT…");
    try {
      const variant = await invokeStrict<ProfileVariantDto>("create_variant_from_document", {
        profileId: state.activeProfileId,
        cvDocumentId: state.pickedDocId,
        name: state.newVariantName || null,
        language: state.language,
      });
      useProfileVariantStore.setState((current) => ({
        variants: [variant, ...current.variants.filter((item) => item.id !== variant.id)],
        selectedId: variant.id,
        syncPlan: null,
        planError: null,
      }));
      state.setCreating(false);
      state.setSubmitStatus("");
    } catch (error) {
      state.setSubmitStatus(errorText(error));
    } finally {
      state.setSubmitting(false);
    }
  }
  async function buildFromRewrite() {
    if (!state.activeProfileId || !state.pickedRewriteId || state.submitting) return;
    state.setSubmitting(true);
    state.setSubmitStatus("Creating variant…");
    try {
      const result = await state.createVariant(
        state.activeProfileId,
        state.pickedRewriteId,
        state.newVariantName || undefined,
      );
      if (result) {
        state.setCreating(false);
        state.setSubmitStatus("");
      }
    } catch (error) {
      state.setSubmitStatus(errorText(error));
    } finally {
      state.setSubmitting(false);
    }
  }
  return { buildFromFile, buildFromRewrite };
}

export function useProfileVariantEditActions({ state, data }: ActionContext) {
  async function handleDeleteVariant() {
    if (!data.selectedDto || state.isDeleting) return;
    if (!window.confirm(`Delete variant "${data.selectedDto.name}"? This cannot be undone.`))
      return;
    state.setIsDeleting(true);
    await state.deleteVariant(data.selectedDto.id);
    state.setIsDeleting(false);
  }
  async function saveVariant() {
    if (!data.selectedDto || !state.draft || state.isSaving) return;
    state.setIsSaving(true);
    state.setSaveError(null);
    try {
      const updated = await invokeStrict<ProfileVariantDto>("update_profile_variant", {
        id: data.selectedDto.id,
        input: variantUpdateInput(state.draft, data.selectedDto),
      });
      useProfileVariantStore.setState((current) => ({
        variants: current.variants.map((item) => (item.id === updated.id ? updated : item)),
      }));
    } catch (error) {
      state.setSaveError(errorText(error));
    } finally {
      state.setIsSaving(false);
    }
  }
  return { handleDeleteVariant, saveVariant };
}

export function useProfileVariantsActions(context: ActionContext) {
  return {
    ...useProfileVariantCreateActions(context),
    ...useProfileVariantBuildActions(context),
    ...useProfileVariantEditActions(context),
  };
}
