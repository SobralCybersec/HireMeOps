import { Button } from "../components/ui";

interface ProfilesPageHeaderProps {
  count: number;
  creating: boolean;
  onCreate: () => void;
}

export function ProfilesPageHeader({ count, creating, onCreate }: ProfilesPageHeaderProps) {
  return (
    <header className="profiles-hero">
      <div>
        <p className="profiles-eyebrow">PROFILE WORKSPACE / 01</p>
        <h1 className="profiles-hero__title">Profile workspace</h1>
        <p className="profiles-hero__lede">
          Build focused identities for every kind of opportunity. Keep your answers, links, and
          browser sessions ready to reuse.
        </p>
      </div>
      <div className="profiles-hero__actions">
        <div className="profiles-hero__metric">
          <strong>{count.toString().padStart(2, "0")}</strong>
          <span>saved profiles</span>
        </div>
        <Button variant="primary" onClick={() => void onCreate()} disabled={creating}>
          {creating ? "Creating…" : "+ New profile"}
        </Button>
      </div>
    </header>
  );
}
