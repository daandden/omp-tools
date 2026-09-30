---
name: generate-image
description: Generate and edit images with the `generate_image` tool. Read before calling `generate_image`.
---

# Generating and editing images

Use `generate_image` for new images, for edits of attached, pasted, or earlier generated images, and for style changes. Generate right away, without asking the user to confirm.

The prompt is used exactly as written, so put everything the image needs in it. Size and quality can't be set: the shape follows the prompt, and more concrete prompts get higher quality.

## New images

Write the prompt as a short spec in plain sentences, in this order:

1. **Purpose and image type**: what the image is for and what kind of image it is.
2. **Scene and subject**: who or what, doing what, where.
3. **Details that matter**: medium and style, composition, lighting (source, direction, color), palette, materials.
4. **Shape**: orientation and aspect ratio in words, with a composition that fits it.
5. **Exclusions**: a short closing list of unwanted artifacts such as text, watermarks, or logos.

- Detailed request: keep the user's words, arranged in this order.
- Vague request: add only framing, polish, and layout. Add no props, brands, slogans, or palettes the user didn't ask for.
- Complex scene: use labeled lines or numbered panels.
- Describe what fills the frame, not what is absent.
- Use concrete visual descriptions, not praise or resolution buzzwords. For photos, ask for photorealism and describe real texture.
- Write plain sentences, not other tools' flags, weights, or keyword lists.

## Text in the image

- Quote the exact words and keep them short.
- Give the font style, size, color, and placement, and how many times the text appears.
- State that no other text is allowed.
- Spell rare words letter by letter.
- For diagrams, charts, and UI, write the real labels and data as a spec, and describe a UI as a finished product.

## Edits and reference images

Pick the references:
- `referenced_image_paths`: when every image you need has a file, including earlier generated images (use the saved path). Paths must be absolute. Put the image being edited first.
- `num_last_images_to_include`: only for images without a path, such as pasted images. Use the smallest N. Image 1 is the oldest of the N.
- Use one argument or the other, never both.

Write the edit prompt as one change plus a keep list:
- Give each image a number and a role, such as edit target, source of an element, or style reference.
- Style-only references make a new image, so describe the new subject in full.
- State the one change, naming exactly what changes.
- List what stays unchanged: identity and features, pose, layout, camera angle, framing, lighting, labels, other objects.
- When combining images, name the source element, where it goes, and what it must match (lighting, perspective, scale, shadows).
- For text edits, quote both the old and the new text, and keep the typography and placement.
- Keep the original framing unless the user asks for a new shape.
- For a consistent character or product across a series, pass the earlier images and repeat the same trait description each time.

## Transparency

- Set `transparent_background: true` and also describe an isolated subject on a fully transparent background, with no backdrop, checkerboard, or shadow. Describing a backdrop overrides the flag.
- For charts and icons, name the regions that stay transparent.
- On every later edit, set the flag again and ask to preserve the transparent background.
- A checkerboard painted into the result means transparency was lost: retry and restate it.

## Review and iterate

Look at every result: spelling, labels, chart numbers, the keep list, and the shape.
- Fix one thing per call: send the result back as image 1 with the change and the full keep list.
- If edits drift, restart from the original with all accepted changes in one prompt.
- If one part regressed, send the original and the draft with roles, and say which parts to take from each.
- If a new image reports quality `low`, add concrete detail (materials, lighting, placement) and generate again.
- For regions that must stay pixel-identical, paste them back from the original with local tools.
- For an exact aspect ratio, crop the result.

## Files

Results are saved under `$TMPDIR`, which may be cleaned. When the project needs an image, copy it into the project and leave the original in place. The image is already shown to the user, so don't embed it in the reply.
