# Repository Guidelines

## Project Overview

`omp-tools` is an Oh My Pi (OMP) plugin with four parts:

- `ask`: a shadow of native `ask` that takes the same HTML form. In the TUI
  it answers the form in the Picker; elsewhere it delegates to native `ask`.
- `generate_image`: replaces native `generate_image` with two Image generation
  modes, OpenAI mode (the default) and Codex mode.
- `/btw <question>` and the Picker btw: Side questions answered by a read-only
  mirror session.
- The English coach checks interactive prompts with `@tiny` and shows
  private corrections above the editor without changing the main prompt.

Use the terms in `GLOSSARY.md` (Picker, Note, Other answer, Submit note,
Picker draft, Side question, Native /btw, Picker btw, Image generation mode,
SVG author, Reference image, English coach) in code, tests, and issues. Avoid
the synonyms it rejects, such as a bare "btw" or "image provider". Read the ADRs
in `docs/adr/` before changing how `/btw` is caught or how the image mode is
chosen. `README.md` holds user-facing behavior.

## Architecture & Data Flow

`package.json` (`omp.extensions`) registers four entry points. Each is a
default-exported initializer that registers tools and event handlers on the
`ExtensionAPI` and keeps its registration state local. OMP also loads
`skills/*/SKILL.md` from the plugin root (the `omp-plugins` discovery
provider, priority 90).

- **`ask`.** `flexible-ask.ts` picks a path per call. In the TUI it reads the
  form with `ask-form.ts`, opens the Picker (`ask-dialog.ts`) through
  `openPicker` (`picker-draft.ts`), and builds the result with
  `ask-result.ts`. Elsewhere it calls native `ask` through `ctx.invokeTool`.
  `host-ask-dialog.ts` sends OMP's own structured `askDialog` calls to the
  same Picker.
- **Side questions.** `side-question.ts` forks the main transcript into a
  mirror session. `btw.ts` (panel in `btw-panel.ts`) and `picker-btw.ts`
  (view in `picker-btw-view.ts`) each own a `LazySideQuestionThread`, and
  `side-question-view.ts` turns the streamed events into ordered parts.
- **`generate_image`.** `generate-image.ts` registers the `ImageMode` that
  `defaultImageGenerationMode` selects (`image-modes.ts`; Codex client in
  `codex-images.ts`; OpenAI rules in `openai-mode.ts` and client in
  `sunburst-images.ts`) and passes its output to `image-artifacts.ts`, which
  encodes and saves it.
- **English coach.** `english-coach.ts` observes interactive `input` without
  handling or transforming it. `english-coach-prompt.ts` prepares text and
  restores protected content, `english-coach.md` holds the instructions, and
  `english-coach-panel.ts` draws the private widget in both renderers.

Before changing a part, read its notes in `docs/agents/`:

- `ask-picker.md`: `ask`, the Picker, its editors and paste, Picker drafts,
  host `askDialog` routing, and the `ask` tool card.
- `side-questions.md`: the mirror session, `/btw`, and the Picker btw.
- `english-coach.md`: coach settings, protected text, the diff, the panel,
  and `@tiny` requests.
- `generate-image.md`: mode selection, results, the Codex and OpenAI
  clients, and the prompting skill.
- `tern-views.md`: scroll boxes, stylesheets, and omp theme colors, for any
  view in Tern.

### SDK imports

Runtime value imports of `@oh-my-pi/*` resolve to the host's in-process
modules through OMP's extension specifier shim. A compiled binary serves only
the keys in its module registry; any other subpath can load a second SDK copy
and fail. The compiled OMP 18.22.0 registry serves these roots and subpaths:

- `@oh-my-pi/pi-tui`, `/chrome`, `/render`, `/theme`, `/thinking`, `/media`,
  and every nested module, including `/html-form/*`, `/chat/svg-figure`,
  `/native/blobs`, `/overlays/*`, and `/tools/*`. OMP 18.22.0 moved
  `/html-form/media` to `/media` (`loadFormImage` became `loadMedia`).
- `@oh-my-pi/pi-coding-agent`, `/judgment`, `/modes/*`, `/tools/*`,
  `/utils/*`, `/session/*`, `/config/model-resolver`,
  `/extensibility/plugins/loader`, and `/session/settings`
- `@oh-my-pi/pi-utils` and its flat subpaths, such as `/dom`
- `@oh-my-pi/pi-ai` (`completeSimple`) and `@oh-my-pi/pi-agent-core`
  (`Tokenizer`)

