import React, { useEffect, useMemo, useState } from "react";
import { Button, Dropdown, Field, Input, Select, Textarea } from "../components/ui";
import { useProfileStore } from "../stores/useProfileStore";
import { useProfileVariantStore } from "../stores/useProfileVariantStore";
import type { ProfileVariantDto } from "../types/domain";
import { invokeStrict } from "../lib/tauriInvoke";
import { loadCvRewrites } from "./cv/rewrite";
import { renderInlineBold } from "./cv/markdown";
import { loadCvLibrary } from "./cv/library";
import type { CvRewriteReport, CvLibraryDoc, CvLanguage } from "./cv/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Variant {
  id: string;
  name: string;
  headline: string;
  summary: string;
  aboutText: string;
  keywords: string[];
  skills: string[];
}

/**
 * Structured CV entry card — one employer/school block: a bold title, a
 * meta subline (org · location · dates), and its achievement/coursework
 * bullets. Shared by the Experience and Education tabs so both read the same
 * way instead of experience collapsing into a flat text blob.
 */
function EntryCard({
  title,
  subParts,
  bullets,
}: {
  title: string;
  subParts: (string | null | undefined)[];
  bullets: string[];
}) {
  const sub = subParts.filter((p) => p && p.trim()).join(" · ");
  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderLeft: "2px solid var(--color-accent)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-1)",
          padding: "var(--sp-3) var(--sp-4)",
          background: "var(--color-surface-2)",
          borderBottom: bullets.length > 0 ? "1px solid var(--color-border)" : undefined,
        }}
      >
        <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--fw-semibold)" }}>
          {title || "—"}
        </span>
        {sub && (
          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>{sub}</span>
        )}
      </div>
      {bullets.length > 0 && (
        <ul
          style={{
            margin: 0,
            padding: "var(--sp-3) var(--sp-4) var(--sp-3) var(--sp-6)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--sp-1)",
          }}
        >
          {bullets.map((b, j) => (
            <li key={j} style={{ fontSize: "var(--text-xs)", color: "var(--color-text)", lineHeight: 1.5 }}>
              {renderInlineBold(b)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface EditDraft {
  name: string;
  headline: string;
  summary: string;
  aboutText: string;
  keywords: string; // comma-separated textarea value
}

/**
 * Section frame matching EntryCard — an accent-bordered card with a title (and
 * optional hint) header on the surface-2 band, and its content below. Gives the
 * text/list sections the same polished look as the Experience/Education views.
 */
function SectionCard({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderLeft: "2px solid var(--color-accent)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "var(--sp-3)",
          padding: "var(--sp-3) var(--sp-4)",
          background: "var(--color-surface-2)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)", flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--fw-semibold)" }}>{title}</span>
          {hint && (
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>{hint}</span>
          )}
        </div>
        {action}
      </div>
      <div style={{ padding: "var(--sp-4)" }}>{children}</div>
    </div>
  );
}

/** Small header toggle: read view ↔ edit inputs. */
function EditToggle({ editing, onToggle }: { editing: boolean; onToggle: () => void }) {
  return (
    <Button size="sm" variant="ghost" onClick={onToggle}>
      {editing ? "Done" : "Edit"}
    </Button>
  );
}

/** Read-view paragraph for a text section (preserves line breaks; "—" if empty). */
function ReadText({ value, mono }: { value: string; mono?: boolean }) {
  const v = value.trim();
  if (!v) return <span style={{ color: "var(--color-text-muted)", fontSize: "var(--text-sm)" }}>—</span>;
  return (
    <p
      style={{
        margin: 0,
        fontSize: "var(--text-sm)",
        lineHeight: 1.6,
        whiteSpace: "pre-wrap",
        color: "var(--color-text)",
        fontFamily: mono ? "var(--font-mono)" : undefined,
      }}
    >
      {v}
    </p>
  );
}

const TABS = ["Headline", "Summary", "About", "Keywords", "Skills", "Experience", "Education"] as const;
type Tab = (typeof TABS)[number];

function toVariantView(dto: ProfileVariantDto): Variant {
  return {
    id: dto.id,
    name: dto.name,
    headline: dto.headline,
    summary: dto.summary,
    aboutText: dto.aboutText,
    keywords: dto.keywords,
    skills: dto.skills
      .map((g) => (g.category ? `${g.category}: ${g.skills}` : g.skills))
      .filter((line) => line.trim().length > 0),
  };
}

// Clean, provider-agnostic label for a stored rewrite. The raw `modelProvider`
// string carried legacy values (the removed Gemini/Mistral/etc. providers) and
// surfaced as "various browsers" in the picker — we only run GPT now, so label
// by the variant name (or a plain "GPT rewrite") plus the date to disambiguate.
function rewriteLabel(r: CvRewriteReport): string {
  const when = new Date(r.createdAt).toLocaleDateString();
  const nm = r.variantName?.trim();
  return nm ? `${nm} · ${when}` : `GPT rewrite · ${when}`;
}

function draftFromDto(dto: ProfileVariantDto): EditDraft {
  return {
    name: dto.name,
    headline: dto.headline,
    summary: dto.summary,
    aboutText: dto.aboutText,
    keywords: dto.keywords.join(", "),
  };
}

// ---------------------------------------------------------------------------

export function ProfileVariants() {
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const variantDtos = useProfileVariantStore((s) => s.variants);
  const selectedId = useProfileVariantStore((s) => s.selectedId);
  const isLoading = useProfileVariantStore((s) => s.isLoading);
  const storeError = useProfileVariantStore((s) => s.error);
  const loadVariants = useProfileVariantStore((s) => s.loadVariants);
  const selectVariant = useProfileVariantStore((s) => s.selectVariant);
  const createVariant = useProfileVariantStore((s) => s.createVariant);
  const deleteVariant = useProfileVariantStore((s) => s.deleteVariant);
  const [activeTab, setActiveTab] = useState<Tab>("Headline");
  // Text sections read like the Experience/Education cards by default; the Edit
  // toggle flips them to inputs. Resets to read mode when the variant changes.
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // "Generate from CV" form state — step 1: pick a library file, step 2: pick a rewrite
  const [creating, setCreating] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [docs, setDocs] = useState<CvLibraryDoc[]>([]);
  const [allRewrites, setAllRewrites] = useState<CvRewriteReport[]>([]);
  const [pickedDocId, setPickedDocId] = useState("");
  const [pickedRewriteId, setPickedRewriteId] = useState("");
  const [newVariantName, setNewVariantName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState("");
  const [language, setLanguage] = useState<CvLanguage>("en");

  // Rewrites for the picked doc, filtered by the selected language. Language defaults to "pt" on old rows.
  const docRewrites = allRewrites.filter(
    (r) => r.cvDocumentId === pickedDocId && (r.rewrite.language ?? "pt") === language,
  );

  function handleDocChange(docId: string) {
    setPickedDocId(docId);
    const first = allRewrites.find(
      (r) => r.cvDocumentId === docId && (r.rewrite.language ?? "pt") === language,
    );
    setPickedRewriteId(first?.id ?? "");
  }

  // When language toggle changes, re-sync the rewrite selection for the current doc.
  function handleLanguageChange(lang: CvLanguage) {
    setLanguage(lang);
    const first = allRewrites.find(
      (r) => r.cvDocumentId === pickedDocId && (r.rewrite.language ?? "pt") === lang,
    );
    setPickedRewriteId(first?.id ?? "");
  }

  async function openCreateForm() {
    if (!activeProfileId) return;
    setCreating(true);
    setPickedDocId("");
    setPickedRewriteId("");
    setNewVariantName("");
    setFormLoading(true);
    try {
      const [docList, rewriteList] = await Promise.all([
        loadCvLibrary(activeProfileId),
        loadCvRewrites(activeProfileId),
      ]);
      setDocs(docList);
      setAllRewrites(rewriteList);
      // Auto-select first doc that has a rewrite in the selected language
      const rewriteInLang = (r: CvRewriteReport) => (r.rewrite.language ?? "pt") === language;
      const firstWithRewrite = docList.find((d) =>
        rewriteList.some((r) => r.cvDocumentId === d.id && rewriteInLang(r)),
      );
      if (firstWithRewrite) {
        setPickedDocId(firstWithRewrite.id);
        const first = rewriteList.find((r) => r.cvDocumentId === firstWithRewrite.id && rewriteInLang(r));
        if (first) setPickedRewriteId(first.id);
      } else if (docList[0]) {
        setPickedDocId(docList[0].id);
      }
    } catch {
      setDocs([]);
      setAllRewrites([]);
    } finally {
      setFormLoading(false);
    }
  }

  // Primary path — build a variant straight from the picked CV file. GPT reads
  // and structures the document in one shot; no pre-made rewrite required. This
  // is always available whenever a file is selected.
  async function buildFromFile() {
    if (!activeProfileId || !pickedDocId || submitting) return;
    setSubmitting(true);
    setSubmitStatus("Reading CV and structuring with GPT…");
    try {
      const variant = await invokeStrict<ProfileVariantDto>("create_variant_from_document", {
        profileId: activeProfileId,
        cvDocumentId: pickedDocId,
        name: newVariantName || null,
        language,
      });
      useProfileVariantStore.setState((s) => ({
        variants: [variant, ...s.variants.filter((v) => v.id !== variant.id)],
        selectedId: variant.id,
        syncPlan: null,
        planError: null,
      }));
      setCreating(false);
      setSubmitStatus("");
    } catch (err) {
      setSubmitStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  // Optional shortcut — reuse an already-generated rewrite instead of re-running
  // GPT. Only reachable when the picked file has rewrites in the chosen language.
  async function buildFromRewrite() {
    if (!activeProfileId || !pickedRewriteId || submitting) return;
    setSubmitting(true);
    setSubmitStatus("Creating variant…");
    try {
      const result = await createVariant(
        activeProfileId,
        pickedRewriteId,
        newVariantName || undefined,
      );
      if (result) {
        setCreating(false);
        setSubmitStatus("");
      }
    } catch (err) {
      setSubmitStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  // Hydrate the variant list for the active profile; re-runs on profile
  // switch. Selection + sync-plan lifecycle live in the store.
  useEffect(() => {
    if (activeProfileId) loadVariants(activeProfileId);
  }, [activeProfileId, loadVariants]);

  const variants = useMemo(() => variantDtos.map(toVariantView), [variantDtos]);

  // Keyboard nav for the horizontal variant editor tablist (ArrowLeft/Right + Home/End).
  function handleTabKey(e: React.KeyboardEvent<HTMLButtonElement>, idx: number) {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    let next: number;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % TABS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else next = TABS.length - 1;
    setActiveTab(TABS[next]);
    document.getElementById(`variant-tab-${TABS[next]}`)?.focus();
  }

  const selected = variants.find((v) => v.id === selectedId) ?? null;
  const selectedDto = variantDtos.find((v) => v.id === selectedId) ?? null;
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDeleteVariant() {
    if (!selectedDto || isDeleting) return;
    if (!window.confirm(`Delete variant "${selectedDto.name}"? This cannot be undone.`)) return;
    setIsDeleting(true);
    await deleteVariant(selectedDto.id);
    setIsDeleting(false);
  }

  // Reset draft (and drop back to read mode) whenever the user switches variants.
  useEffect(() => {
    setDraft(selectedDto ? draftFromDto(selectedDto) : null);
    setSaveError(null);
    setEditMode(false);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveVariant() {
    if (!selectedDto || !draft || isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const updated = await invokeStrict<ProfileVariantDto>("update_profile_variant", {
        id: selectedDto.id,
        input: {
          name: draft.name !== selectedDto.name ? draft.name : undefined,
          headline: draft.headline !== selectedDto.headline ? draft.headline : undefined,
          summary: draft.summary !== selectedDto.summary ? draft.summary : undefined,
          aboutText: draft.aboutText !== selectedDto.aboutText ? draft.aboutText : undefined,
          keywords: draft.keywords !== selectedDto.keywords.join(", ") ? draft.keywords : undefined,
        },
      });
      useProfileVariantStore.setState((s) => ({
        variants: s.variants.map((v) => (v.id === updated.id ? updated : v)),
      }));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="page page--fill" style={{ padding: 0 }}>
      {/* ── Header ── */}
      <div
        style={{
          padding: "var(--sp-4)",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-3)",
          flexShrink: 0,
        }}
      >
        <h1 className="page-title">Profile Variants</h1>
        <span className="page-subtitle">{variants.length} variants</span>
        {variants.length > 0 && (
          <Dropdown
            aria-label="Select variant"
            title="Variants"
            value={selectedId ?? ""}
            onChange={(v) => selectVariant(v)}
            style={{ minWidth: "16rem" }}
            options={variants.map((v) => ({
              value: v.id,
              label: v.keywords.length ? `${v.name} — ${v.keywords.slice(0, 3).join(", ")}` : v.name,
            }))}
          />
        )}
        <div className="toolbar-spacer" />
        <Button
          variant="danger"
          size="sm"
          disabled={!selectedDto || isDeleting}
          title={selectedDto ? `Delete "${selectedDto.name}"` : "Select a variant to delete"}
          onClick={() => void handleDeleteVariant()}
        >
          {isDeleting ? "Deleting…" : "Delete"}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={!activeProfileId || creating}
          onClick={() => void openCreateForm()}
        >
          + Generate from CV
        </Button>
        {creating && (
          <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
            Cancel
          </Button>
        )}
      </div>

      {/* ── Inline create form ── */}
      {creating && (
        <div
          style={{
            padding: "var(--sp-4)",
            borderBottom: "1px solid var(--color-border)",
            background: "var(--color-surface-2)",
            display: "flex",
            alignItems: "flex-end",
            gap: "var(--sp-3)",
            flexWrap: "wrap",
          }}
        >
          {/* Step 1: CV Library file */}
          <Field label="CV file" htmlFor="doc-pick" style={{ flex: "1 1 200px", margin: 0 }}>
            <Select
              id="doc-pick"
              value={pickedDocId}
              onChange={(e) => handleDocChange(e.target.value)}
              disabled={formLoading || submitting}
              placeholder={formLoading ? "Loading…" : docs.length === 0 ? "No files uploaded" : undefined}
              options={docs.map((d) => ({ value: d.id, label: d.fileName }))}
            />
          </Field>

          {/* Language toggle — output language for a fresh build; also filters the optional rewrite shortcut. */}
          <div style={{ display: "flex", gap: "var(--sp-1)", alignSelf: "flex-end", paddingBottom: "1px" }}>
            <Button size="sm" variant={language === "pt" ? "primary" : "ghost"} disabled={submitting} onClick={() => handleLanguageChange("pt")} title="Portuguese">PT</Button>
            <Button size="sm" variant={language === "en" ? "primary" : "ghost"} disabled={submitting} onClick={() => handleLanguageChange("en")} title="English">EN</Button>
          </div>

          {/* Optional name */}
          <Field label="Variant name (optional)" htmlFor="var-name-input" style={{ flex: "1 1 160px", margin: 0 }}>
            <Input
              id="var-name-input"
              type="text"
              placeholder="e.g. Senior Backend Eng"
              value={newVariantName}
              onChange={(e) => setNewVariantName(e.target.value)}
              disabled={submitting}
            />
          </Field>

          {/* Primary — build straight from the CV file (GPT structures it fresh). */}
          <Button
            variant="primary"
            size="sm"
            disabled={!pickedDocId || submitting || formLoading}
            onClick={() => void buildFromFile()}
            style={{ flexShrink: 0 }}
            title="Read the CV file and build a variant with GPT"
          >
            {submitting ? submitStatus || "Working…" : "Build from CV file"}
          </Button>

          {/* Optional shortcut — reuse an existing GPT rewrite instead of re-running it. */}
          {docRewrites.length > 0 && (
            <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--sp-2)", flex: "1 1 260px" }}>
              <Field
                label="Reuse existing rewrite (optional)"
                htmlFor="rewrite-pick"
                style={{ flex: 1, margin: 0 }}
              >
                <Select
                  id="rewrite-pick"
                  value={pickedRewriteId}
                  onChange={(e) => setPickedRewriteId(e.target.value)}
                  disabled={formLoading || submitting}
                  options={docRewrites.map((r) => ({ value: r.id, label: rewriteLabel(r) }))}
                />
              </Field>
              <Button
                variant="ghost"
                size="sm"
                disabled={!pickedRewriteId || submitting || formLoading}
                onClick={() => void buildFromRewrite()}
                style={{ flexShrink: 0 }}
                title="Create the variant from the selected existing rewrite"
              >
                Use rewrite
              </Button>
            </div>
          )}

          {(storeError || (!submitting && submitStatus)) && (
            <p style={{ width: "100%", margin: 0, fontSize: "var(--text-xs)", color: "var(--color-error)" }}>
              {storeError || submitStatus}
            </p>
          )}
        </div>
      )}

      {/* ── Editor (full-width; variant picked from the header dropdown) ── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          borderTop: "1px solid var(--color-border)",
        }}
      >
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: 0 }}>
          {selected === null ? (
            <div className="empty-state">
              <p className="empty-state__title">
                {isLoading
                  ? "Loading variants…"
                  : variants.length === 0
                    ? "No variants yet. Generate one from a CV rewrite."
                    : "Select a variant above."}
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              {/* Tab bar */}
              <div
                style={{
                  display: "flex",
                  gap: 1,
                  background: "var(--color-border)",
                  borderBottom: "1px solid var(--color-border)",
                  flexShrink: 0,
                  overflowX: "auto",
                }}
                role="tablist"
                aria-label="Variant editor sections"
              >
                {TABS.map((tab, idx) => (
                  <button
                    key={tab}
                    id={`variant-tab-${tab}`}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab}
                    aria-controls="variant-panel"
                    tabIndex={activeTab === tab ? 0 : -1}
                    className={activeTab === tab ? "filter-tab active" : "filter-tab"}
                    onClick={() => setActiveTab(tab)}
                    onKeyDown={(e) => handleTabKey(e, idx)}
                    style={{ borderRadius: 0, whiteSpace: "nowrap" }}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div
                id="variant-panel"
                role="tabpanel"
                aria-labelledby={`variant-tab-${activeTab}`}
                style={{
                  flex: 1,
                  padding: "var(--sp-5)",
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--sp-4)",
                }}
              >
                {/* ── Headline ── */}
                {activeTab === "Headline" && draft && (
                  <SectionCard
                    title="Headline"
                    hint={editMode ? `${draft.headline.length} / 220 chars` : undefined}
                    action={<EditToggle editing={editMode} onToggle={() => setEditMode((v) => !v)} />}
                  >
                    {editMode ? (
                      <Input
                        id="var-headline"
                        type="text"
                        value={draft.headline}
                        onChange={(e) => setDraft((d) => d && { ...d, headline: e.target.value })}
                        maxLength={220}
                      />
                    ) : (
                      <ReadText value={draft.headline} />
                    )}
                  </SectionCard>
                )}

                {/* ── Summary ── */}
                {activeTab === "Summary" && draft && (
                  <SectionCard
                    title="Professional Summary"
                    hint="3-5 sentence summary tailored to this variant's target role."
                    action={<EditToggle editing={editMode} onToggle={() => setEditMode((v) => !v)} />}
                  >
                    {editMode ? (
                      <Textarea
                        id="var-summary"
                        rows={8}
                        value={draft.summary}
                        onChange={(e) => setDraft((d) => d && { ...d, summary: e.target.value })}
                        style={{ resize: "vertical" }}
                      />
                    ) : (
                      <ReadText value={draft.summary} />
                    )}
                  </SectionCard>
                )}

                {/* ── About ── */}
                {activeTab === "About" && draft && (
                  <SectionCard
                    title="LinkedIn About"
                    hint={
                      editMode
                        ? `${draft.aboutText.length} / 2600 chars · synced to LinkedIn About section`
                        : "Synced to your LinkedIn About section."
                    }
                    action={<EditToggle editing={editMode} onToggle={() => setEditMode((v) => !v)} />}
                  >
                    {editMode ? (
                      <Textarea
                        id="var-about"
                        rows={10}
                        value={draft.aboutText}
                        onChange={(e) => setDraft((d) => d && { ...d, aboutText: e.target.value })}
                        style={{ resize: "vertical" }}
                      />
                    ) : (
                      <ReadText value={draft.aboutText} />
                    )}
                  </SectionCard>
                )}

                {/* ── Keywords ── */}
                {activeTab === "Keywords" && draft && (
                  <SectionCard
                    title="ATS Keywords"
                    hint="Matched against job descriptions for relevance scoring."
                    action={<EditToggle editing={editMode} onToggle={() => setEditMode((v) => !v)} />}
                  >
                    {editMode && (
                      <Textarea
                        id="var-keywords"
                        rows={4}
                        value={draft.keywords}
                        onChange={(e) => setDraft((d) => d && { ...d, keywords: e.target.value })}
                        style={{
                          resize: "vertical",
                          fontFamily: "var(--font-mono)",
                          fontSize: "var(--text-xs)",
                          marginBottom: "var(--sp-3)",
                        }}
                      />
                    )}
                    {draft.keywords.trim() ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1)" }}>
                        {draft.keywords
                          .split(",")
                          .map((kw) => kw.trim())
                          .filter(Boolean)
                          .map((kw) => (
                            <span key={kw} className="tag">
                              {kw}
                            </span>
                          ))}
                      </div>
                    ) : (
                      <ReadText value="" />
                    )}
                  </SectionCard>
                )}

                {/* ── Skills (order) ── */}
                {activeTab === "Skills" && (
                  <SectionCard
                    title="Skills"
                    hint="Listed top-to-bottom in priority order for this variant."
                  >
                    {selected.skills.length === 0 ? (
                      <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
                        No skills in this variant.
                      </p>
                    ) : (
                      <ol
                        style={{
                          margin: 0,
                          padding: 0,
                          listStyle: "none",
                          display: "flex",
                          flexDirection: "column",
                          gap: "var(--sp-1)",
                        }}
                      >
                        {selected.skills.map((skill, i) => (
                          <li
                            key={skill}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "var(--sp-3)",
                              padding: "var(--sp-2) var(--sp-3)",
                              background: "var(--color-surface-2)",
                              border: "1px solid var(--color-border)",
                              borderRadius: "var(--radius-sm)",
                            }}
                          >
                            <span
                              style={{
                                fontSize: "var(--text-xs)",
                                fontWeight: "var(--fw-semibold)",
                                color: "var(--color-text-muted)",
                                fontFamily: "var(--font-mono)",
                                minWidth: "1.5rem",
                                textAlign: "right",
                              }}
                            >
                              {i + 1}
                            </span>
                            <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text)" }}>
                              {skill}
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </SectionCard>
                )}

                {/* ── Experience (structured) ── */}
                {activeTab === "Experience" && selectedDto && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
                    <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
                      Structured experience for this variant — role, employer, location, dates, and
                      achievement bullets.
                    </p>
                    {selectedDto.experience.length === 0 ? (
                      <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
                        No experience entries in this variant.
                      </p>
                    ) : (
                      selectedDto.experience.map((entry, i) => (
                        <EntryCard
                          key={i}
                          title={entry.title}
                          subParts={[entry.organization, entry.location, entry.dates]}
                          bullets={entry.bullets}
                        />
                      ))
                    )}
                  </div>
                )}

                {/* ── Education (structured) ── */}
                {activeTab === "Education" && selectedDto && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
                    <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
                      Degrees and certifications — institution, location, dates, and coursework.
                    </p>
                    {selectedDto.education.length === 0 ? (
                      <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
                        No education entries in this variant.
                      </p>
                    ) : (
                      selectedDto.education.map((entry, i) => (
                        <EntryCard
                          key={i}
                          title={entry.degree}
                          subParts={[entry.institution, entry.location, entry.dates]}
                          bullets={entry.bullets}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>
              {/* ── Save bar ── */}
              {draft && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--sp-3)",
                    padding: "var(--sp-3) var(--sp-5)",
                    borderTop: "1px solid var(--color-border)",
                    flexShrink: 0,
                  }}
                >
                  {saveError && (
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--color-danger, #c0392b)", flex: 1 }}>
                      {saveError}
                    </span>
                  )}
                  <div style={{ flex: 1 }} />
                  <Button variant="primary" size="sm" disabled={isSaving} onClick={() => void saveVariant()}>
                    {isSaving ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              )}
              {/* Sync/Fill/auto-connect panels moved to the Command Center's
                  platform-icon menu — click a platform icon there to run them. */}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
