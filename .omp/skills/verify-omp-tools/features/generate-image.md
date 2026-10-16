# generate_image

The plugin's `generate_image` creates or edits an image through the Codex Images endpoint with the user's Codex login. The tool takes a prompt, an optional transparent background, and references (absolute paths, or the last N conversation images). Size and quality are not arguments: the endpoint picks them and the card shows what it reported. The result is a lossless WebP the model sees, saved to `$TMPDIR/omp-image-<id>.webp`. The tool card shows the prompt's first line, the reference count, the reported size and quality, the saved path as a link, any near-limit warning, and the image.

## Sub-features

- `img-generate` creates an image from a prompt.
- `img-edit` edits an image given by absolute path, or the last images in the conversation.
- `img-card` shows the card with the image and the saved path.
- `img-error` shows an error card. An endpoint refusal appends the request id when the endpoint sent one.

## How to get to it (user POV)

- Ask the agent to generate or edit an image.

## Driving it with tern ctl

Preconditions:

- Baseline from `README.md`.
- An `openai-codex` login exists (`omp` model list shows Codex models).

- Generate. Run `$C type '"Use generate_image once with the prompt: a small flat blue circle centered on a plain white background. Then reply with the saved path only."'`, `$C key Enter`. When `$C tree` contains `Saved to`, run `$C shot img-generate`. The card shows `Generate image`, the prompt, the reported size and quality (for example `1254x1254` and `quality low`), `Saved to <path>`, and the image.
- File. `file` on the saved path reports `Web/P image`.
- Edit by path. Run `$C type '"Use generate_image once to edit <saved path> (pass it in referenced_image_paths): make the circle red, keep everything else. Then reply with the saved path only."'`, `$C key Enter`, wait for a second `Saved to`, `$C shot img-edit`. A second card shows `1 reference`, a red circle, and a second saved path.
- Error. Run `$C type '"This is an argument check. Call generate_image exactly once with prompt \"validation check\", referenced_image_paths [\"relative.webp\"], and num_last_images_to_include 1. Do not retry or fix the arguments after the error; reply with the error text only."'`, `$C key Enter`, `sleep 15`, `$C shot img-error`. The card shows `referenced_image_paths and num_last_images_to_include cannot be used together.` This check sends no request, so it costs no image.
- Second view. When `generate_image` is mounted as an `xd://` device (as in a session with `tools.xdev` on), its result is a `write` tool result. Read it with `jq -c 'select(.type=="message" and .message.role=="toolResult" and .message.details.xdev.tool=="generate_image") | .message.details.xdev.inner' <session>.jsonl`. It shows `path`, `size`, `quality`, `requestId`, `generationId`, and `outputTokens`. A top-level `generate_image` puts the same keys in `.message.details` of a `generate_image` tool result.

## Gotchas

- Each run draws on the account's daily image limit (`imagegen_premium`); keep each check to one image.
- A request can take a minute or more; a shot taken early shows the running card.
- The endpoint returns PNG; the saved file is a re-encoded lossless WebP.
- Delete only the `omp-image-*.webp` files this run created.