Check a new subpath against the deployed binary before you import it. The
`pi-tui` root exports the describe builders (`node`, `col`, `md`, `span`,
`text`, `kbd`). `ask-dialog.ts` and `ask-editor.ts` mirror `actionButton` and
`hintsRow` from `/native/overlay`, which OMP 18.13.3 did not serve. Type-only
imports such as `@oh-my-pi/pi-tui/tools/renderer` are erased and safe.
`@oh-my-pi/pi-catalog` is not served, so `codex-images.ts` reimplements what
it needs.

## Key Directories

- `extensions/`: all plugin source, plus the model-facing prompts (`*.md`)
  imported as text.
- `skills/generate-image/`: the skill the plugin ships to OMP.
- `test/`: Bun tests; `test/support.ts` and `test/helpers/` hold fixtures.
- `scripts/`: SDK version check and update.
- `docs/adr/`: decisions to read before changing `/btw` dispatch or image
  modes. `docs/agents/`: per-subsystem notes and the live proof log.
  `docs/research/`: dated evidence behind the image skill and Codex
  endpoint. `docs/vstack/`: vstack config (see the vstack section).
- `.omp/skills/verify-omp-tools/`: the live smoke skill, with per-feature
  recipes in `features/` and the `tern-isolated` launcher and
  `side-question-probe.ts` in `helpers/`.

## Development Commands

```sh
bun install --ignore-scripts
bun run check     # SDK version check, then tsgo --noEmit
bun test
bun run update    # omp update, newest SDK types, then check
omp plugin link "$PWD"
```

- There is no build, lint, or formatter. OMP loads the linked source
  directly, so start a new OMP session after every edit; running sessions
  keep the definitions they loaded.
- `bun run check` warns, and still typechecks, when the installed `omp`
  version differs from the SDK types in `bun.lock` or `omp` is missing.
- `bun run update` fails without an installed `omp`. It restores the two
  `"latest"` specifiers after `bun update` rewrites them; update through it
  so the types and the installed omp move together.
- `scripts/host-env.ts` resolves the installed `omp` for both scripts.
  `bun run` puts `node_modules/.bin` first on PATH, where the SDK links its
  `cli.js` as `omp`, and Bun Shell ignores `.env()` PATH when it resolves
  commands, so a bare `omp` would run the dev dependency.

## Code Conventions & Common Patterns

- **Style.** Tabs, double quotes, semicolons, trailing commas. camelCase
  functions and locals, PascalCase types, `import type` for SDK types.
  Markdown prompts import with `with { type: "text" }` (typed by
  `extensions/assets.d.ts`).
- **Registration.** A default-exported initializer per entry point, with its
  registration state local. Tool `execute` keeps the signature
  `(toolCallId, params, signal, onUpdate, ctx)` and returns native-shaped
  results; pass `approval`, `concurrency`, and `mergeCallAndResult` on the
  definition.
- **Errors.** Propagate failures with an actionable message. A
  misconfiguration fails loudly instead of falling back: an invalid image
  mode registers a tool whose calls fail, and missing native delegation
  throws. The Side question view is the exception, turning failures into turn
  state for display.
- **Cancellation.** Thread `signal` through the UI, the mirror session, and
  HTTP. Network clients combine the tool signal with a 5-minute timeout and
  throw `ToolAbortError` on a user abort but a plain `Error` on a timeout.
  Only a user's cancel in the Picker also calls `ctx.abort()`, which ends the
  main turn; other tools leave the turn running.
- **State.** Long-lived state sits in per-load owners (`PickerDraftSlot`,
  `BtwCycle`, `LazySideQuestionThread`) that the session switch, branch,
  tree, and shutdown events dispose. State shared across module loads lives
  under a `Symbol.for("omp-tools.*")` key.
- **Types as guards.** Encode wiring rules in types so misuse fails
  typecheck: the branded `SideQuestionCacheKey`, and `createMirrorSession`'s
  input type.
- **Host internals.** Code that depends on undocumented OMP behavior names
  the OMP version it was proved on.
- **Docs.** Update `README.md` (install, settings, keys, behavior) and
  `CHANGELOG.md` (`[Unreleased]` with `Added`, `Changed`, `Fixed`, `Removed`
  bullets) when user-visible behavior changes. Update the subsystem's notes
  in `docs/agents/` when its design or a host workaround changes.

## Important Files

