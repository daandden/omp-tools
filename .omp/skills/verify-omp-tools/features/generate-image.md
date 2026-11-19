# generate_image

The plugin's `generate_image` creates or edits images in one of two Image generation modes. One tool carries both modes' arguments plus `mode` (`openai` or `codex`). A call runs in its `mode`, or else in the Default image generation mode that the plugin reads from `defaultImageGenerationMode` at session start. An argument the chosen mode does not take fails the call before any request, and no call falls back to the other mode.

- OpenAI mode (`openai`, the default): GPT Image 2.6 Sunburst through `api.openai.com/v1/images/*` with the `openai` API key. Its arguments include `n`, `quality`, `complexity`, `size`, `background`, `output_format`, `output_compression`, `frame_count`, `frame_duration_ms`, `svg`, `moderation`, `safety_identifier`, `user`, `stream`, `partial_images`, `referenced_image_paths`, `num_last_images_to_include` (1–16), `images`, `mask`, and `markup`. There is no per-call `model`. With `output_format` omitted, the result is a lossless WebP made locally from PNG; an explicit format keeps the API's bytes. GIF and SVG are generation-only without references, streaming, or compression; SVG also requires `n` 1 or omitted. GIF supports 2–16 frames at 20–2000 ms per frame, default 9 at 200 ms. SVG uses the session's `svgAuthorModel` setting (default `gpt-6.1-sol`), overridden by `svg.model` and optional `svg.reasoning.effort`. Raster streaming shows unsaved previews on the card.
- Codex mode (`codex`): the Codex Images endpoint with the user's Codex login. The tool takes a prompt, an optional transparent background, and references (absolute paths, or the last 1–5 conversation images). Size and quality are not arguments: the endpoint picks them and the card shows what it reported. The result is a lossless WebP.

Results are saved to `$TMPDIR/omp-image-<id>.<webp|png|jpg|gif|svg>`. Raster results go to the model as image content, including unchanged `image/gif` content; SVG returns only its saved path and an instruction to read the file. The tested Claude Haiku 5.5 and Codex gpt-6-luna routes saw only the GIF's first frame. The tool card shows the prompt's first line, the reference count and mode settings, the reported size and quality, each saved path as a link, any Codex near-limit warning, and raster images.

## Sub-features

- `img-mode` registers both modes' arguments plus `mode` under the one `generate_image` name, whatever the default.
- `img-mode-switch` uses the new Default image generation mode after `/new`.
- `img-mode-call` runs one call in the mode its `mode` names, and the card head names that mode.
- `img-approval` shows the call's mode and arguments before execution. On the mounted path, a long prompt leaves the first argument key, `mode`, visible.
- `img-generate` creates an image from a prompt.
- `img-edit` edits an image given by absolute path, or the last images in the conversation.
- `img-multi` (OpenAI) returns `n` images with one saved path each.
- `img-format` (OpenAI) keeps an explicit `output_format`'s bytes and extension.
- `img-stream` (OpenAI) shows partial previews, then the final image.
- `img-mask` (OpenAI) edits with a `mask` or `markup`.
- `img-card` shows the card with the images and saved paths.
- `img-error` shows an error card. An endpoint refusal appends the request id when the endpoint sent one.

## How to get to it (user POV)

- Ask the agent to generate or edit an image. Ask for "OpenAI mode" or "Codex mode" to pick the mode for that call.
- Choose the default with `omp plugin config set omp-tools defaultImageGenerationMode codex` (or `openai`), then start a new session.

## Opt-in live API tests

With `OPENAI_API_KEY` set, run `OMP_TOOLS_LIVE_IMAGES=1 bun test live`.
`test/generate-image-openai.live.test.ts` runs three paid checks: a still
image with complexity, an SVG, and a GIF. Without both environment variables,
the file skips. Requests are billed to the key's API organization. These
tests passed on 2026-11-05 in 45 seconds; they do not verify OMP registration
or tool cards.

## Driving it with tern ctl

Preconditions:

- Baseline from `README.md`.
- Codex mode: an `openai-codex` login exists (`omp` model list shows Codex models).
- OpenAI mode: an `openai` API key resolves (`OPENAI_API_KEY`, or a key stored for `openai`). Without one, every OpenAI live step is blocked: record "no openai credential" as the unmet prerequisite, run only the argument and error checks below, and never mark the live steps passed.
- Set the mode per session without touching the user's global plugin settings: start OMP from a scratch project directory whose `.omp/plugin-overrides.json` is `{"settings":{"omp-tools":{"defaultImageGenerationMode":"openai"}}}` (or `"codex"`), with `sh -c 'cd <scratch project> && exec omp …'`. Project overrides win over the global value.

