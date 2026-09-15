import React from "react";
import { Button, Dropdown, Field, Input, Select, Textarea } from "../../components/ui";
import { TABS, rewriteLabel, type EditDraft } from "./model";
import { VariantSaveBar } from "./VariantSaveBar";
import { VariantEducationTab, VariantExperienceTab } from "./ProfileVariantHistoryTabs";
import type { useProfileVariantsController } from "./useProfileVariantsController";

type ProfileVariantsModel = ReturnType<typeof useProfileVariantsController>;

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
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--sp-1)",
            flex: 1,
            minWidth: 0,
          }}
        >
          <span style={{ fontSize: "var(--text-sm)", fontWeight: "var(--fw-semibold)" }}>
            {title}
          </span>
          {hint && (
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
              {hint}
            </span>
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
  if (!v)
    return <span style={{ color: "var(--color-text-muted)", fontSize: "var(--text-sm)" }}>—</span>;
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

function VariantHeader({ model }: { model: ProfileVariantsModel }) {
  const {
    variants,
    selectedId,
    selectVariant,
    selectedDto,
    isDeleting,
    handleDeleteVariant,
    activeProfileId,
    creating,
    openCreateForm,
    setCreating,
  } = model;
  return (
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
  );
}

function VariantCreateForm({ model }: { model: ProfileVariantsModel }) {
  if (!model.creating) return null;
  return (
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
      <VariantCreateFileFields model={model} />
      <VariantRewritePicker model={model} />
      <VariantCreateStatus model={model} />
    </div>
  );
}

function VariantCreateFileFields({ model }: { model: ProfileVariantsModel }) {
  return (
    <>
      <VariantDocField model={model} />
      <VariantLanguageButtons model={model} />
      <VariantNameField model={model} />
      <VariantBuildButton model={model} />
    </>
  );
}

function VariantDocField({ model }: { model: ProfileVariantsModel }) {
  const { formLoading, docs, pickedDocId, handleDocChange, submitting } = model;
  return (
    <Field label="CV file" htmlFor="doc-pick" style={{ flex: "1 1 200px", margin: 0 }}>
      <Select
        id="doc-pick"
        value={pickedDocId}
        onChange={(event) => handleDocChange(event.target.value)}
        disabled={formLoading || submitting}
        placeholder={formLoading ? "Loading…" : docs.length === 0 ? "No files uploaded" : undefined}
        options={docs.map((doc) => ({ value: doc.id, label: doc.fileName }))}
      />
    </Field>
  );
}

function VariantLanguageButtons({ model }: { model: ProfileVariantsModel }) {
  const { language, handleLanguageChange, submitting } = model;
  return (
    <div
      style={{ display: "flex", gap: "var(--sp-1)", alignSelf: "flex-end", paddingBottom: "1px" }}
    >
      <Button
        size="sm"
        variant={language === "pt" ? "primary" : "ghost"}
        disabled={submitting}
        onClick={() => handleLanguageChange("pt")}
        title="Portuguese"
      >
        PT
      </Button>
      <Button
        size="sm"
        variant={language === "en" ? "primary" : "ghost"}
        disabled={submitting}
        onClick={() => handleLanguageChange("en")}
        title="English"
      >
        EN
      </Button>
    </div>
  );
}

function VariantNameField({ model }: { model: ProfileVariantsModel }) {
  const { newVariantName, setNewVariantName, submitting } = model;
  return (
    <Field
      label="Variant name (optional)"
      htmlFor="var-name-input"
      style={{ flex: "1 1 160px", margin: 0 }}
    >
      <Input
        id="var-name-input"
        type="text"
        placeholder="e.g. Senior Backend Eng"
        value={newVariantName}
        onChange={(event) => setNewVariantName(event.target.value)}
        disabled={submitting}
      />
    </Field>
  );
}

function VariantBuildButton({ model }: { model: ProfileVariantsModel }) {
  const { pickedDocId, submitting, formLoading, buildFromFile, submitStatus } = model;
  return (
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
  );
}

function VariantRewritePicker({ model }: { model: ProfileVariantsModel }) {
  const {
    docRewrites,
    pickedRewriteId,
    setPickedRewriteId,
    formLoading,
    submitting,
    buildFromRewrite,
  } = model;
  if (docRewrites.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: "var(--sp-2)",
        flex: "1 1 260px",
      }}
    >
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
  );
}

