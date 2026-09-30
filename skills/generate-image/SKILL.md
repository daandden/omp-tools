---
name: generate-image
description: Generate and edit images with the `generate_image` tool (Codex Images endpoint). Read before calling `generate_image`.
---

# Generating and editing images

Use `generate_image` to create new images, edit attached, pasted, or earlier generated images, and change an image's style. Generate right away. Don't ask the user to confirm first.

## Prompt

- Write one complete prompt: the subject, setting, composition, lighting, and style. Put any exact text to render in quotes.
- State the aspect ratio in words (for example "wide 16:9 landscape" or "tall portrait"). Size and quality can't be set. The output is about 1.57 megapixels, its shape follows the prompt, and the server picks the quality.
- For an edit, say what to change and what must stay the same.

## Transparency

- Set `transparent_background: true` for cutouts, stickers, icons, and background removal.
- When you edit an image that already has transparency, set it again to keep it.

## Reference images

- Use `referenced_image_paths` when every image you need has a file. The paths must be absolute.
- Use `num_last_images_to_include` only for images that have no path, such as pasted images or images shown by a tool. Choose the smallest N that covers them. It counts back from the newest image in the conversation.
- Never use both arguments in one call.
- In the prompt, refer to the references in the order they are sent: "image 1", "image 2", and so on. With `num_last_images_to_include`, image 1 is the oldest of the N.

## After generating

- Look at the returned image. If the reported quality is `low` or the result misses the brief, add detail to the prompt and generate again.
- The image is saved under `$TMPDIR`, and that directory may be cleaned. When the project needs the image, copy it into the project and leave the original in place.
- The image is already shown to the user. Don't embed it again as a Markdown image or file link.
