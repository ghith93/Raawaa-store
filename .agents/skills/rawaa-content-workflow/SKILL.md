---
name: rawaa-content-workflow
description: Plans, drafts, edits, and fact-checks Arabic RAWAA store content for social posts, product copy, campaign pages, and content calendars. Use for content strategy, copywriting, conversion messaging, or content reviews in this repository. Drafts only; never publish or connect accounts.
license: Proprietary
compatibility: Project-aware agents that can read repository files. No network, plugins, API keys, or scripts required.
---

# RAWAA Content Workflow

Use this skill only for RAWAA | رواء content work in this repository. It is a bounded workflow for evidence-based drafts, not an autonomous marketer, publisher, product formulator, or sales representative.

## 1. Read the sources before writing

For any new product, campaign, or conversion copy, inspect the relevant current sources:

- `AGENTS.md` for non-negotiable facts and permissions.
- `js/config.js` for prices, variants, discounts, shipping, payment, product options, and contact details. It is the canonical source for those values.
- `docs/marketing-content-plan.md` for current product statements and what is still unconfirmed.
- `docs/ORGANIC-TEST-KIT-AR.md` and `docs/GROWTH-OPERATING-SYSTEM-AR.md` for campaign status, drafts, metric definitions, and approval rules.
- Relevant current HTML page or artwork metadata if the copy is for a specific page or image.

Do not assume a remembered or external value is newer than the repository. If sources conflict, state the conflict and ask the owner; do not choose a convenient version silently. Never read customer records, secrets, environment files, or private messages to create content.

## 2. Establish the brief

Before drafting, record briefly:

- requested content type, channel, audience, and one primary action;
- what the reader needs to know and what uncertainty may block them;
- which product facts are verified and the exact file/source for each;
- which claims are allowed, which require proof, and what is explicitly unknown;
- the destination URL and a permitted UTM value if one is needed;
- whether the image is real, illustrative, or generated, and what disclosure is needed;
- the observable measure that can be checked after the owner publishes.

Treat audience and motivation as hypotheses unless supported by real, privacy-safe evidence from the owner. If an important fact is missing, write a neutral draft with a clearly marked question or ask the owner; do not fill the gap with industry convention.

## 3. Draft for clarity and fit

- Write natural, polished Arabic consistent with existing RAWAA copy. Prefer direct, conversational clarity over inflated luxury language, empty superlatives, or generic AI phrasing.
- Keep one main point and one clear call to action per piece. Fit the length and structure to the selected channel; do not copy one caption verbatim everywhere.
- Explain prices as reference prices where appropriate. Read all amounts and delivery rules from `js/config.js`; do not invent discounts, scarcity, deadlines, availability, or margins.
- Distinguish browsing, clicking/opening WhatsApp, a message received by the owner, an order confirmed by the owner, and an order delivered. Never call an earlier stage a sale.
- Use original wording. Research and competitor examples may inform questions and structure, but must not be copied or treated as proof about RAWAA.
- Do not publish, schedule, send, connect an account, or trigger paid promotion. Return drafts for owner approval.

## 4. Claims and product guardrails

For every factual product claim, label the evidence source in the draft review. Reject or hold claims about medical effects, hair growth/loss treatment, guaranteed outcomes, safety for every user, heat protection, performance, certification, laboratory testing, testimonials, or customer numbers unless a matching, product-specific and approved source is present.

Do not invent or complete an INCI list, concentrations, directions for use, warnings, product feel, packaging specifications, manufacturing lead time, return policy, shipping promise, or customer segment. A licensed manufacturer or ability to manufacture quickly does not itself substantiate a particular formula, claim, test, or market demand. Flag new formula and label content for the manufacturer/specialist and owner to verify.

Do not describe a design render, generated scene, or proposed bottle as a real product photograph, real customer, or demonstrated result. Preserve rights and permissions for all photographs, faces, music, logos, fonts, and templates. Clearly disclose a conceptual/generative visual when its realism could mislead.

## 5. Research and trend claims

When asked for current trends, use trustworthy and dated sources. Record source, retrieval date, country/market, method, and limitations. Separate:

1. broad industry or search-interest signals;
2. evidence about the store’s actual market and audience;
3. hypotheses that need testing.

Google Trends values are relative and normalized, not exact query counts or sales. A foreign market signal is not evidence of demand in the store's delivery area. Do not recommend a new SKU, price, or formula as proven from search trends alone. Suggest a small, owner-approved content test and define a measure before drawing a conclusion.

## 6. Review checklist before returning a draft

Run separate passes:

1. **Facts:** every price, option, ingredient, claim, availability, route, and shipping/payment statement matches a current source.
2. **Trust:** no false certainty, false urgency, fabricated proof, or hidden limitation.
3. **Language:** clear modern Arabic, correct spelling, readable punctuation, no unnecessary jargon or repetition.
4. **Conversion:** message matches the destination page; one CTA; user can understand the next step and what is not yet confirmed.
5. **Media and platform:** rights checked, mobile legibility considered, generated/rendered media disclosed, platform fit noted.
6. **Measurement:** distinguish what the platform reports from actual owner-confirmed messages, orders, and deliveries.
7. **Approval:** status is `draft` or `fact-checked`, never `published` or `approved` unless the owner explicitly did that.

Return the final copy plus a short source/claim ledger, unresolved questions, visual brief, destination, suggested metric, and an explicit note that owner review and publishing remain required. Keep PII and credentials out of the output, repository, analytics, and prompts.