function VariantCreateStatus({ model }: { model: ProfileVariantsModel }) {
  const { storeError, submitting, submitStatus } = model;
  if (!storeError && (submitting || !submitStatus)) return null;
  return (
    <p
      style={{
        width: "100%",
        margin: 0,
        fontSize: "var(--text-xs)",
        color: "var(--color-error)",
      }}
    >
      {storeError || submitStatus}
    </p>
  );
}

function VariantTabBar({ model }: { model: ProfileVariantsModel }) {
  const { activeTab, setActiveTab, handleTabKey } = model;
  return (
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
      {TABS.map((tab, index) => (
        <VariantTabButton
          key={tab}
          tab={tab}
          active={activeTab === tab}
          onSelect={() => setActiveTab(tab)}
          onKeyDown={(event) => handleTabKey(event, index)}
        />
      ))}
    </div>
  );
}

function VariantTabButton({
  tab,
  active,
  onSelect,
  onKeyDown,
}: {
  tab: (typeof TABS)[number];
  active: boolean;
  onSelect: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      id={`variant-tab-${tab}`}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls="variant-panel"
      tabIndex={active ? 0 : -1}
      className={active ? "filter-tab active" : "filter-tab"}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      style={{ borderRadius: 0, whiteSpace: "nowrap" }}
    >
      {tab}
    </button>
  );
}

function VariantTabContent({ model }: { model: ProfileVariantsModel }) {
  return (
    <>
      <VariantHeadlineTab model={model} />
      <VariantSummaryTab model={model} />
      <VariantAboutTab model={model} />
      <VariantKeywordsTab model={model} />
      <VariantSkillsTab model={model} />
      <VariantExperienceTab model={model} />
      <VariantEducationTab model={model} />
    </>
  );
}

function VariantHeadlineTab({ model }: { model: ProfileVariantsModel }) {
  const { activeTab, draft, editMode, setEditMode } = model;
  if (activeTab !== "Headline" || draft === null) return null;
  return (
    <SectionCard
      title="Headline"
      hint={editMode ? `${draft.headline.length} / 220 chars` : undefined}
      action={<EditToggle editing={editMode} onToggle={() => setEditMode((v) => !v)} />}
    >
      <VariantHeadlineBody model={model} />
    </SectionCard>
  );
}

function VariantSummaryTab({ model }: { model: ProfileVariantsModel }) {
  const { activeTab, draft, editMode, setEditMode } = model;
  if (activeTab !== "Summary" || draft === null) return null;
  return (
    <SectionCard
      title="Professional Summary"
      hint="3-5 sentence summary tailored to this variant's target role."
      action={<EditToggle editing={editMode} onToggle={() => setEditMode((v) => !v)} />}
    >
      <VariantSummaryBody model={model} />
    </SectionCard>
  );
}

function VariantHeadlineBody({ model }: { model: ProfileVariantsModel }) {
  const { draft, editMode, setDraft } = model;
  if (draft === null) return null;
  return editMode ? (
    <Input
      id="var-headline"
      type="text"
      value={draft.headline}
      onChange={draftChangeHandler(setDraft, "headline")}
      maxLength={220}
    />
  ) : (
    <ReadText value={draft.headline} />
  );
}

