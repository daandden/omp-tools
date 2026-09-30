---
name: generate-image
description: Generate and edit images with the `generate_image` tool. Read before calling `generate_image`.
---

# Generating and editing images

Use `generate_image` for new images, for edits of attached, pasted, or earlier generated images, and for style changes. Generate right away, without asking the user to confirm.

The prompt is used exactly as written, so put everything the image needs in it. Size and quality can't be set: the shape follows the prompt, and more concrete prompts get higher quality.

Templates and before/after examples: [prompt-patterns.md](prompt-patterns.md).

## New images

Write the prompt as a short spec in plain sentences, in this order:

1. **Purpose and image type**: "Landing-page hero photo", "Flat vector diagram for a README".
2. **Scene and subject**: who or what, doing what, where.
3. **Details that matter**: medium and style, composition, lighting (source, direction, color), palette, materials.
4. **Shape** in words, with the composition to match: "Wide 16:9 landscape, horizon in the lower third"; "Square, centered with generous padding".
5. **Exclusions** at the end: "No text, no watermark, no logos."

- Detailed request: keep the user's words, tidied into this order.
- Vague request: add only framing, polish, and layout. Leave out props, brands, slogans, and palettes nobody asked for.
- Complex scene: use labeled lines ("Subject:", "Composition:", "Text:") or numbered panels.
- Describe what fills the frame ("an empty cobblestone lane"), not what is missing ("no cars").
- Use concrete visual words ("soft window light from the left"), not praise ("beautiful lighting", "8K"). For photos, write "photorealistic" and describe real texture.
- Write plain sentences, not `--ar`, `--no`, `::` weights, or keyword lists.

## Text in the image

- Put the exact words in quotes and keep them short.
- Give the font style, size, color, and placement, and say how many times the text appears ("exactly once").
- End with "No other text."
- Spell rare words letter by letter: `"Qyrell" (Q-Y-R-E-L-L)`.
- For diagrams, charts, and UI, write the real labels and data as a spec, and describe a UI as if the product already ships.

## Edits and reference images

Pick the references:
- `referenced_image_paths`: when every image you need has a file, including earlier generated images (use the saved path). Paths must be absolute. Put the image being edited first.
- `num_last_images_to_include`: only for images without a path, such as pasted images. Use the smallest N. Image 1 is the oldest of the N.
- Use one argument or the other, never both.

Write the edit prompt as one change plus a keep list:
- Give each image a number and a role: "Image 1: edit target. Image 2: style reference only."
- Style-only references make a new image, so describe the new subject in full.
- State the change: "Edit image 1: replace only the grey sofa with a brown leather chesterfield."
- List what stays unchanged: face, features, hair, pose, layout, camera angle, framing, lighting, labels, other objects.
- Compositing: "Place the dog from image 2 to the right of the woman in image 1; match lighting, perspective, scale, and shadows."
- Text edits: `Replace "Boiler" with "Caldera"; keep typography and placement.`
- Keep the original framing unless the user asks for a new shape.
- For a consistent character or product across a series, pass the earlier images and repeat the same trait description each time.

## Transparency

- Set `transparent_background: true` and also describe an isolated subject: "One die-cut sticker of an orange cat; everything outside the outline fully transparent. No backdrop, checkerboard, or shadow." Describing a backdrop overrides the flag.
- For charts and icons, name the regions that stay transparent.
- On every later edit, set the flag again and write "Preserve the transparent background."
- A checkerboard painted into the result means transparency was lost: retry and restate it.

## Review and iterate

Look at every result: spelling, labels, chart numbers, the keep list, and the shape.
- Fix one thing per call: send the result back as image 1 with the change and the full keep list.
- If edits drift, restart from the original with all accepted changes in one prompt.
- If one part regressed, send both: "Image 1: original; image 2: draft. Keep image 2's new jacket; restore the face exactly as in image 1."
- If a new image reports quality `low`, add concrete detail (materials, lighting, placement) and generate again.
- For regions that must stay pixel-identical (an approved face, a logo), paste them back from the original with local tools.
- For an exact aspect ratio, crop the result.

## Files

Results are saved under `$TMPDIR`, which may be cleaned. When the project needs an image, copy it into the project and leave the original in place. The image is already shown to the user, so don't embed it in the reply.
