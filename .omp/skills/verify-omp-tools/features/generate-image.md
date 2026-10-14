# generate_image

The plugin's `generate_image` creates or edits an image through the Codex Images endpoint with the user's Codex login. The result is a lossless WebP the model sees, saved to `$TMPDIR/omp-image-<id>.webp`. The tool card shows the prompt, size, quality, the saved path as a link, any near-limit warning, and the image.

## Sub-features

- `img-generate` creates an image from a prompt.
- `img-edit` edits an image given by absolute path, or the last images in the conversation.
- `img-card` shows the card with the image and the saved path.
- `img-error` shows an error card with the request id when the endpoint refuses.

## How to get to it (user POV)

- Ask the agent to generate or edit an image.

## Driving it with tern ctl

Preconditions:

- Baseline from `README.md`.
- An `openai-codex` login exists (`omp` model list shows Codex models).

- Generate. Run `$C type '"Use generate_image once: a small flat blue circle on white, size 1024x1024, low quality. Then reply with the saved path only."'`, `$C key Enter`, `sleep 60`, `$C shot img-generate`. The card shows the prompt, size, quality, a saved path, and the image.
- File. `ls -la "$TMPDIR"/omp-image-*.webp` lists the new file; `file` on it reports WebP.
- Edit. Run `$C type '"Use generate_image to edit that image: make the circle red. Then reply with the saved path only."'`, `$C key Enter`, `sleep 60`, `$C shot img-edit`. A second card shows a red circle and a second saved path.
- Second view. The main session JSONL's `toolResult` for `generate_image` has `details` with the request id, `generation_id`, and `usage.output_tokens`.

## Gotchas

- Each run draws on the account's daily image limit (`imagegen_premium`); keep prompts to one image at low quality.
- A request can take a minute or more; a shot taken early shows the running card.
- The endpoint returns PNG; the saved file is a re-encoded lossless WebP.
- Delete only the `omp-image-*.webp` files this run created.
