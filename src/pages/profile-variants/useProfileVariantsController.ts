import { useProfileVariantsActions } from "./useProfileVariantsActions";
import { useProfileVariantsData } from "./useProfileVariantsData";
import { useProfileVariantsState } from "./useProfileVariantsState";

export function useProfileVariantsController() {
  const state = useProfileVariantsState();
  const data = useProfileVariantsData(state);
  const actions = useProfileVariantsActions({ state, data });
  return { ...state, ...data, ...actions };
}