function VariantSummaryBody({ model }: { model: ProfileVariantsModel }) {
  const { draft, editMode, setDraft } = model;
  if (draft === null) return null;
  return editMode ? (
    <Textarea
      id="var-summary"
      rows={8}
      value={draft.summary}
      onChange={draftChangeHandler(setDraft, "summary")}
      style={{ resize: "vertical" }}
    />
  ) : (
    <ReadText value={draft.summary} />
  );
}

function VariantAboutTab({ model }: { model: ProfileVariantsModel }) {
  const { activeTab, draft, editMode, setEditMode, setDraft } = model;
  if (activeTab !== "About" || draft === null) return null;
  return (
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
  );
}

function VariantKeywordsTab({ model }: { model: ProfileVariantsModel }) {
  const { activeTab, draft, editMode, setEditMode } = model;
  if (activeTab !== "Keywords" || draft === null) return null;
  return (
    <SectionCard
      title="ATS Keywords"
      hint="Matched against job descriptions for relevance scoring."
      action={<EditToggle editing={editMode} onToggle={() => setEditMode((v) => !v)} />}
    >
      <VariantKeywordsBody model={model} />
    </SectionCard>
  );
}

function VariantKeywordsBody({ model }: { model: ProfileVariantsModel }) {
  const { draft, editMode, setDraft } = model;
  if (draft === null) return null;
  return (
    <>
      <VariantKeywordsInput
        draft={draft}
        editMode={editMode}
        onChange={(keywords) =>
          setDraft((current) => (current ? { ...current, keywords } : current))
        }
      />
      <VariantKeywordTags keywords={draft.keywords} />
    </>
  );
}

function VariantKeywordsInput({
  draft,
  editMode,
  onChange,
}: {
  draft: { keywords: string };
  editMode: boolean;
  onChange: (keywords: string) => void;
}) {
  if (!editMode) return null;
  return (
    <Textarea
      id="var-keywords"
      rows={4}
      value={draft.keywords}
      onChange={(event) => onChange(event.target.value)}
      style={{
        resize: "vertical",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-xs)",
        marginBottom: "var(--sp-3)",
      }}
    />
  );
}

function VariantKeywordTags({ keywords }: { keywords: string }) {
  const tags = keywords
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  if (tags.length === 0) return <ReadText value="" />;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1)" }}>
      {tags.map((keyword) => (
        <span key={keyword} className="tag">
          {keyword}
        </span>
      ))}
    </div>
  );
}

type DraftSetter = React.Dispatch<React.SetStateAction<EditDraft | null>>;

function draftChangeHandler(setDraft: DraftSetter, field: "headline" | "summary") {
  return (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setDraft((current) => (current ? { ...current, [field]: event.target.value } : current));
  };
}

function VariantSkillsTab({ model }: { model: ProfileVariantsModel }) {
  const { activeTab, selected } = model;
  if (activeTab !== "Skills" || selected === null) return null;
  if (selected === null) return null;
  return (
    <SectionCard title="Skills" hint="Listed top-to-bottom in priority order for this variant.">
      {selected.skills.length === 0 ? (
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-xs)",
            color: "var(--color-text-muted)",
          }}
        >
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
  );
}

function VariantEditor({ model }: { model: ProfileVariantsModel }) {
  const { selected, isLoading, variants } = model;
  return (
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
            <VariantTabBar model={model} />
            <div
              id="variant-panel"
              role="tabpanel"
              aria-labelledby={`variant-tab-${model.activeTab}`}
              style={{
                flex: 1,
                padding: "var(--sp-5)",
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: "var(--sp-4)",
              }}
            >
              <VariantTabContent model={model} />
            </div>
            <VariantSaveBar model={model} />
          </div>
        )}
      </div>
    </div>
  );
}

export function ProfileVariantsView({ model }: { model: ProfileVariantsModel }) {
  return (
    <div className="page page--fill" style={{ padding: 0 }}>
      <VariantHeader model={model} />
      <VariantCreateForm model={model} />
      <VariantEditor model={model} />
    </div>
  );
}
