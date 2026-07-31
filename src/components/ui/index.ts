// Design-system primitives. Import from here:
//   import { Button, Badge, KpiCard } from "../components/ui";
//
// All primitives are thin wrappers over the class vocabulary in
// src/styles/theme.css - see DESIGN_SYSTEM.md for the full catalogue.

export { Button } from "./Button";
export type { ButtonVariant, ButtonSize } from "./Button";

export { Icon } from "./Icon";

export { Input } from "./Input";
export { Textarea } from "./Textarea";
export { Field, FormRow } from "./Field";
export { Select } from "./Select";
export type { SelectOption } from "./Select";
export { Checkbox } from "./Checkbox";
export { Radio, RadioGroup } from "./Radio";
export type { RadioOption } from "./Radio";
export { Switch } from "./Switch";
export { Dropdown } from "./Dropdown";
export type { DropdownOption } from "./Dropdown";

export { Badge } from "./Badge";
export { StatusDot } from "./StatusDot";
export { KpiCard } from "./KpiCard";
export type { KpiTone } from "./KpiCard";

export { Card } from "./Card";
export { Toolbar, ToolbarSpacer, ToolbarSep } from "./Toolbar";
export { EmptyState } from "./EmptyState";
export { ScoreBar } from "./ScoreBar";
export { ChartCard } from "./ChartCard";
export { DataTable } from "./DataTable";
export type { Column } from "./DataTable";

export { MatchScoreBadge } from "./MatchScoreBadge";
export { AutomationStatusBadge } from "./AutomationStatusBadge";
export { BrowserSessionBadge } from "./BrowserSessionBadge";
export type { SessionStatus } from "./BrowserSessionBadge";
export { DuplicateUrlWarning } from "./DuplicateUrlWarning";

export {
  automationVariant,
  jobStatusVariant,
  applicationStatusVariant,
  matchScoreVariant,
  humanizeStatus,
} from "./status";
export type { StatusVariant } from "./status";
