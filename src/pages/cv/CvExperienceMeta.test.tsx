// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { CvExperienceMeta } from "./CvExperienceMeta";

afterEach(cleanup);
const entry = { organization: "Portfolio project", location: "Brasil", dates: "2026" };

it.each([
  ["https://www.behance.net/gallery/123/PROJECT", "Behance"],
  ["https://github.com/designer/project", "GitHub"],
  ["https://designer.github.io/project", "GitHub"],
  ["https://gitlab.com/designer/project", "GitLab"],
  ["https://br.linkedin.com/in/designer", "LinkedIn"],
  ["https://example.com/project?a=1&b=2", "Portfolio"],
  ["https://example.com/behance.net", "Portfolio"],
  ["https://behance.net.example.com", "Portfolio"],
])("renders %s as a linked %s icon instead of location", (url, label) => {
  const { container } = render(<CvExperienceMeta entry={{ ...entry, url }} />);
  const link = screen.getByRole("link", { name: label });
  expect(link.getAttribute("href")).toBe(url);
  expect(link.querySelectorAll("svg")).toHaveLength(2);
  expect(link.querySelectorAll("svg path").length).toBeGreaterThan(0);
  expect(link.getAttribute("rel")).toContain("noopener");
  expect(container.textContent).toBe(`Portfolio project · ${label} · 2026`);
  expect(screen.queryByText(/Brasil/)).toBeNull();
});

it("uses the target of a named Markdown link", () => {
  render(
    <CvExperienceMeta
      entry={{ ...entry, url: "[View project](https://behance.net/gallery/123/PROJECT)" }}
    />,
  );
  expect(screen.getByRole("link", { name: "Behance" }).getAttribute("href")).toBe(
    "https://behance.net/gallery/123/PROJECT",
  );
});

it.each([undefined, "", "javascript:alert(1)", "https://", "https://example.com has spaces"])(
  "keeps location for missing or invalid URL %s",
  (url) => {
    const { container } = render(<CvExperienceMeta entry={{ ...entry, url }} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toBe("Portfolio project · Brasil · 2026");
  },
);

it("omits empty metadata without dangling separators", () => {
  const { container } = render(
    <CvExperienceMeta entry={{ organization: "", location: "", dates: "2026" }} />,
  );
  expect(container.textContent).toBe("2026");
});