Schema (`img-mode`). With each default, run `$C type '"List the parameter names of the generate_image tool, comma-separated, and nothing else."'`, `$C key Enter`, `sleep 15`, `$C shot img-mode-<mode>`. Both defaults list the same names: `mode`, `prompt`, `transparent_background`, `size`, `complexity`, `frame_count`, `frame_duration_ms`, `svg`, `mask`, and the other OpenAI mode arguments, but not `model`. Only one `generate_image` tool exists: the session's tool list (the `/tools` command or the RPC `get_state`) has no second image tool.

Codex mode:

- Generate. Run `$C type '"Use generate_image once with the prompt: a small flat blue circle centered on a plain white background. Then reply with the saved path only."'`, `$C key Enter`. When `$C tree` contains `Saved to`, run `$C shot img-generate`. The card shows `Generate image`, the prompt, the reported size and quality (for example `1254x1254` and `quality low`), `Saved to <path>`, and the image.
- File. `file` on the saved path reports `Web/P image`.
- Edit by path. Run `$C type '"Use generate_image once to edit <saved path> (pass it in referenced_image_paths): make the circle red, keep everything else. Then reply with the saved path only."'`, `$C key Enter`, wait for a second `Saved to`, `$C shot img-edit`. A second card shows `1 reference`, a red circle, and a second saved path.

OpenAI mode (each step is one small paid request; use `quality: "low"` and `size: "1024x1024"` unless the step tests them):

- Generate. Same prompt as Codex, asking for `quality low` and `size 1024x1024`. The card shows `Saved to <path>.webp`; `file` reports `Web/P image`.
- Multiple (`img-multi`). Ask for `n` 2. The card shows `2 images`, two numbered `Saved to` lines, and two images; the reply names two paths.
- Format (`img-format`). Ask for `output_format jpeg` with `output_compression 60`. The saved path ends in `.jpg`, and `file` reports `JPEG image data`.
- GIF (`img-format`). Ask for a new looping GIF with `frame_count 2` and `frame_duration_ms 200`, without references or streaming. The saved path ends in `.gif`, `file` reports GIF, and the result content has MIME type `image/gif`. Inspect the saved animation with local tools; the model may see only the first frame.
- SVG (`img-format`). Ask for a new icon with `output_format svg` and `n 1`, without references or streaming. The saved path ends in `.svg`, and reading it shows SVG XML. The model's result contains a saved path and a read instruction, without image content. `details.requested.svg.model` matches the session's `svgAuthorModel` or the call override, and `details.svgUsage` keeps author usage when returned.
- Edit by path. As in Codex mode, with the first OpenAI result. The card shows `1 reference`.
- Stream (`img-stream`). Ask for `stream true` and `partial_images 2`. Take `$C shot img-stream-preview` while `$C tree` shows `in progress`, then `$C shot img-stream-final` after `Saved to`. Previews are not in `$TMPDIR`: only the final file is new.
- Mask or markup (`img-mask`). Make a mask with a local tool: the first result's size, opaque except a transparent square in the middle, saved as lossless WebP with alpha, because a mask must match the first Reference image's format and the default result is WebP. Ask for an edit with that image in `referenced_image_paths`, `mask { path }`, and the prompt "put a yellow star in the masked square". The card shows `1 reference` and a new image.

Per-call mode, default switch, and approval (`img-mode-call`, `img-mode-switch`, `img-approval`, no image request). Use a local provider to issue each call with exact arguments:

1. Set `CHECKOUT`, `OMP_BIN` (the absolute omp binary Doctor checked), and `H="$CHECKOUT/.omp/skills/verify-omp-tools/helpers/image-mode-provider.ts"`. Start `bun "$H" "$VERIFY_RUN_DIR"` as an owned service and wait for `ready:`. It writes `provider.ts` and `smoke-config.yml` and records every chat request in `requests.jsonl`. Before each probe, write its arguments to `$VERIFY_RUN_DIR/tool-args.json`.
2. Make a project dir under `$VERIFY_RUN_DIR/data/` whose `.omp/plugin-overrides.json` sets `defaultImageGenerationMode` to `codex`. Start OMP in an isolated Tern instance (`helpers/tern-isolated`). Run this command from the scratch project after appending the probe's `--approval-mode` flag:

   ```sh
   env -u OPENAI_API_KEY -u OPENAI_BASE_URL -u PI_CONFIG_DIR -u XDG_DATA_HOME -u XDG_STATE_HOME -u XDG_CACHE_HOME \
     HOME="$VERIFY_RUN_DIR/data/home" PI_CODING_AGENT_DIR="$VERIFY_RUN_DIR/data/agent" PI_PROFILE= OMP_PROFILE= \
     "$OMP_BIN" --no-extensions -e "$VERIFY_RUN_DIR/provider.ts" -e "$CHECKOUT/extensions/generate-image.ts" \
     --no-skills --no-rules --no-context-files --no-lsp --offline --no-tools --tools generate_image \
     --model image-smoke/main --config "$VERIFY_RUN_DIR/smoke-config.yml" --session-dir "$VERIFY_RUN_DIR/data/sessions"
   ```

   Use a fresh home and agent dir without an OpenAI key or Codex login.
