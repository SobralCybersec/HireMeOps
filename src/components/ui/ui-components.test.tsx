// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AutomationStatusBadge } from "./AutomationStatusBadge";
import { BrowserSessionBadge } from "./BrowserSessionBadge";
import { Card } from "./Card";
import { ChartCard } from "./ChartCard";
import { Checkbox } from "./Checkbox";
import { DataTable } from "./DataTable";
import { Dropdown } from "./Dropdown";
import { DuplicateUrlWarning } from "./DuplicateUrlWarning";
import { Field, FormRow } from "./Field";
import { Input } from "./Input";
import { KpiCard } from "./KpiCard";
import { MatchScoreBadge } from "./MatchScoreBadge";
import { RadioGroup } from "./Radio";
import { ScoreBar } from "./ScoreBar";
import { StatusDot } from "./StatusDot";
import { Switch } from "./Switch";
import { Textarea } from "./Textarea";
import { Toolbar, ToolbarSep, ToolbarSpacer } from "./Toolbar";

afterEach(cleanup);

it("renders automation and browser session statuses", () => {
  const { rerender } = render(<AutomationStatusBadge state="Completed" />);
  expect(screen.getByText("Completed")).toBeTruthy();
  rerender(<AutomationStatusBadge state="PausedByUser" bare showDot={false} />);
  expect(screen.getByText("Paused By User")).toBeTruthy();

  rerender(<BrowserSessionBadge label="LinkedIn" status="connected" detail="Candidate" />);
  expect(screen.getByTitle("LinkedIn: connected (Candidate)")).toBeTruthy();
  rerender(<BrowserSessionBadge label="Browser" />);
  expect(screen.getByText("-")).toBeTruthy();
});

