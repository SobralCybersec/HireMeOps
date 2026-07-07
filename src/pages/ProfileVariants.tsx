import React, { useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Variant {
  id: string;
  name: string;
  headline: string;
  summary: string;
  keywords: string[];
  skills: string[];
  projects: string[];
  bullets: string;
}

// Placeholder data – replace when VariantStore is wired
const MOCK_VARIANTS: Variant[] = [
  {
    id: "v1",
    name: "Java Backend",
    headline: "Senior Java Backend Developer",
    summary:
      "Backend engineer with 8+ years building high-throughput microservices on the JVM. " +
      "Specialises in Spring Boot, Kafka, and PostgreSQL. " +
      "Comfortable owning a service end-to-end, from schema design to on-call.",
    keywords: ["Java", "Spring Boot", "Kafka", "PostgreSQL", "Microservices", "REST", "Docker"],
    skills: [
      "Java",
      "Spring Boot",
      "Apache Kafka",
      "PostgreSQL",
      "Docker",
      "Kubernetes",
      "REST APIs",
    ],
    projects: [
      "Event-driven order processing pipeline (Kafka, Java)",
      "Multi-tenant SaaS billing service (Spring Boot, PostgreSQL)",
      "Zero-downtime deployment tooling (Kubernetes, Helm)",
    ],
    bullets:
      "• Designed and operated a Kafka-based event pipeline processing 50k msg/s with <5ms p99 latency.\n" +
      "• Led migration of monolith to 12 microservices, cutting deployment time from 2h to 8min.\n" +
      "• Mentored 4 junior engineers; established team coding standards and PR review process.",
  },
  {
    id: "v2",
    name: "Rust Systems",
    headline: "Systems Engineer – Rust / C++",
    summary:
      "Systems programmer focused on performance-critical infrastructure: embedded runtimes, " +
      "WebAssembly sandboxes, and async networking. Write Rust daily; reach for C++ when interop demands it.",
    keywords: ["Rust", "C++", "WebAssembly", "Tokio", "WASM", "Systems Programming", "Embedded"],
    skills: [
      "Rust",
      "C++",
      "WebAssembly / WASM",
      "Tokio async runtime",
      "Linux systems programming",
      "Protocol design",
      "CMake / Cargo",
    ],
    projects: [
      "WASM sandbox runtime for plugin isolation",
      "Low-latency UDP transport layer in Rust",
      "Cross-platform CLI toolchain (Rust, clap)",
    ],
    bullets:
      "• Built a WASM sandbox reducing plugin crash blast-radius to zero — zero host crashes since deploy.\n" +
      "• Rewrote UDP transport in Rust; cut tail latency 60%, halved memory footprint.\n" +
      "• Contributed 3 accepted PRs to Tokio (async I/O fixes, documentation).",
  },
  {
    id: "v3",
    name: "Fullstack",
    headline: "Fullstack Engineer (React + Node)",
    summary:
      "Product-minded fullstack engineer. Equally comfortable on the backend and frontend. " +
      "Strongest in React/TypeScript and Node.js, with PostgreSQL for persistence and AWS for infra.",
    keywords: ["React", "TypeScript", "Node.js", "AWS", "PostgreSQL", "Next.js", "Tailwind CSS"],
    skills: [
      "React",
      "TypeScript",
      "Node.js / Express",
      "Next.js",
      "PostgreSQL",
      "AWS (Lambda, S3, RDS)",
      "Tailwind CSS",
    ],
    projects: [
      "Customer-facing analytics dashboard (React, Recharts, Node)",
      "Auth service with magic links and TOTP (Node, Redis)",
      "E2E test suite reducing regression rate by 70% (Playwright)",
    ],
    bullets:
      "• Shipped redesigned onboarding flow; reduced time-to-value from 12 min to 3 min.\n" +
      "• Owned backend API serving 200k DAU — 99.95% uptime over 18 months.\n" +
      "• Introduced Playwright E2E suite; caught 4 regressions before production in its first month.",
  },
];

const TABS = [
  "Headline",
  "Summary",
  "Keywords",
  "CV",
  "Skills",
  "Projects",
  "Bullets",
] as const;
type Tab = (typeof TABS)[number];

// ---------------------------------------------------------------------------

export function ProfileVariants() {
  const [selectedId, setSelectedId] = useState<string | null>(
    MOCK_VARIANTS[0]?.id ?? null,
  );
  const [activeTab, setActiveTab] = useState<Tab>("Headline");

  // Keyboard nav for the horizontal variant editor tablist (ArrowLeft/Right + Home/End).
  function handleTabKey(e: React.KeyboardEvent<HTMLButtonElement>, idx: number) {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    let next: number;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % TABS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else next = TABS.length - 1;
    setActiveTab(TABS[next]);
    document.getElementById(`variant-tab-${TABS[next]}`)?.focus();
  }

  const selected = MOCK_VARIANTS.find((v) => v.id === selectedId) ?? null;

  return (
    <div className="page page--fill" style={{ padding: 0 }}>
      {/* ── Header ── */}
      <div
        style={{
          padding: "var(--sp-4)",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-3)",
          flexShrink: 0,
        }}
      >
        <h1 className="page-title">Profile Variants</h1>
        <span className="page-subtitle">{MOCK_VARIANTS.length} variants</span>
        <div className="toolbar-spacer" />
        <button type="button" className="btn btn--ghost btn--sm" disabled>
          Duplicate
        </button>
        <button type="button" className="btn btn--ghost btn--sm" disabled>
          Generate from CV
        </button>
        <button type="button" className="btn btn--primary btn--sm" disabled>
          + New Variant
        </button>
      </div>

      <div
        className="two-pane"
        style={{
          flex: 1,
          borderRadius: 0,
          border: "none",
          borderTop: "1px solid var(--color-border)",
        }}
      >
        {/* ── Variant list ── */}
        <div className="two-pane__list">
          <div className="two-pane__list-header">
            <span
              style={{
                fontSize: "var(--text-2xs)",
                fontWeight: "var(--fw-semibold)",
                letterSpacing: "0.10em",
                textTransform: "uppercase",
                color: "var(--color-text-muted)",
              }}
            >
              Variants
            </span>
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {MOCK_VARIANTS.map((v) => (
              <li
                key={v.id}
                className={selectedId === v.id ? "list-item selected" : "list-item"}
                onClick={() => setSelectedId(v.id)}
                tabIndex={0}
                role="button"
                aria-pressed={selectedId === v.id}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setSelectedId(v.id);
                }}
              >
                <div>
                  <div className="list-item__name">{v.name}</div>
                  <div className="list-item__meta">
                    {v.keywords.slice(0, 3).join(", ")}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* ── Editor ── */}
        <div className="two-pane__detail" style={{ padding: 0 }}>
          {selected === null ? (
            <div className="empty-state">
              <p className="empty-state__title">No variant selected</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              {/* Tab bar */}
              <div
                style={{
                  display: "flex",
                  gap: 1,
                  background: "var(--color-border)",
                  borderBottom: "1px solid var(--color-border)",
                  flexShrink: 0,
                  overflowX: "auto",
                }}
                role="tablist"
                aria-label="Variant editor sections"
              >
                {TABS.map((tab, idx) => (
                  <button
                    key={tab}
                    id={`variant-tab-${tab}`}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab}
                    aria-controls="variant-panel"
                    tabIndex={activeTab === tab ? 0 : -1}
                    className={activeTab === tab ? "filter-tab active" : "filter-tab"}
                    onClick={() => setActiveTab(tab)}
                    onKeyDown={(e) => handleTabKey(e, idx)}
                    style={{ borderRadius: 0, whiteSpace: "nowrap" }}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div
                id="variant-panel"
                role="tabpanel"
                aria-labelledby={`variant-tab-${activeTab}`}
                style={{
                  flex: 1,
                  padding: "var(--sp-5)",
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--sp-4)",
                }}
              >
                {/* ── Headline ── */}
                {activeTab === "Headline" && (
                  <div className="field">
                    <label className="field__label" htmlFor="var-headline">
                      Headline
                    </label>
                    <input
                      id="var-headline"
                      type="text"
                      className="field__input"
                      defaultValue={selected.headline}
                      readOnly
                      style={{ cursor: "not-allowed", opacity: 0.7 }}
                    />
                    <span className="field__helper">
                      One-line professional title shown at the top of CV and LinkedIn.
                      Editing requires backend connection.
                    </span>
                  </div>
                )}

                {/* ── Summary ── */}
                {activeTab === "Summary" && (
                  <div className="field">
                    <label className="field__label" htmlFor="var-summary">
                      Professional Summary
                    </label>
                    <textarea
                      id="var-summary"
                      className="field__input"
                      rows={6}
                      defaultValue={selected.summary}
                      readOnly
                      style={{ resize: "vertical", cursor: "not-allowed", opacity: 0.7 }}
                    />
                    <span className="field__helper">
                      3–5 sentence professional summary tailored to this variant's target
                      role. Editing requires backend connection.
                    </span>
                  </div>
                )}

                {/* ── Keywords ── */}
                {activeTab === "Keywords" && (
                  <>
                    <div>
                      <p
                        className="field__label"
                        style={{ marginBottom: "var(--sp-2)" }}
                      >
                        ATS Keywords
                      </p>
                      <div
                        style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1)" }}
                      >
                        {selected.keywords.map((kw) => (
                          <span key={kw} className="tag">
                            {kw}
                          </span>
                        ))}
                      </div>
                    </div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "var(--text-xs)",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      Keywords are matched against job descriptions to compute relevance
                      scores. Adding or removing keywords requires backend connection.
                    </p>
                  </>
                )}

                {/* ── CV (Preferred CV) ── */}
                {activeTab === "CV" && (
                  <>
                    <div className="field">
                      <label className="field__label" htmlFor="var-preferred-cv">
                        Preferred CV
                      </label>
                      <select
                        id="var-preferred-cv"
                        className="field__input"
                        disabled
                        style={{ cursor: "not-allowed", opacity: 0.7 }}
                      >
                        <option value="">— no CV selected —</option>
                      </select>
                      <span className="field__helper">
                        Preferred CV for this variant. Auto-apply still selects the
                        highest-match CV unless explicitly overridden here. Requires CV
                        Library backend.
                      </span>
                    </div>
                    <div
                      style={{
                        padding: "var(--sp-3) var(--sp-4)",
                        background: "var(--color-surface-2)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "var(--radius-md)",
                        fontSize: "var(--text-xs)",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      Upload and parse CVs in the CV Library, then assign them to variants
                      here.
                    </div>
                  </>
                )}

                {/* ── Skills (order) ── */}
                {activeTab === "Skills" && (
                  <>
                    <div>
                      <p
                        className="field__label"
                        style={{ marginBottom: "var(--sp-1)" }}
                      >
                        Skills Order
                      </p>
                      <p
                        style={{
                          margin: "0 0 var(--sp-3)",
                          fontSize: "var(--text-xs)",
                          color: "var(--color-text-muted)",
                        }}
                      >
                        Skills are listed top-to-bottom in priority order for this variant.
                        Reordering requires backend connection.
                      </p>
                      <ol
                        style={{
                          margin: 0,
                          padding: 0,
                          listStyle: "none",
                          display: "flex",
                          flexDirection: "column",
                          gap: "var(--sp-1)",
                        }}
                      >
                        {selected.skills.map((skill, i) => (
                          <li
                            key={skill}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "var(--sp-3)",
                              padding: "var(--sp-2) var(--sp-3)",
                              background: "var(--color-surface-2)",
                              border: "1px solid var(--color-border)",
                              borderRadius: "var(--radius-sm)",
                            }}
                          >
                            <span
                              style={{
                                fontSize: "var(--text-xs)",
                                fontWeight: "var(--fw-semibold)",
                                color: "var(--color-text-muted)",
                                fontFamily: "var(--font-mono)",
                                minWidth: "1.5rem",
                                textAlign: "right",
                              }}
                            >
                              {i + 1}
                            </span>
                            <span
                              style={{
                                fontSize: "var(--text-sm)",
                                color: "var(--color-text)",
                              }}
                            >
                              {skill}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </>
                )}

                {/* ── Projects (priority) ── */}
                {activeTab === "Projects" && (
                  <>
                    <div>
                      <p
                        className="field__label"
                        style={{ marginBottom: "var(--sp-1)" }}
                      >
                        Projects Priority
                      </p>
                      <p
                        style={{
                          margin: "0 0 var(--sp-3)",
                          fontSize: "var(--text-xs)",
                          color: "var(--color-text-muted)",
                        }}
                      >
                        Projects are presented in this order when included in CV generation
                        for this variant. Reordering requires backend connection.
                      </p>
                      <ol
                        style={{
                          margin: 0,
                          padding: 0,
                          listStyle: "none",
                          display: "flex",
                          flexDirection: "column",
                          gap: "var(--sp-2)",
                        }}
                      >
                        {selected.projects.map((proj, i) => (
                          <li
                            key={proj}
                            style={{
                              display: "flex",
                              gap: "var(--sp-3)",
                              padding: "var(--sp-3)",
                              background: "var(--color-surface-2)",
                              border: "1px solid var(--color-border)",
                              borderRadius: "var(--radius-sm)",
                            }}
                          >
                            <span
                              style={{
                                fontSize: "var(--text-xs)",
                                fontWeight: "var(--fw-semibold)",
                                color: "var(--color-text-muted)",
                                fontFamily: "var(--font-mono)",
                                minWidth: "1.5rem",
                                paddingTop: "2px",
                                flexShrink: 0,
                              }}
                            >
                              {i + 1}
                            </span>
                            <span
                              style={{
                                fontSize: "var(--text-sm)",
                                color: "var(--color-text)",
                              }}
                            >
                              {proj}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </>
                )}

                {/* ── Bullets (experience) ── */}
                {activeTab === "Bullets" && (
                  <div className="field">
                    <label className="field__label" htmlFor="var-bullets">
                      Experience Bullets
                    </label>
                    <textarea
                      id="var-bullets"
                      className="field__input"
                      rows={8}
                      defaultValue={selected.bullets}
                      readOnly
                      style={{
                        resize: "vertical",
                        cursor: "not-allowed",
                        opacity: 0.7,
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--text-xs)",
                      }}
                    />
                    <span className="field__helper">
                      Role-specific achievement bullets for this variant's experience
                      section. One bullet per line (•). Editing requires backend connection.
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
