import type { Profile } from "../types/domain";

export interface ProfileRailProps {
  profiles: Profile[];
  selected: Profile | null;
  activeProfileId: string | null;
  onSelect: (id: string) => void;
}

function profileInitials(name: string): string {
  const words = name.trim().split(new RegExp("\\s+")).filter(Boolean);
  return (
    words.length > 1
      ? `${words[0][0]}${words[words.length - 1][0]}`
      : (words[0]?.slice(0, 2) ?? "P")
  ).toUpperCase();
}

interface ProfileListItemProps {
  profile: Profile;
  selected: Profile | null;
  activeProfileId: string | null;
  onSelect: (id: string) => void;
}

function ProfileListItem(props: ProfileListItemProps) {
  const { profile, selected, activeProfileId, onSelect } = props;
  const isSelected = profile.id === selected?.id;
  const isActive = profile.id === activeProfileId;
  return (
    <button
      className={`profile-list__item${isSelected ? " is-selected" : ""}`}
      type="button"
      onClick={() => onSelect(profile.id)}
      aria-pressed={isSelected}
    >
      <span className="profile-list__avatar">{profileInitials(profile.name)}</span>
      <span className="profile-list__copy">
        <strong>{profile.name}</strong>
        <span>{isActive ? "Active for automation" : "Ready to configure"}</span>
      </span>
      {isActive && <span className="profile-list__dot" aria-label="Active" />}
    </button>
  );
}

export function ProfileRail({ profiles, selected, activeProfileId, onSelect }: ProfileRailProps) {
  return (
    <aside className="profiles-rail" aria-label="Saved profiles">
      <div className="profiles-rail__head">
        <div>
          <p className="profiles-eyebrow">IDENTITIES</p>
          <h2>Saved profiles</h2>
        </div>
        <span className="profiles-rail__count">{profiles.length}</span>
      </div>
      {profiles.length > 0 ? (
        <div className="profile-list">
          {profiles.map((profile) => (
            <ProfileListItem
              key={profile.id}
              {...{ profile, selected, activeProfileId, onSelect }}
            />
          ))}
        </div>
      ) : (
        <div className="profiles-rail__empty">
          <span>01</span>
          <p>Your first profile becomes your default automation identity.</p>
        </div>
      )}
      <div className="profiles-rail__note">
        <span className="profiles-rail__note-mark">↗</span>
        <p>One profile per job-search direction keeps applications consistent.</p>
      </div>
    </aside>
  );
}
