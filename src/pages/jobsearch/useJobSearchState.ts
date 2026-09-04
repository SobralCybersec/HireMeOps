import { useState } from "react";
import type { JobPostDto } from "../../types/domain";
import type { ContactFilter, FilterStatus } from "./job-search-types";

export function useJobSearchState() {
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [workModeFilter, setWorkModeFilter] = useState<"all" | "remote" | "hybrid" | "onsite">(
    "all",
  );
  const [platformFilter, setPlatformFilter] = useState("All");
  const [locationFilter, setLocationFilter] = useState("");
  const [wordsFilter, setWordsFilter] = useState("");
  const [minScore, setMinScore] = useState<number | "">("");
  const [runningAll, setRunningAll] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<JobPostDto | null>(null);
  const [mobilePane, setMobilePane] = useState<"filters" | "jobs" | "detail">("jobs");
  const [draftModalOpen, setDraftModalOpen] = useState(false);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [indeedParked, setIndeedParked] = useState(false);
  const [linkedinParked, setLinkedinParked] = useState(false);
  const [hideDuplicates, setHideDuplicates] = useState(true);
  const [contactFilter, setContactFilter] = useState<ContactFilter>("all");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

  return {
    statusFilter,
    setStatusFilter,
    workModeFilter,
    setWorkModeFilter,
    platformFilter,
    setPlatformFilter,
    locationFilter,
    setLocationFilter,
    wordsFilter,
    setWordsFilter,
    minScore,
    setMinScore,
    runningAll,
    setRunningAll,
    showManual,
    setShowManual,
    showPreferences,
    setShowPreferences,
    selectedId,
    setSelectedId,
    selectedDetail,
    setSelectedDetail,
    mobilePane,
    setMobilePane,
    draftModalOpen,
    setDraftModalOpen,
    searchMsg,
    setSearchMsg,
    removingId,
    setRemovingId,
    isApplying,
    setIsApplying,
    indeedParked,
    setIndeedParked,
    linkedinParked,
    setLinkedinParked,
    hideDuplicates,
    setHideDuplicates,
    contactFilter,
    setContactFilter,
    selectedSkills,
    setSelectedSkills,
  };
}

export type JobSearchState = ReturnType<typeof useJobSearchState>;
