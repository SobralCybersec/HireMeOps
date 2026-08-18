# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Candidates and recruiters. Candidate workflow centers on finding, evaluating, tailoring, and applying to roles. The specific recruiter workflow remains open.

## Product Purpose

HireMeOps is a local-first job-search operations cockpit. It brings job discovery, CV-aware matching, profile variants, browser-based application work, and application tracking into one desktop product. Success means reducing repetitive job-search work while keeping important decisions visible to the user.

## Positioning

HireMeOps combines local data handling with real logged-in browser sessions and browser-driven AI workflows. It works without an API key, keeps browser cookies on the machine, streams job and automation events into the cockpit, and leaves human review in the loop for uncertain application steps.

## Operating Context

- Desktop Tauri application with a React interface.
- Users work with logged-in browser sessions for job platforms and AI-assisted CV workflows.
- Job discovery runs across multiple Brazilian and global job boards.
- Search, scoring, CV selection, application drafting, browser automation, review, and evidence capture form one connected workflow.
- Live events update the interface without polling; automation remains observable while it runs.

## Capabilities and Constraints

- Search and ingest job postings from supported platforms.
- Score postings against roles, skills, seniority, location, salary, and work-model preferences.
- Maintain CVs, profile variants, analysis, rewrites, previews, and exports.
- Draft, review, and submit supported applications through browser sessions.
- Pause application work for human review when automation needs an answer or encounters a captcha.
- Track application status, automation state, logs, and saved evidence.
- Current implementation uses React 19, Vite, Tauri v2, Rust IPC, Zustand, and a Node browser worker.
- Recruiter-specific workflows and terminology are undecided.

## Brand Commitments

- Product name: HireMeOps.
- Existing product language describes it as a local-first job-search automation cockpit.

## Evidence on Hand

- Existing product implementation in `src/` and `src-tauri/`.
- Product and workflow documentation in `README.md` and `README.pt-BR.md`.
- Existing platform icon assets in `src/assets/platform-icons/`.
- Existing automation evidence and workflow scripts in `automation/`.
- No user-supplied testimonials, customer proof, or recruiter-specific content recorded yet.

## Product Principles

- Keep repetitive work automated and important decisions visible.
- Keep user data and browser sessions local by default.
- Connect discovery, matching, tailoring, applying, and tracking into one operating loop.
- Show live system state and evidence instead of hiding automation behind opaque progress.
- Preserve room for both candidate and recruiter workflows as the product expands.
