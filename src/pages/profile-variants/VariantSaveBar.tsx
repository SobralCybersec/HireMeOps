import { Button } from "../../components/ui";
import type { useProfileVariantsController } from "./useProfileVariantsController";

type ProfileVariantsModel = ReturnType<typeof useProfileVariantsController>;

export function VariantSaveBar({ model }: { model: ProfileVariantsModel }) {
  const { draft, saveError, isSaving, saveVariant } = model;
  if (draft === null) return null;
  return (
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
        <span
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--color-danger, #c0392b)",
            flex: 1,
          }}
        >
          {saveError}
        </span>
      )}
      <div style={{ flex: 1 }} />
      <Button variant="primary" size="sm" disabled={isSaving} onClick={() => void saveVariant()}>
        {isSaving ? "Saving…" : "Save changes"}
      </Button>
    </div>
  );
}
