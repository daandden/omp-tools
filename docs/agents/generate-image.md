# `generate_image`

A new mode is an `ImageMode` entry (label, schema, card facts, card warnings,
`run`), not a branch in `generate-image.ts`. Each entry owns its argument
rules, credential, client, details, and error wording, and neither entry
imports the other. `generate-image.md` is the one model-facing description,
rendered with the Default image generation mode.

- **Per-call mode.** One `generate_image` carries both entries' arguments plus
  `mode` (`openai` or `codex`). A call without `mode` uses the Default image
  generation mode (`docs/adr/20261117-agent-chosen-image-generation-mode.md`).
  `execute` checks in this order, each before any request: unknown keys
  (listing every accepted argument), an invalid `mode`, arguments the chosen
  mode does not take (naming them and the mode), then the chosen mode's own
  schema, which holds its bounds (Reference images: 5 in Codex mode, 16 in
  OpenAI mode). The mode gets the arguments without `mode`. No call falls back
  to the other mode or retries a request
  (`docs/adr/0002-explicit-image-generation-modes.md`). The description tells
  the agent to always pass `mode`, because the mounted `write xd://generate_image`
  approval shows only the supplied JSON.
- **Mode setting.** The async initializer reads `defaultImageGenerationMode`
  with `getPluginSettings("omp-tools", process.cwd())`. Project overrides
  beat global values. The old `imageGenerationMode` key blocks every call
  with the migration fix unless the new key is present. With neither key or
  with the new key set to `null`, the default is `openai`. An invalid new
  value, `""` included, blocks every call with the fix, even a call that names
  a `mode`. OMP runs the initializer once per process, so `session_switch`
  (`/new`, `/resume`, `/fork`) reads the setting again from `ctx.cwd` and
  registers the tool anew. The host refreshes a re-registered name, and a
  running call keeps the definition and mode it started with.
- **Precedence.** Native `generate_image` is settings-gated. Eager extension
  registration makes native skip the taken name, and deferred registration
  replaces native through the host's late registration path. The plugin wins
  either way.
- **Schema.** Keep the schema open: OMP's validator deletes unknown keys from
  closed schemas (`pi-ai` `coerceArgsFromIssues`). The shared schema joins an
  argument both modes take with `.or()`, so it accepts what either mode
  accepts, and labels mode-only arguments `OpenAI mode only.` or
  `Codex mode only.`.
- **Cards and approval.** The card head's first fact is the mode label: the
  call's mode for the call card and error cards (OMP 18.22.2 stores a thrown
  error with `details: {}`), `details.mode` for results and previews, and
  Codex mode for results saved before modes (no `mode`).
  OMP 18.22.0 shows a native extension tool's arguments in the approval
  prompt only through the tool's own `formatApprovalDetails`, which the
  extension `ToolDefinition` type omits; the plugin attaches it like
  `mergeCallAndResult`. It shows `Mode: <label>` (with `the Default image
  generation mode` when `mode` is omitted) and the host's
  `formatApprovalArguments` output.
- **Results.** Raster images go in `content` only, never `details.images`
  (the TUI would show them twice). SVG returns a saved path and an instruction
  to read it, without image content. `details.outputs` lists each path, MIME
  type, size, and quality. Policy `lossless-webp` re-encodes (Bun's encoder
  drops the color under alpha 0 and keeps visible pixels and alpha);
  `as-returned` keeps the provider's bytes, GIF and SVG included. GIF content
  stays `image/gif`. Streamed previews go through `onUpdate` with
  `details.stage: "preview"` and are never saved.
- **Artifacts.** `image-artifacts.ts` encodes every output before writing any.
  On a write failure or cancellation it lets all writes settle, then removes
  the files.
- **References.** `reference-images.ts` reads absolute paths or the active
  branch (`getBranch()`, including native `details.images`). Codex mode keeps
  JPEG and WebP and sends the rest as lossless WebP. OpenAI mode keeps PNG,
  JPEG, and WebP and sends the rest as PNG. `image-codecs.ts` sniffs formats
  and encodes WebP.

## Codex mode

`codex-images.ts` posts to `chatgpt.com/backend-api/codex/images/generations`
(no references) or `/edits` with Codex's exact body and headers and the
`openai-codex` credential. It derives the account id and residency from the
token's JWT claims.

- Keep the request guards: the 64 MB body cap (larger bodies get false
  `moderation_blocked` or silently dropped references), the 0-image-token
  dropped-references check on edits, and the 5-minute timeout combined with
  the tool signal.
- The endpoint returns PNG with a signed C2PA manifest whatever
  `output_format` says (checked 2026-10-08), and the local re-encode drops the
  manifest. Only the hosted `/codex/responses` image tool returns WebP, but it
  puts a chat model in the loop and drew on the weekly `premium` limit instead
  of the daily `imagegen_premium` one.
- `details` keeps `x-codex-imagegen-request-id`, `generation_id`, and
  `usage.output_tokens`; errors append the request id.
- Success text warns at 80% of a limit window. The endpoint reports its image
  window as `x-codex-primary-*` under
  `x-codex-active-limit: imagegen_premium`, so limit-named headers come first
  and `x-codex-*` is the fallback. Zero-minute windows are skipped.

## OpenAI mode

- The `openai` key from `getApiKeyForProvider` goes only to
  `https://api.openai.com/v1`. A different `getProviderBaseUrl("openai")`, or
  `OPENAI_BASE_URL` when OMP reports none, fails the call.
  `OpenAI-Organization` and `OpenAI-Project` come from
  `getProviderHeaders("openai")`, else `OPENAI_ORG_ID` and
  `OPENAI_PROJECT_ID`.
- It always sends `gpt-image-2.6-sunburst`. Size checks keep only `auto` or
  multiples of 16 with aspect ratio 1:3 to 3:1. The undocumented 2.6 edge and
  pixel limits are left to the API.
- Registration reads `svgAuthorModel` at session start and on session switch;
  absent or empty means `gpt-6.1-sol`. SVG requests always send
  `svg: { model }`, and a call's `svg` settings override it.
- `sunburst-images.ts` sends one JSON request (no retries), decodes JSON or
  SSE (`*.partial_image`, `*.completed`, `error`; a stream needs `n`
  completions), and keeps `x-request-id`. The 5-minute timeout covers the
  stream.
- Mask and markup bytes go out unchanged. Local files and data URLs are
  checked first (`image-checks.ts`: alpha from the file header, transparency
  from decoded pixels, sizes from `Bun.Image` metadata with EXIF
  orientation). No Codex guard applies.
- `details.requested` holds the sent settings, never the identifiers.
  `details.reported` holds what the API reported, and `details.svgUsage` the
  SVG author's `svg_usage`.

## Prompting skill

`skills/generate-image/SKILL.md` is the pre-call checklist for prompts and
edits, with the reference, mask, markup, transparency, and retry rules for
each mode. It stays generic, with no examples. Its cited research is in
`docs/research/`; `gpt-image-2.6.md` is the current model reference
(controls, pricing, documentation conflicts, GIF, SVG-author, and Codex
probes), and the `gpt-image-2.5-*.md` files are earlier checks.
