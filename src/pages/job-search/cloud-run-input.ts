import type { CloudRunInput, JobFilters, SearchQueryDto } from "../../types/domain";

export function buildLinkedInCloudRunInput(
  profileId: string,
  query: SearchQueryDto,
  filters: JobFilters,
): CloudRunInput {
  const normalizedProfileId = profileId.trim();
  if (!normalizedProfileId) throw new Error("Select a profile first.");
  if (query.profileId !== normalizedProfileId) {
    throw new Error("Search query belongs to a different profile.");
  }
  if (query.platform !== "linkedin") {
    throw new Error("Cloud search currently requires a LinkedIn query.");
  }

  return {
    profileId: normalizedProfileId,
    intent: "search_jobs",
    queryPlan: {
      platform: "linkedin",
      command: "search_jobs",
      args: {
        keywords: query.query,
        location: filters.locations[0] ?? "",
        page_index: 0,
        filters: {
          easy_apply_only: false,
          remote_only: filters.remoteModes.some((mode) => mode.toLowerCase().includes("remote")),
        },
      },
    },
  };
}
