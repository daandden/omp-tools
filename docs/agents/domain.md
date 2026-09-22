# Domain Docs

## Layout: single-context

- `CONTEXT.md` at the repo root: domain glossary.
- `docs/adr/`: architecture decision records.

## Before exploring, read these

Read root `CONTEXT.md` and ADRs under `docs/adr/` that touch the area being
explored. If a root `CONTEXT-MAP.md` exists, follow it to the relevant
contexts and also read relevant ADRs under `src/<context>/docs/adr/`.

If these documents do not exist, proceed silently. Do not flag their
absence or suggest creating them upfront. `/domain-modeling` creates them
lazily when terms or decisions are resolved.

## Use the glossary's vocabulary

When naming a domain concept in an issue title, refactor proposal,
hypothesis, or test name, use the term defined in `CONTEXT.md`. Avoid
synonyms the glossary explicitly rejects.

If a needed concept is missing, reconsider invented terminology or note a
real gap for `/domain-modeling`.

## Flag ADR conflicts

If a proposal contradicts an existing ADR, name the ADR and explain why
reopening the decision is justified rather than silently overriding it.
