import { useState } from "react";
import { useProfileStore } from "../../stores/useProfileStore";
import { useProfileVariantStore } from "../../stores/useProfileVariantStore";
import type { CvLanguage, CvLibraryDoc, CvRewriteSummary } from "../cv/types";
import type { EditDraft, Tab } from "./model";

export function useProfileVariantsState() {
  const activeProfileId = useProfileStore((store) => store.activeProfileId);
  const variantDtos = useProfileVariantStore((store) => store.variants);
  const selectedId = useProfileVariantStore((store) => store.selectedId);
  const isLoading = useProfileVariantStore((store) => store.isLoading);
  const storeError = useProfileVariantStore((store) => store.error);
  const loadVariants = useProfileVariantStore((store) => store.loadVariants);
  const selectVariant = useProfileVariantStore((store) => store.selectVariant);
  const createVariant = useProfileVariantStore((store) => store.createVariant);
  const deleteVariant = useProfileVariantStore((store) => store.deleteVariant);
  const [activeTab, setActiveTab] = useState<Tab>("Headline");
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [docs, setDocs] = useState<CvLibraryDoc[]>([]);
  const [allRewrites, setAllRewrites] = useState<CvRewriteSummary[]>([]);
  const [pickedDocId, setPickedDocId] = useState("");
  const [pickedRewriteId, setPickedRewriteId] = useState("");
  const [newVariantName, setNewVariantName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState("");
  const [language, setLanguage] = useState<CvLanguage>("en");
  const [isDeleting, setIsDeleting] = useState(false);

  return {
    activeProfileId,
    variantDtos,
    selectedId,
    isLoading,
    storeError,
    loadVariants,
    selectVariant,
    createVariant,
    deleteVariant,
    activeTab,
    setActiveTab,
    editMode,
    setEditMode,
    draft,
    setDraft,
    isSaving,
    setIsSaving,
    saveError,
    setSaveError,
    creating,
    setCreating,
    formLoading,
    setFormLoading,
    docs,
    setDocs,
    allRewrites,
    setAllRewrites,
    pickedDocId,
    setPickedDocId,
    pickedRewriteId,
    setPickedRewriteId,
    newVariantName,
    setNewVariantName,
    submitting,
    setSubmitting,
    submitStatus,
    setSubmitStatus,
    language,
    setLanguage,
    isDeleting,
    setIsDeleting,
  };
}

export type ProfileVariantsState = ReturnType<typeof useProfileVariantsState>;
