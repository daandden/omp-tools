# generate_image

The plugin's `generate_image` creates or edits images in one of two Image generation modes, chosen by the plugin setting `imageGenerationMode` when the session starts:

- OpenAI mode (`openai`, the default): GPT Image 2.6 Sunburst through `api.openai.com/v1/images/*` with the `openai` API key. Its arguments include `n`, `quality`, `complexity`, `size`, `background`, `output_format`, `output_compression`, `frame_count`, `frame_duration_ms`, `svg`, `moderation`, `safety_identifier`, `user`, `stream`, `partial_images`, `referenced_image_paths`, `num_last_images_to_include` (1–16), `images`, `mask`, and `markup`. There is no per-call `model`. With `output_format` omitted, the result is a lossless WebP made locally from PNG; an explicit format keeps the API's bytes. GIF and SVG are generation-only without references, streaming, or compression; SVG also requires `n` 1 or omitted. GIF supports 2–16 frames at 20–2000 ms per frame, default 9 at 200 ms. SVG uses the session's `svgAuthorModel` setting (default `gpt-6.1-sol`), overridden by `svg.model` and optional `svg.reasoning.effort`. Raster streaming shows unsaved previews on the card.
- Codex mode (`codex`): the Codex Images endpoint with the user's Codex login. The tool takes a prompt, an optional transparent background, and references (absolute paths, or the last 1–5 conversation images). Size and quality are not arguments: the endpoint picks them and the card shows what it reported. The result is a lossless WebP.

Results are saved to `$TMPDIR/omp-image-<id>.<webp|png|jpg|gif|svg>`. Raster results go to the model as image content, including unchanged `image/gif` content; SVG returns only its saved path and an instruction to read the file. The tested Claude Haiku 5.5 and Codex gpt-6-luna routes saw only the GIF's first frame. The tool card shows the prompt's first line, the reference count and mode settings, the reported size and quality, each saved path as a link, any Codex near-limit warning, and raster images.

## Sub-features

- `img-mode` registers the configured mode's arguments under the one `generate_image` name.
- `img-generate` creates an image from a prompt.
- `img-edit` edits an image given by absolute path, or the last images in the conversation.
- `img-multi` (OpenAI) returns `n` images with one saved path each.
- `img-format` (OpenAI) keeps an explicit `output_format`'s bytes and extension.
- `img-stream` (OpenAI) shows partial previews, then the final image.
- `img-mask` (OpenAI) edits with a `mask` or `markup`.
- `img-card` shows the card with the images and saved paths.
- `img-error` shows an error card. An endpoint refusal appends the request id when the endpoint sent one.

## How to get to it (user POV)

- Ask the agent to generate or edit an image.
- Choose the mode with `omp plugin config set omp-tools imageGenerationMode openai|codex`, then start a new session.

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
- Set the mode per session without touching the user's global plugin settings: start OMP from a scratch project directory whose `.omp/plugin-overrides.json` is `{"settings":{"omp-tools":{"imageGenerationMode":"openai"}}}` (or `"codex"`), with `sh -c 'cd <scratch project> && exec omp …'`. Project overrides win over the global value.

Schema (`img-mode`). In each mode, run `$C type '"List the parameter names of the generate_image tool, comma-separated, and nothing else."'`, `$C key Enter`, `sleep 15`, `$C shot img-mode-<mode>`. OpenAI mode lists `size`, `complexity`, `frame_count`, `frame_duration_ms`, `svg`, and `mask`, but neither `model` nor `transparent_background`; Codex mode lists exactly `prompt`, `transparent_background`, `referenced_image_paths`, `num_last_images_to_include`. Only one `generate_image` tool exists: the session's tool list (the `/tools` command or the RPC `get_state`) has no second image tool.

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

Mode switch (`img-mode-switch`, no request): in a session started in Codex mode, set the project's `.omp/plugin-overrides.json` `imageGenerationMode` to `openai`, run `$C type /new`, `$C key Enter`, then ask for the `generate_image` parameter names. The list is OpenAI mode's, with `n` and `mask` and without `transparent_background`.

Errors (no request, no cost):

- Codex mode: run `$C type '"This is an argument check. Call generate_image exactly once with prompt \"validation check\", referenced_image_paths [\"relative.webp\"], and num_last_images_to_include 1. Do not retry or fix the arguments after the error; reply with the error text only."'`, `$C key Enter`, `sleep 15`, `$C shot img-error`. The card shows `referenced_image_paths and num_last_images_to_include cannot be used together.`
- OpenAI mode: the same check with `background "transparent"` and `output_format "jpeg"`. The card shows `background "transparent" needs output_format png or webp`.
- OpenAI mode without an `openai` key: any generation request shows the error naming `OPENAI_API_KEY`, the Codex login, and `imageGenerationMode`. No request goes out.

Second view. When `generate_image` is mounted as an `xd://` device (as in a session with `tools.xdev` on), its result is a `write` tool result. Read it with `jq -c 'select(.type=="message" and .message.role=="toolResult" and .message.details.xdev.tool=="generate_image") | .message.details.xdev.inner' <session>.jsonl`. It shows `mode` and `outputs` (each `path`, `mimeType`, `size`, `quality`); Codex mode adds `requestId`, `generationId`, and `outputTokens`, and OpenAI mode adds `requested`, `reported`, `usage`, and `requestId`, plus `svgUsage` when the API returns it. `requested` includes complexity, frame controls, and the sent `svg` object. A top-level `generate_image` puts the same keys in `.message.details` of a `generate_image` tool result.

## Gotchas

- Codex runs draw on the account's daily image limit (`imagegen_premium`); keep each check to one image.
- OpenAI runs are billed to the API organization (Promotional API credits first, then purchased credits). Keep requests small and record each one.
- A request can take a minute or more; a shot taken early shows the running card.
- The Codex endpoint returns PNG; the saved file is a re-encoded lossless WebP.
- Delete only the `omp-image-*` files this run created.
