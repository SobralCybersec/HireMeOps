import type { CSSProperties, ReactNode, RefObject } from "react";
import { Button, EmptyState } from "./ui";

interface DraftModalBodyProps {
  isDrafting: boolean;
  error: string | null;
  draftId: string | null;
  runId: string | null;
  onRetry: () => void;
  onClose: () => void;
}

interface DraftModalFooterProps {
  isDrafting: boolean;
  isSubmitting: boolean;
  error: string | null;
  draftId: string | null;
  runId: string | null;
  onSubmit: () => void;
  onClose: () => void;
}

interface ApplicationDraftModalViewProps extends DraftModalBodyProps, DraftModalFooterProps {
  dialogRef: RefObject<HTMLDialogElement | null>;
  open: boolean;
}

const dialogStyle: CSSProperties = {
  width: "min(720px, 92vw)",
  maxWidth: "min(720px, 92vw)",
  maxHeight: "min(640px, 90dvh)",
  padding: 0,
  flexDirection: "column",
  overflow: "hidden",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  background: "var(--color-surface-2, var(--color-surface-1))",
  color: "var(--color-text-1)",
  boxShadow: "var(--shadow-1)",
};

const innerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  gap: "var(--sp-3)",
  padding: "var(--sp-4)",
};

const bodyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--sp-3)",
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
};

function errorActions(onRetry: () => void, onClose: () => void): ReactNode {
  return (
    <div
      className="application-draft-modal__actions"
      style={{ display: "flex", gap: "var(--sp-2)", justifyContent: "flex-end", flexWrap: "wrap" }}
    >
      <Button variant="primary" onClick={onRetry}>
        Retry
      </Button>
      <Button variant="ghost" onClick={onClose}>
        Cancel
      </Button>
    </div>
  );
}

function DraftModalBody(props: DraftModalBodyProps) {
  const { isDrafting, error, draftId, runId, onRetry, onClose } = props;
  if (isDrafting) {
    return (
      <EmptyState
        label="Working"
        title="Generating your draft..."
        body="The AI is composing your cover letter and form answers. This may take a moment."
      />
    );
  }
  if (error !== null) {
    return (
      <EmptyState
        label="Error"
        title="Application action failed"
        body={error}
        action={errorActions(onRetry, onClose)}
      />
    );
  }
  if (draftId === null) {
    return (
      <EmptyState
        label="Idle"
        title="No draft in progress"
        body="Close this dialog and try again."
      />
    );
  }
  return (
    <>
      <EmptyState
        label={runId === null ? "Ready" : "Queued"}
        title={runId === null ? "Draft created" : "Automation task queued"}
        body={
          runId === null
            ? "Your draft is saved. Queue it to open the job in the manual-assist browser flow."
            : "Start or resume Automation to process this application. Final submission still requires your review."
        }
      />
      <p
        className="application-draft-modal__id"
        aria-label="Draft ID"
        style={{
          margin: 0,
          fontSize: "var(--text-sm)",
          color: "var(--color-text-2)",
          wordBreak: "break-all",
        }}
      >
        Draft ID: <code>{draftId}</code>
      </p>
      {runId !== null && (
        <p className="application-draft-modal__id" aria-label="Run ID" style={{ margin: 0 }}>
          Run ID: <code>{runId}</code>
        </p>
      )}
    </>
  );
}

function DraftModalFooter(props: DraftModalFooterProps) {
  const { isDrafting, isSubmitting, error, draftId, runId, onSubmit, onClose } = props;
  if (!isDrafting && error !== null) return null;
  return (
    <div
      className="application-draft-modal__footer"
      style={{
        display: "flex",
        gap: "var(--sp-2)",
        justifyContent: "flex-end",
        flexWrap: "wrap",
        flexShrink: 0,
        paddingTop: "var(--sp-2)",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      {draftId !== null && runId === null && (
        <Button variant="primary" onClick={onSubmit} disabled={isSubmitting}>
          {isSubmitting ? "Queuing..." : "Queue for automation"}
        </Button>
      )}
      <Button
        variant={runId !== null ? "primary" : "ghost"}
        onClick={onClose}
        disabled={isDrafting || isSubmitting}
      >
        {draftId !== null ? "Close" : "Cancel"}
      </Button>
    </div>
  );
}

export function ApplicationDraftModalView(props: ApplicationDraftModalViewProps) {
  const { dialogRef, open, onClose, onRetry, onSubmit, ...state } = props;
  return (
    <dialog
      ref={dialogRef}
      className="application-draft-modal"
      aria-labelledby="adm-title"
      onClose={onClose}
      style={{ ...dialogStyle, display: open ? "flex" : "none" }}
    >
      <div className="application-draft-modal__inner" style={innerStyle}>
        <h2
          id="adm-title"
          className="application-draft-modal__title"
          style={{ margin: 0, flexShrink: 0 }}
        >
          Draft Application
        </h2>
        <div className="application-draft-modal__body" style={bodyStyle}>
          <DraftModalBody {...state} onRetry={onRetry} onClose={onClose} />
        </div>
        <DraftModalFooter {...state} onSubmit={onSubmit} onClose={onClose} />
      </div>
    </dialog>
  );
}
