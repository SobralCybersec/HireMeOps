import React, { useEffect, useMemo, useState } from "react";
import { Button, Field, Input, Select, Textarea } from "../components/ui";
import { useProfileStore } from "../stores/useProfileStore";
import { useProfileVariantStore } from "../stores/useProfileVariantStore";
import { LinkedInSyncPanel } from "../components/LinkedInSyncPanel";
import type { ProfileVariantDto } from "../types/domain";
import { invokeStrict } from "../lib/tauriInvoke";
import { loadCvRewrites } from "./cv/rewrite";
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
  projects: string[];
  bullets: string;
}

interface EditDraft {
  name: string;
  headline: string;
  summary: string;
  aboutText: string;
  keywords: string; // comma-separated textarea value
}

const TABS = ["Headline", "Summary", "About", "Keywords", "CV", "Skills", "Projects", "Bullets", "Education"] as const;
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
    projects: dto.positions,
    bullets: dto.experience.flatMap((e) => e.bullets).join("\n"),
  };
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
  const [activeTab, setActiveTab] = useState<Tab>("Headline");
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

  async function submitCreateVariant() {
    if (!activeProfileId || !pickedDocId) return;
    setSubmitting(true);
    setSubmitStatus("");

    try {
      if (pickedRewriteId) {
        // Existing rewrite — fast path through the store
        setSubmitStatus("Creating variant…");
        const result = await createVariant(activeProfileId, pickedRewriteId, newVariantName || undefined);
        if (result) setCreating(false);
      } else {
        // No rewrite yet — single backend call that rewrites + creates atomically
        setSubmitStatus("Rewriting CV with AI…");
        const variant = await invokeStrict<ProfileVariantDto>("create_variant_from_document", {
          profileId: activeProfileId,
          cvDocumentId: pickedDocId,
          name: newVariantName || null,
          language,
        });
        // Inject into the store without a re-fetch
        useProfileVariantStore.setState((s) => ({
          variants: [variant, ...s.variants.filter((v) => v.id !== variant.id)],
          selectedId: variant.id,
          syncPlan: null,
          planError: null,
        }));
        setCreating(false);
      }
    } catch (err) {
      setSubmitStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
      if (!pickedRewriteId) setSubmitStatus(""); // clear status on success path
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

  // Reset draft whenever the user switches to a different variant.
  useEffect(() => {
    setDraft(selectedDto ? draftFromDto(selectedDto) : null);
    setSaveError(null);
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
        <div className="toolbar-spacer" />
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

          {/* Step 2: existing rewrite for the selected language (optional — auto-generates if absent) */}
          {docRewrites.length > 0 && (
            <Field
              label={`${language.toUpperCase()} Rewrite`}
              htmlFor="rewrite-pick"
              style={{ flex: "1 1 200px", margin: 0 }}
            >
              <Select
                id="rewrite-pick"
                value={pickedRewriteId}
                onChange={(e) => setPickedRewriteId(e.target.value)}
                disabled={formLoading || submitting}
                options={docRewrites.map((r) => ({
                  value: r.id,
                  label: `${r.modelProvider}${r.variantName ? ` · ${r.variantName}` : ""}`,
                }))}
              />
            </Field>
          )}

          {/* Language toggle — filters existing rewrites by language; new auto-rewrites use this too */}
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

          <Button
            variant="primary"
            size="sm"
            disabled={!pickedDocId || submitting || formLoading}
            onClick={() => void submitCreateVariant()}
            style={{ flexShrink: 0 }}
          >
            {submitting
              ? submitStatus || "Working…"
              : docRewrites.length === 0 && pickedDocId
                ? "Rewrite & Create"
                : "Create Variant"}
          </Button>

          {(storeError || (!submitting && submitStatus)) && (
            <p style={{ width: "100%", margin: 0, fontSize: "var(--text-xs)", color: "var(--color-error)" }}>
              {storeError || submitStatus}
            </p>
          )}
        </div>
      )}

      <div
        className="two-pane"
        style={{
          flex: 1,
          borderRadius: 0,
          border: "none",
          borderTop: "1px solid var(--color-border)",
        }}
      >
        {/* ── Variant list ── */}
        <div className="two-pane__list">
          <div className="two-pane__list-header">
            <span
              style={{
                fontSize: "var(--text-2xs)",
                fontWeight: "var(--fw-semibold)",
                letterSpacing: "0.10em",
                textTransform: "uppercase",
                color: "var(--color-text-muted)",
              }}
            >
              Variants
            </span>
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {variants.length === 0 && (
              <li className="list-item" aria-disabled="true" style={{ cursor: "default" }}>
                <div className="list-item__meta">
                  {isLoading
                    ? "Loading variants…"
                    : "No variants yet. Generate one from a CV rewrite."}
                </div>
              </li>
            )}
            {variants.map((v) => (
              <li
                key={v.id}
                className={selectedId === v.id ? "list-item selected" : "list-item"}
                onClick={() => selectVariant(v.id)}
                tabIndex={0}
                role="button"
                aria-pressed={selectedId === v.id}
                onKeyDown={(e) => {
                  if (e.key === "Enter") selectVariant(v.id);
                }}
              >
                <div>
                  <div className="list-item__name">{v.name}</div>
                  <div className="list-item__meta">{v.keywords.slice(0, 3).join(", ")}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* ── Editor ── */}
        <div className="two-pane__detail" style={{ padding: 0 }}>
          {selected === null ? (
            <div className="empty-state">
              <p className="empty-state__title">No variant selected</p>
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
                  <Field
                    label="Headline"
                    htmlFor="var-headline"
                    helper={`${draft.headline.length} / 220 chars`}
                  >
                    <Input
                      id="var-headline"
                      type="text"
                      value={draft.headline}
                      onChange={(e) => setDraft((d) => d && { ...d, headline: e.target.value })}
                      maxLength={220}
                    />
                  </Field>
                )}

                {/* ── Summary ── */}
                {activeTab === "Summary" && draft && (
                  <Field
                    label="Professional Summary"
                    htmlFor="var-summary"
                    helper="3-5 sentence summary tailored to this variant's target role."
                  >
                    <Textarea
                      id="var-summary"
                      rows={8}
                      value={draft.summary}
                      onChange={(e) => setDraft((d) => d && { ...d, summary: e.target.value })}
                      style={{ resize: "vertical" }}
                    />
                  </Field>
                )}

                {/* ── About ── */}
                {activeTab === "About" && draft && (
                  <Field
                    label="LinkedIn About"
                    htmlFor="var-about"
                    helper={`${draft.aboutText.length} / 2600 chars · synced to LinkedIn About section`}
                  >
                    <Textarea
                      id="var-about"
                      rows={10}
                      value={draft.aboutText}
                      onChange={(e) => setDraft((d) => d && { ...d, aboutText: e.target.value })}
                      style={{ resize: "vertical" }}
                    />
                  </Field>
                )}

                {/* ── Keywords ── */}
                {activeTab === "Keywords" && draft && (
                  <>
                    <Field
                      label="ATS Keywords"
                      htmlFor="var-keywords"
                      helper="Comma-separated. Matched against job descriptions for relevance scoring."
                    >
                      <Textarea
                        id="var-keywords"
                        rows={4}
                        value={draft.keywords}
                        onChange={(e) => setDraft((d) => d && { ...d, keywords: e.target.value })}
                        style={{ resize: "vertical", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}
                      />
                    </Field>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1)" }}>
                      {draft.keywords.split(",").map((kw) => kw.trim()).filter(Boolean).map((kw) => (
                        <span key={kw} className="tag">{kw}</span>
                      ))}
                    </div>
                  </>
                )}

                {/* ── CV (Preferred CV) ── */}
                {activeTab === "CV" && (
                  <>
                    <Field
                      label="Preferred CV"
                      htmlFor="var-preferred-cv"
                      helper="Preferred CV for this variant. Auto-apply still selects the highest-match CV unless explicitly overridden here. Requires CV Library backend."
                    >
                      <Select
                        id="var-preferred-cv"
                        value=""
                        disabled
                        placeholder="- no CV selected -"
                        options={[]}
                      />
                    </Field>
                    <div
                      style={{
                        padding: "var(--sp-3) var(--sp-4)",
                        background: "var(--color-surface-2)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "var(--radius-md)",
                        fontSize: "var(--text-xs)",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      Upload and parse CVs in the CV Library, then assign them to variants here.
                    </div>
                  </>
                )}

                {/* ── Skills (order) ── */}
                {activeTab === "Skills" && (
                  <>
                    <div>
                      <p className="field__label" style={{ marginBottom: "var(--sp-1)" }}>
                        Skills Order
                      </p>
                      <p
                        style={{
                          margin: "0 0 var(--sp-3)",
                          fontSize: "var(--text-xs)",
                          color: "var(--color-text-muted)",
                        }}
                      >
                        Skills are listed top-to-bottom in priority order for this variant.
                        Reordering requires backend connection.
                      </p>
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
                            <span
                              style={{
                                fontSize: "var(--text-sm)",
                                color: "var(--color-text)",
                              }}
                            >
                              {skill}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </>
                )}

                {/* ── Projects (priority) ── */}
                {activeTab === "Projects" && (
                  <>
                    <div>
                      <p className="field__label" style={{ marginBottom: "var(--sp-1)" }}>
                        Projects Priority
                      </p>
                      <p
                        style={{
                          margin: "0 0 var(--sp-3)",
                          fontSize: "var(--text-xs)",
                          color: "var(--color-text-muted)",
                        }}
                      >
                        Projects are presented in this order when included in CV generation for this
                        variant. Reordering requires backend connection.
                      </p>
                      <ol
                        style={{
                          margin: 0,
                          padding: 0,
                          listStyle: "none",
                          display: "flex",
                          flexDirection: "column",
                          gap: "var(--sp-2)",
                        }}
                      >
                        {selected.projects.map((proj, i) => (
                          <li
                            key={proj}
                            style={{
                              display: "flex",
                              gap: "var(--sp-3)",
                              padding: "var(--sp-3)",
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
                                paddingTop: "2px",
                                flexShrink: 0,
                              }}
                            >
                              {i + 1}
                            </span>
                            <span
                              style={{
                                fontSize: "var(--text-sm)",
                                color: "var(--color-text)",
                              }}
                            >
                              {proj}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </>
                )}

                {/* ── Bullets (experience) ── */}
                {activeTab === "Bullets" && (
                  <Field
                    label="Experience Bullets"
                    htmlFor="var-bullets"
                    helper="Role-specific achievement bullets for this variant's experience section. One bullet per line."
                  >
                    <Textarea
                      id="var-bullets"
                      rows={8}
                      defaultValue={selected.bullets}
                      readOnly
                      aria-readonly="true"
                      style={{
                        resize: "vertical",
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--text-xs)",
                      }}
                    />
                  </Field>
                )}

                {/* ── Education ── */}
                {activeTab === "Education" && selectedDto && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
                    {selectedDto.education.length === 0 ? (
                      <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
                        No education entries in this variant.
                      </p>
                    ) : selectedDto.education.map((entry, i) => (
                      <div
                        key={i}
                        style={{
                          border: "1px solid var(--color-border)",
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
                            borderBottom: entry.bullets.length > 0 ? "1px solid var(--color-border)" : undefined,
                          }}
                        >
                          <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--fw-semibold)" }}>
                            {entry.degree || "—"}
                          </span>
                          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
                            {[entry.institution, entry.location, entry.dates].filter(Boolean).join(" · ")}
                          </span>
                        </div>
                        {entry.bullets.length > 0 && (
                          <ul style={{ margin: 0, padding: "var(--sp-3) var(--sp-4) var(--sp-3) var(--sp-6)", display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
                            {entry.bullets.map((b, j) => (
                              <li key={j} style={{ fontSize: "var(--text-xs)", color: "var(--color-text)" }}>
                                {b}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
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
              {selectedDto && <LinkedInSyncPanel variant={selectedDto} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
