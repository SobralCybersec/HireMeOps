import type { JobStatus } from "../../types/domain";

export type FilterStatus = "all" | JobStatus;
export type ContactFilter = "all" | "email" | "phone" | "any";
export type WorkModeFilter = "all" | "remote" | "hybrid" | "onsite";
