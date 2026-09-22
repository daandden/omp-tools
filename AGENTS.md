# Repository Guidelines

## Project Overview

`omp-tools` is an Oh My Pi (OMP) plugin providing a thin ask adapter. It changes
only model-facing option-count guidance and delegates execution to native `ask`.
Do not add a separate picker or duplicate host behavior.

## Architecture & Data Flow

- `package.json` registers `extensions/flexible-ask.ts` as its sole entry point.
- The extension registers a shadow `ask` description/schema, then delegates to
  `ctx.invokeTool(params, { signal, onUpdate })`.
- Preserve `approval: "read"`, native UI behavior, cancellation, update callbacks,
  and the explicit error when native ask delegation is unavailable.
- Keep native `ask` enabled. Replace legacy `omp-ask` installations rather than
  loading duplicate wrappers.

## Important Files

- `extensions/flexible-ask.ts`: tool registration and native execution adapter.
- `extensions/flexible-ask.md`: static model-facing description; keep aligned
  with upstream `packages/coding-agent/src/prompts/tools/ask.md` except the
  option-count caution.
- `extensions/assets.d.ts`: ambient typing for the static Markdown import.
- `package.json`: OMP discovery, scripts, and SDK dependency pins.
- `tsconfig.json`: strict, no-emit TypeScript configuration for extensions.
- `README.md` and `CHANGELOG.md`: update when changing user-visible behavior.

## Development Commands

Run from the repository root:

```sh
bun install --ignore-scripts
bun run check
omp plugin link "$PWD"
```

There is no separate build, lint, formatter, or standalone run script. OMP loads
linked source directly. Start a **new OMP session** after linking or editing;
reinstallation is unnecessary for linked edits.

## Code Conventions

Match existing tabs, double quotes, semicolons, and trailing commas. Use camelCase
functions/locals, PascalCase types, and `import type` for SDK types. Keep the
default-exported initializer and initializer-local registration state. Preserve
the extension execute signature `(toolCallId, params, signal, onUpdate, ctx)`.
Return native-shaped async results and propagate failures.

## Runtime and Verification

Use Bun and `bun.lock`. The private package is ESM with ESNext/Preserve modules
and Bundler resolution. SDK packages supply development types; runtime APIs come
from the host. Keep SDK pins aligned; development types target 18.1.16.

Run typechecking after code changes. There are currently no automated test files
or repository CI. Registration/ask changes require a fresh-session OMP smoke;
typechecking alone does not exercise host integration or UI. OMP 18.2.8 was used
for the latest fresh-session registration smoke.

## Agent skills

- Issue tracker: GitHub Issues. See `docs/agents/issue-tracker.md`.
- Triage labels: default vocabulary. See `docs/agents/triage-labels.md`.
- Domain docs: single-context. See `docs/agents/domain.md`.
