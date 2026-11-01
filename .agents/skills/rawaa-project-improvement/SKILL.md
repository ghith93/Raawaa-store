---
name: rawaa-project-improvement
description: Conducts a prioritized, evidence-based research and development pass across the RAWAA store, product experience, operations, brand, privacy, and tooling. Use for broad requests to improve, audit, complete, or make the whole project more integrated. Keep work on the active Arena branch and leave external activation gated by verified prerequisites.
license: Proprietary
compatibility: Project-aware agents able to inspect the repository and run its existing tests. Do not install dependencies unless the owner explicitly asks.
---

# RAWAA Project Improvement Workflow

## Mission

Make one or more useful improvements to the existing RAWAA business and software per request. Start at the highest-priority unfinished item in `PROJECT-ROADMAP-AR.md`; do not restart finished work or change things only to create activity. Treat the working repository and owner-confirmed configuration as the source of truth.

## Read first

1. `AGENTS.md` and this skill.
2. `PROJECT-ROADMAP-AR.md` and `docs/RAWAA-AUTOMATION-MASTER-PLAN-AR.md`.
3. The relevant domain docs, tests, workflow, and implementation.
4. For product, pricing, delivery, payment, brand, or marketing claims, read `js/config.js`, `docs/marketing-content-plan.md`, and `.agents/skills/rawaa-content-workflow/SKILL.md` before writing.
5. Check the active branch and `git status`; do not overwrite uncommitted owner or agent work, switch branches, or expose `.env`, secret values, customer records, or private messages.

## Research standards

- Prefer primary sources: official product pages and brand case studies, standards bodies, regulator guidance, vendor docs, public repositories, and original research. Use recent sources when recency matters.
- Record the retrieval date, geography/market, method, and limitation of any material source. Separate verified RAWAA facts, general industry findings, and hypotheses.
- Benchmark principles, not protected expression. Never copy names, logo marks, distinctive layouts, label art, copy, photography, or trade dress. Do not treat an international benchmark as evidence of demand in Syria or any other local market.
- Do not turn generic best practices, search interest, competitor claims, or external uplift figures into predictions about RAWAA conversion, revenue, safety, formula, or product performance.
- Search for an existing fit before recommending packages, plugins, SDKs, agencies, or paid services. Do not install new dependencies by default. Prefer the repository's existing Node tests, injected dependencies, mocks, native browser APIs, and local tools.

## Choose and execute

1. Identify the user outcome and one or two measurable failure points.
2. Rank candidate changes by user trust, safety/privacy, ordering clarity, reliability, accessibility, performance, maintainability, and effort.
3. Select the smallest end-to-end improvement with evidence. Implement it on the current branch, add regression tests, and update the relevant operating docs and roadmap.
4. Keep pricing and commercial terms sourced from `js/config.js`. Never invent product ingredients, formula percentages, stock, reviews, delivery commitments, customer outcomes, or legal terms.
5. Fail closed when configuration, consent, challenge verification, identity, persistence, or a dependency is absent. A UI checkbox is not a durable consent record; an opened messaging link is not a sent message; a successful unit test is not a live integration.
6. Use synthetic data and mocked services for testing. Do not use real customer data, contact customers, send WhatsApp/Telegram messages, or test a live order unless that exact action is specifically authorized and technically safe.
7. Do not publish content, enable tracking, deploy, alter a production service, create a paid commitment, or change live customer data merely because a request says “full access.” If the current task explicitly authorizes an external operation, limit it to the named environment, verify the target, and run a rollback/readiness check first. Never infer legal approval from broad technical access.
8. If unresolved legal, consent, business, provider, security, or production facts would materially affect the result, implement only the reversible local portion and state the exact remaining gate; do not fabricate certainty.

## Quality gates

Run applicable tests, preferably zero-dependency tests first. For order and consent changes, include idempotency, retries/timeouts, exact server-side pricing, explicit optional marketing consent, opt-out/suppression, RLS/authorization, safe errors, and no-PII logs. For UI changes, check keyboard/assistive feedback, mobile constraints, and all asset/reference paths. Do not claim a browser, device, staging, provider, deployment, or message test that did not happen.

## Close the loop

- Update `PROJECT-ROADMAP-AR.md` with what changed, exact evidence/results, remaining prerequisites, and the next highest-value action.
- Keep long-lived research in a source-linked document; keep reusable instructions in `.agents/skills/` and `docs/CONTINUOUS-IMPROVEMENT-PROMPT-AR.md`.
- Report: implemented changes, research sources and limits, tests actually run, live/external actions actually taken or not taken, remaining blockers, and a ranked next step. State clearly whether the whole store is operationally integrated or only locally prepared.