it("renders chart card content and placeholder", () => {
  const { rerender } = render(<ChartCard title="Visitors" />);
  expect(screen.getByText("No data")).toBeTruthy();
  rerender(
    <ChartCard title="Visitors" minHeight={200} actions={<button>Refresh</button>}>
      <svg aria-label="chart" />
    </ChartCard>,
  );
  expect(screen.getByLabelText("chart")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
});

it("supports checkbox labels, ids and indeterminate state", () => {
  const { rerender } = render(<Checkbox checked={false}>Accept</Checkbox>);
  const input = screen.getByRole("checkbox") as HTMLInputElement;
  expect(input.closest("label")).toBeTruthy();
  rerender(
    <Checkbox id="terms" checked={false} indeterminate className="extra">
      Terms
    </Checkbox>,
  );
  const identified = screen.getByRole("checkbox") as HTMLInputElement;
  expect(identified.id).toBe("terms");
  expect(identified.indeterminate).toBe(true);
  expect(identified.closest("span")?.className).toContain("extra");
});

it("renders data rows, fallback cells and empty state", () => {
  const onRowClick = vi.fn();
  const { unmount } = render(
    <DataTable
      columns={[
        { key: "title", header: "Title", primary: true },
        {
          key: "score",
          header: "Score",
          mono: true,
          align: "right",
          render: (row) => `${row.score}%`,
        },
      ]}
      rows={[{ id: "job-1", title: "Engineer", score: 88 }]}
      getRowKey={(row) => row.id}
      onRowClick={onRowClick}
    />,
  );
  expect(screen.getByText("Engineer")).toBeTruthy();
  expect(screen.getByText("88%")).toBeTruthy();
  fireEvent.click(screen.getByRole("row", { name: /Engineer/ }));
  expect(onRowClick).toHaveBeenCalledOnce();
  unmount();

  const { rerender } = render(
    <DataTable
      columns={[{ key: "title", header: "Title" }]}
      rows={[]}
      getRowKey={() => "empty"}
      empty="Nothing"
    />,
  );
  expect(screen.getByText("Nothing")).toBeTruthy();
  rerender(
    <DataTable columns={[{ key: "title", header: "Title" }]} rows={[]} getRowKey={() => "empty"} />,
  );
  expect(screen.getByRole("table")).toBeTruthy();
});

it("opens dropdown, selects options and closes on escape/outside", () => {
  const onChange = vi.fn();
  render(
    <Dropdown
      aria-label="Platform"
      value=""
      placeholder="Choose"
      title="Platforms"
      options={[
        { value: "li", label: "LinkedIn" },
        { value: "in", label: "Indeed" },
      ]}
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Platform" }));
  expect(screen.getByText("Platforms")).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitem", { name: "LinkedIn" }));
  expect(onChange).toHaveBeenCalledWith("li");

  fireEvent.click(screen.getByRole("button", { name: "Platform" }));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Platform" }));
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole("menu")).toBeNull();
});

it("renders notices, metrics, scores, radio group, switch and toolbar", () => {
  const dismiss = vi.fn();
  const onRadio = vi.fn();
  const onSwitch = vi.fn();
  render(
    <>
      <DuplicateUrlWarning url="https://jobs.test/1" onDismiss={dismiss} />
      <KpiCard label="Jobs" value={4} tone="success" accessibleValue="4 jobs" meta="today" />
      <MatchScoreBadge score={null} />
      <MatchScoreBadge score={85} />
      <ScoreBar label="Match" value={120} max={100} variant="success" />
      <ScoreBar label="Hidden" value={20} max={0} hideValue />
      <StatusDot variant="running" title="Running" size={6} />
      <RadioGroup
        name="mode"
        label="Mode"
        value="remote"
        options={[
          { value: "remote", label: "Remote" },
          { value: "office", label: "Office" },
        ]}
        onChange={onRadio}
      />
      <Switch checked={false} onChange={onSwitch} aria-label="Enabled">
        Enabled
      </Switch>
      <Toolbar border aria-label="Actions">
        <span>Actions</span>
        <ToolbarSpacer />
        <ToolbarSep />
      </Toolbar>
    </>,
  );
  expect(screen.getByText("4 jobs")).toBeTruthy();
  expect(screen.getByText("85%")).toBeTruthy();
  expect(screen.getByRole("progressbar", { name: "Match" }).getAttribute("aria-valuenow")).toBe(
    "120",
  );
  expect(screen.getByRole("img", { name: "Running" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss duplicate URL notice" }));
  fireEvent.click(screen.getByRole("radio", { name: "Office" }));
  fireEvent.click(screen.getByRole("switch", { name: "Enabled" }));
  expect(dismiss).toHaveBeenCalledOnce();
  expect(onRadio).toHaveBeenCalledWith("office");
  expect(onSwitch).toHaveBeenCalledWith(true);
});

it("wires field controls and renders card/input variants", () => {
  const { rerender } = render(
    <Field label="Name" helper="Shown publicly" required span="full">
      <span>prefix</span>
      <Input placeholder="Name" />
    </Field>,
  );
  const input = screen.getByPlaceholderText("Name");
  expect(input.id).not.toBe("");
  expect(screen.getByText("Name").getAttribute("for")).toBe(input.id);
  expect(input.getAttribute("aria-describedby")).toContain("-helper");
  expect(screen.getByText("Shown publicly")).toBeTruthy();
  expect(screen.getByText("Name").className).toContain("required");

  rerender(
    <Field label="Email" htmlFor="email" error="Invalid email" span={2}>
      <Input id="email" aria-describedby="hint" invalid />
    </Field>,
  );
  expect(screen.getByRole("textbox").getAttribute("aria-describedby")).toContain("hint");
  expect(screen.getByRole("alert").textContent).toBe("Invalid email");

  rerender(
    <FormRow cols={3}>
      <Card title="Details" actions={<button>Action</button>} compact bodyClassName="body">
        <Textarea invalid placeholder="Description" />
      </Card>
    </FormRow>,
  );
  expect(screen.getByText("Details")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Action" })).toBeTruthy();
  expect(screen.getByPlaceholderText("Description").getAttribute("aria-invalid")).toBe("true");

  rerender(<Card className="plain">Body</Card>);
  expect(document.querySelector(".card__body")?.className).toContain("card__body");
});
