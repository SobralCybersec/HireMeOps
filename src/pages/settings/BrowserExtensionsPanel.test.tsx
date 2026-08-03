// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BrowserExtensionsPanel } from "./BrowserExtensionsPanel";

afterEach(cleanup);

describe("BrowserExtensionsPanel", () => {
  it("renders existing paths", () => {
    render(<BrowserExtensionsPanel value={["/ext/one", "/ext/two"]} onChange={vi.fn()} />);
    expect(screen.getByText("/ext/one")).toBeTruthy();
    expect(screen.getByText("/ext/two")).toBeTruthy();
  });

  it("shows an empty state when there are no paths", () => {
    render(<BrowserExtensionsPanel value={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/no extensions configured/i)).toBeTruthy();
  });

  it("appends a new path via onChange", () => {
    const onChange = vi.fn();
    render(<BrowserExtensionsPanel value={["/ext/one"]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/add extension path/i), {
      target: { value: "/ext/two" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["/ext/one", "/ext/two"]);
  });

  it("removes a path via onChange with the filtered array", () => {
    const onChange = vi.fn();
    render(<BrowserExtensionsPanel value={["/ext/one", "/ext/two"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /remove \/ext\/one/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["/ext/two"]);
  });

  it("ignores blank paths", () => {
    const onChange = vi.fn();
    render(<BrowserExtensionsPanel value={["/ext/one"]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/add extension path/i), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores duplicate paths", () => {
    const onChange = vi.fn();
    render(<BrowserExtensionsPanel value={["/ext/one"]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/add extension path/i), {
      target: { value: "/ext/one" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("adds a path on Enter keypress", () => {
    const onChange = vi.fn();
    render(<BrowserExtensionsPanel value={[]} onChange={onChange} />);
    const input = screen.getByLabelText(/add extension path/i);
    fireEvent.change(input, { target: { value: "/ext/new" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["/ext/new"]);
  });
});
