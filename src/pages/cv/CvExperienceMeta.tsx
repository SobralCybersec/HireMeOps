import { Fragment } from "react";
import {
  Behance01Icon,
  GithubIcon,
  GitlabIcon,
  GlobeIcon,
  Linkedin01Icon,
  LinkSquare01Icon,
} from "@hugeicons/core-free-icons";
import { Icon } from "../../components/ui";
import type { CvExperienceEntry } from "./types";

const PLATFORMS = [
  { domain: "github.com", label: "GitHub", icon: GithubIcon },
  { domain: "github.io", label: "GitHub", icon: GithubIcon },
  { domain: "gitlab.com", label: "GitLab", icon: GitlabIcon },
  { domain: "gitlab.io", label: "GitLab", icon: GitlabIcon },
  { domain: "behance.net", label: "Behance", icon: Behance01Icon },
  { domain: "linkedin.com", label: "LinkedIn", icon: Linkedin01Icon },
];

function projectLink(raw?: string | null) {
  const value = (raw ?? "").trim();
  const href = value.match(/^\[[^\]]*\]\((.*)\)$/s)?.[1] || value;
  if (!href || /\s/.test(href)) return null;
  try {
    const url = new URL(href);
    if (!/^https?:$/.test(url.protocol)) return null;
    const platform = PLATFORMS.find(
      ({ domain }) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
    ) || { label: "Portfolio", icon: GlobeIcon };
    return { href, ...platform };
  } catch {
    return null;
  }
}

export function CvExperienceMeta({
  entry,
}: {
  entry: Pick<CvExperienceEntry, "organization" | "location" | "dates" | "url">;
}) {
  const link = projectLink(entry.url);
  const location = link ? (
    <a
      href={link.href}
      title={link.href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 align-middle"
    >
      <Icon icon={link.icon} size={14} aria-hidden="true" />
      {link.label}
      <Icon icon={LinkSquare01Icon} size={12} aria-hidden="true" />
    </a>
  ) : (
    entry.location
  );
  const parts = [entry.organization, location, entry.dates].filter(Boolean);
  return (
    <span className="cvx-compare__meta">
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && " · "}
          {part}
        </Fragment>
      ))}
    </span>
  );
}