3. Mode card (`img-mode-call`): with `tool-args.json` `{"prompt":"mode smoke logo","mode":"openai","output_format":"svg"}` and `--approval-mode yolo`, type any prompt and press Enter. The card head shows `Generate image`, `OpenAI mode`, and `svg`, and the error says OpenAI mode needs an OpenAI API key, that the user can ask for Codex mode or change `defaultImageGenerationMode`, and not to switch unless the user asks. The first request in `requests.jsonl` lists `mode` in the `generate_image` tool parameters, and its description names `codex` as the default.
4. Approval (`img-approval`): with `tool-args.json` `{"prompt":"approval smoke"}` and `--approval-mode always-ask`, submit a prompt. Require `Allow tool: generate_image` and `Mode: Codex mode, the Default image generation mode`. Open the details to see the arguments. Capture the approval and deny the call. Check that the result reports the denial rather than a credential error. Repeat with `{"mode":"openai","prompt":"approval smoke"}`. Require `Mode: OpenAI mode`, then deny that call too.
5. Default switch (`img-mode-switch`): in the same `always-ask` session, write `{"prompt":"default switch smoke"}` to `tool-args.json`. Change the scratch project's `defaultImageGenerationMode` to `openai`. Run `$C type /new`, `$C key Enter`, then submit a prompt. Require `Mode: OpenAI mode, the Default image generation mode` in the approval prompt. Capture it and deny the call. Check that the tool result reports the denial.
6. Mounted approval (`img-approval`): start the provider with `bun "$H" "$VERIFY_RUN_DIR" --mounted` in a fresh run dir. The provider sets `tools.xdev` on and sends `write xd://generate_image`, using `tool-args.json` as the `write` content. Use the launch from step 2 with `--approval-mode always-ask`, but omit `--no-tools --tools generate_image` so OMP can mount the tool. Write the fixture before submitting a prompt:

   ```sh
   bun -e 'await Bun.write(process.argv[1], JSON.stringify({mode: "openai", prompt: "A small blue circle. ".repeat(120)}))' "$VERIFY_RUN_DIR/tool-args.json"
   ```

   Require `Allow tool: write` and `Path: xd://generate_image`. Open the approval details and check that `"mode": "openai"` appears before the truncated `prompt`. Capture the details and deny the call. Check that the tool result reports the denial. An omitted `mode` would not show the effective default on this path.

Errors (no request, no cost):

- Codex mode: run `$C type '"This is an argument check. Call generate_image exactly once with prompt \"validation check\", referenced_image_paths [\"relative.webp\"], and num_last_images_to_include 1. Do not retry or fix the arguments after the error; reply with the error text only."'`, `$C key Enter`, `sleep 15`, `$C shot img-error`. The card shows `referenced_image_paths and num_last_images_to_include cannot be used together.`
- OpenAI mode: the same check with `background "transparent"` and `output_format "jpeg"`. The card shows `background "transparent" needs output_format png or webp`.
- OpenAI mode without an `openai` key: any generation request shows the error naming `OPENAI_API_KEY`, the Codex login, asking for Codex mode, and `defaultImageGenerationMode`. No request goes out.
- Mode setting migration (`img-mode-migration`): start a fresh OMP session with an isolated `HOME`, agent directory, and no inherited OpenAI credentials. Seed only the legacy mode key in the isolated plugin lockfile. Call `generate_image` and verify the error gives the command for the stored mode. Set `defaultImageGenerationMode` to `openai` in the scratch project's overrides and start a fresh session. The same call now fails for lack of `OPENAI_API_KEY`, not for the rename. Neither call reaches an image endpoint.

Second view. When `generate_image` is mounted as an `xd://` device (as in a session with `tools.xdev` on), its result is a `write` tool result. Read it with `jq -c 'select(.type=="message" and .message.role=="toolResult" and .message.details.xdev.tool=="generate_image") | .message.details.xdev.inner' <session>.jsonl`. It shows `mode` and `outputs` (each `path`, `mimeType`, `size`, `quality`); Codex mode adds `requestId`, `generationId`, and `outputTokens`, and OpenAI mode adds `requested`, `reported`, `usage`, and `requestId`, plus `svgUsage` when the API returns it. `requested` includes complexity, frame controls, and the sent `svg` object. A top-level `generate_image` puts the same keys in `.message.details` of a `generate_image` tool result.

## Gotchas

- Codex runs draw on the account's daily image limit (`imagegen_premium`); keep each check to one image.
- OpenAI runs are billed to the API organization (Promotional API credits first, then purchased credits). Keep requests small and record each one.
- A request can take a minute or more; a shot taken early shows the running card.
- The Codex endpoint returns PNG; the saved file is a re-encoded lossless WebP.
- Delete only the `omp-image-*` files this run created.