- `package.json`: entry points (`omp.extensions`) and plugin settings
  (`omp.settings`): `defaultImageGenerationMode`, `svgAuthorModel`,
  `sideQuestionModel`, `englishCoach`, `englishCoachMaxTokens`, and
  `englishCoachLanguage`. Code reads
  them with `getPluginSettings("omp-tools", cwd)`; a project's
  `.omp/plugin-overrides.json` overrides the global value.
- `extensions/ask-dialog.ts`: the Picker component, the largest file.
- Model-facing prompts in `extensions/`: `flexible-ask.md`, `btw.md`,
  `picker-btw.md`, `generate-image.md`, `generate-image-openai.md`, and
  `english-coach.md`.
- `GLOSSARY.md`: canonical terms. `CHANGELOG.md`, `README.md`: user-facing.

## Runtime/Tooling Preferences

- Bun only: the package manager, test runner, script runner, and image
  codec (`Bun.Image`). Typecheck with `tsgo` from the pinned
  `@typescript/native-preview`.
- The OMP source is at `~/work/tries/oh-my-pi` (`origin` is
  `can1357/oh-my-pi`). Read it at the tag `v<version>` matching
  `omp --version` for host behavior, the upstream files named above, and
  `/tan` or `/btw` internals.
- `~/work/tries/tern-plugins` also starts isolated Tern instances and seeds
  the same omp state to keep Tern's omp offer alert off the screen. When a
  Tern update changes that state, the alert, or how an isolated instance
  starts, fix both `tern-verify start` there and
  `.omp/skills/verify-omp-tools/helpers/tern-isolated` here.

## Testing & QA

Run `bun run check` and `bun test` after code changes. The suite is
`bun:test`, files named `*.test.ts`, and runs in about 25 seconds.

- `test/support.ts` captures `registerTool` and `on` on a fake
  `ExtensionAPI` (`loadSession`, `loadTool`, `fakeContext`), so tests drive
  `generate_image` through `execute` with `spyOn(globalThis, "fetch")` and
  settings from a real project `.omp/plugin-overrides.json`. `bunfig.toml`
  preloads a temporary OMP home, so tests read global plugin settings only
  from `writeGlobalPluginSettings`. `loadTool` defaults to Codex mode, unlike
  the plugin. Avoid `mock.module`: it leaks into other test files.
- UI tests call `Settings.init({ inMemory: true })` and `initTheme()` in
  `beforeAll` before building fake TUI contexts.
- `test/helpers/side-question-session.ts` runs a real SDK mirror session
  against a local SSE provider and records requests, warnings, and recovery
  events, so retries, fallbacks, and `/btw` follow-ups need no paid model.
  Its `toolCalls` and `tools` options run a real main turn whose tools return
  text or wait for `release()`, for calls still running in the main session.
- `test/helpers/english-coach-session.ts` captures the entry points'
  `input` handlers on a fake TUI context, backed by the local SSE provider
  and real model registry. Assert visible widget lines, provider requests,
  and ledger entries, not prompt wording or private helpers. Tests cover
  both `/btw` entry-point orders. They do not prove terminal layout,
  deferred-startup ordering, or real tiny-model correction quality.
- `test/generate-image-openai.live.test.ts` sends three paid requests (a
  still image with complexity, an SVG, and a GIF) and runs only with
  `OMP_TOOLS_LIVE_IMAGES=1` and `OPENAI_API_KEY`:
  `OMP_TOOLS_LIVE_IMAGES=1 bun test live`.

There is no CI workflow. Changes to registration, `ask`, the Picker, Side
questions, the English coach, tool cards, or event handling need a fresh-session
OMP smoke through the `verify-omp-tools` skill (headless Tern,
`PI_TUI_NATIVE=0` for the text renderer, RPC for checks without a screen).
The five-tool limit, the panel and its keys in a real host, and a kept Picker
btw thread have live smoke only. Add each smoke's result to
`docs/agents/live-proof.md`.

## vstack

- Issue tracker: GitHub Issues. See `docs/vstack/issue-tracker.md`.
- Code host: GitHub, through the `gh` CLI. See `docs/vstack/code-host.md`.
- CI service: GitHub Actions, through the `gh` CLI. See `docs/vstack/ci.md`.
- Triage labels: default vocabulary. See `docs/vstack/triage-labels.md`.
- Domain docs: single-context. See `docs/vstack/domain.md`.
- Diagrams: `catppuccin-latte`. See `docs/vstack/diagram.md`.
