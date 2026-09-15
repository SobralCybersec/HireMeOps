import { CommandCenterVariants } from "./command-center/CommandCenterVariant";
import { useCommandCenterController } from "./useCommandCenterController";
import "./CommandCenter.css";
import "./CommandCenterVariants.css";

export function CommandCenter() {
  const model = useCommandCenterController();
  return (
    <div
      data-impeccable-variants="b7f9f8f8"
      data-impeccable-variant-count="3"
      style={{ display: "contents" }}
    >
      <CommandCenterVariants {...model} />
    </div>
  );
}
