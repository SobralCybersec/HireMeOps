import { ProfileVariantsView } from "./profile-variants/ProfileVariantsView";
import { useProfileVariantsController } from "./profile-variants/useProfileVariantsController";

export function ProfileVariants() {
  return <ProfileVariantsView model={useProfileVariantsController()} />;
}
