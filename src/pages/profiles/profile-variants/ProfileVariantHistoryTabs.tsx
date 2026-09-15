import { EducationEntries, ExperienceEntries } from "./EntryCards";
import type { useProfileVariantsController } from "./useProfileVariantsController";

type ProfileVariantsModel = ReturnType<typeof useProfileVariantsController>;

export function VariantEducationTab({ model }: { model: ProfileVariantsModel }) {
  const { activeTab, selectedDto } = model;
  if (activeTab !== "Education" || selectedDto === null) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
      <p
        style={{
          margin: 0,
          fontSize: "var(--text-xs)",
          color: "var(--color-text-muted)",
        }}
      >
        Degrees and certifications — institution, location, dates, and coursework.
      </p>
      <EducationEntries entries={selectedDto.education} />
    </div>
  );
}

export function VariantExperienceTab({ model }: { model: ProfileVariantsModel }) {
  const { activeTab, selectedDto } = model;
  if (activeTab !== "Experience" || selectedDto === null) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
      <p
        style={{
          margin: 0,
          fontSize: "var(--text-xs)",
          color: "var(--color-text-muted)",
        }}
      >
        Structured experience for this variant — role, employer, location, dates, and achievement
        bullets.
      </p>
      <ExperienceEntries entries={selectedDto.experience} />
    </div>
  );
}
