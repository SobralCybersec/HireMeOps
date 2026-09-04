import type { CvLibraryViewModel } from "../CvLibrary";
import { useCvLibraryActions } from "./useCvLibraryActions";
import { useCvLibraryData } from "./useCvLibraryData";
import { useCvLibraryDerived } from "./useCvLibraryDerived";
import { useCvLibraryState } from "./useCvLibraryState";

export function useCvLibraryController(): CvLibraryViewModel {
  const state = useCvLibraryState();
  useCvLibraryData(state);
  const derived = useCvLibraryDerived(state);
  const actions = useCvLibraryActions(state, derived);
  return { ...state, ...derived, ...actions };
}
