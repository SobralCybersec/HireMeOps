import { useState } from "react";
import { ApplicationsQueueView } from "./ApplicationsQueueView";
import type { FilterKey } from "./ApplicationsQueueModel";
import { useApplicationsQueueModel } from "./useApplicationsQueueModel";

export function ApplicationsQueue() {
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const model = useApplicationsQueueModel(activeFilter);
  const { start, pause, resume, stop, handleConfirm, handleDiscard, clearError, ...view } = model;
  return (
    <ApplicationsQueueView
      {...view}
      activeFilter={activeFilter}
      onStart={() => void start()}
      onPause={() => void pause()}
      onResume={() => void resume()}
      onStop={() => void stop()}
      onConfirm={() => void handleConfirm()}
      onDiscard={() => void handleDiscard()}
      onClearError={clearError}
      onFilter={setActiveFilter}
    />
  );
}
