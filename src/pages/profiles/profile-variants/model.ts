import type { CvRewriteSummary } from "../cv/types";
import type { ProfileVariantDto } from "../../types/domain";

export interface Variant {
  id: string;
  name: string;
  headline: string;
  summary: string;
  aboutText: string;
  keywords: string[];
  skills: string[];
}

export interface EditDraft {
  name: string;
  headline: string;
  summary: string;
  aboutText: string;
  keywords: string;
}

export const TABS = [
  "Headline",
  "Summary",
  "About",
  "Keywords",
  "Skills",
  "Experience",
  "Education",
] as const;
export type Tab = (typeof TABS)[number];

export function toVariantView(dto: ProfileVariantDto): Variant {
  return {
    id: dto.id,
    name: dto.name,
    headline: dto.headline,
    summary: dto.summary,
    aboutText: dto.aboutText,
    keywords: dto.keywords,
    skills: dto.skills
      .map((group) => (group.category ? `${group.category}: ${group.skills}` : group.skills))
      .filter((line) => line.trim().length > 0),
  };
}

export function rewriteLabel(rewrite: CvRewriteSummary): string {
  const when = new Date(rewrite.createdAt).toLocaleDateString();
  const name = rewrite.variantName?.trim();
  return name ? `${name} · ${when}` : `GPT rewrite · ${when}`;
}

export function draftFromDto(dto: ProfileVariantDto): EditDraft {
  return {
    name: dto.name,
    headline: dto.headline,
    summary: dto.summary,
    aboutText: dto.aboutText,
    keywords: dto.keywords.join(", "),
  };
}

function changedValue(value: string, original: string): string | undefined {
  return value !== original ? value : undefined;
}

export function variantUpdateInput(draft: EditDraft, current: ProfileVariantDto) {
  return {
    name: changedValue(draft.name, current.name),
    headline: changedValue(draft.headline, current.headline),
    summary: changedValue(draft.summary, current.summary),
    aboutText: changedValue(draft.aboutText, current.aboutText),
    keywords: changedValue(draft.keywords, current.keywords.join(", ")),
  };
}
