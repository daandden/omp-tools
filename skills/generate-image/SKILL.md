---
name: generate-image
description: Generate and edit images with the `generate_image` tool (Codex Images endpoint). Read before calling `generate_image`.
---

# Generating and editing images

Use `generate_image` for new images, for edits of attached, pasted, or earlier generated images, and for style changes. Generate right away, without asking the user to confirm.

The prompt goes to `gpt-image-2` verbatim: no model rewrites it and no system prompt is added. Everything the image needs must be in your prompt. Size and quality can't be set. Output is about 1.57 megapixels, its shape follows the prompt, and the server picks the quality (more concrete prompts tend to get higher quality).

For templates (product, portrait, illustration, icon, logo, diagram, UI) and before/after examples, read [prompt-patterns.md](prompt-patterns.md).

## New images

Write the prompt as a short spec in plain sentences, in this order:

1. **Purpose and image type**: what it is for and what it is ("Landing-page hero photo", "Flat vector diagram for a README").
2. **Scene and subject**: who or what, doing what, where.
3. **Details that matter**: medium and style, composition and framing, lighting (source, direction, quality, color), palette, materials and textures.
4. **Shape**: the orientation plus ratio in words, with the composition to match ("Wide 16:9 landscape, horizon in the lower third"; "Square, centered with generous padding").
5. **Constraints**: a short closing list of unwanted artifacts, such as "No text, no watermark, no logos."

Size the prompt to the request:
- Detailed request: keep it close to the user's words. Tidy it into the order above.
- Vague request: add only framing, polish level, and layout. Leave out characters, props, brands, slogans, and palettes the user didn't ask for.
- Complex scene: use short labeled lines ("Subject:", "Composition:", "Text:") or numbered panels.

Describe what fills the frame ("an empty cobblestone lane"). A phrase like "without cars" tends to summon cars. Keep explicit "No …" only for artifacts at the end.

Use concrete visual words ("soft window light from the left") instead of praise ("beautiful lighting", "8K, ultra-detailed"). For photos, write "photorealistic" and describe real texture. Use one or two camera cues at most; they steer the look, not exact optics.

Other tools' syntax does nothing here: `--ar`, `--no`, `::` weights, negative-prompt keyword lists. Say it in sentences.

## Text in the image

- Put the exact words in quotes and keep them short.
- Give the font style, size, color, and placement, and say how many times the text appears ("exactly once").
- End with "No other text."
- Spell rare words letter by letter: `"Qyrell" (Q-Y-R-E-L-L)`.
- For diagrams, charts, and UI, write the real labels and data as a spec, and describe a UI as if the product already ships.
- Check every word in the result. Numbers in charts are drawn, not computed, so check them against the data.

## Edits and reference images

Pick the references:
- `referenced_image_paths`: every image you need has a file. Generated images have one (the saved path). Put the image being edited first.
- `num_last_images_to_include`: only for images without a path, such as pasted images or tool output. Use the smallest N. Images are sent oldest first, so image 1 is the oldest of the N.
- Use one argument or the other in a call.

Write the edit prompt as one change plus a keep list:
- Give each image a number and a role: "Image 1: edit target. Image 2: style reference only."
- An image used only for style or mood makes the call a new image. Describe the new subject in full.
- State the change in one sentence: "Edit image 1: replace only the grey sofa with a brown leather chesterfield."
- Then list what stays unchanged, naming the parts at risk: face, features, skin tone, hair, pose, layout, camera angle, framing, lighting, labels, surrounding objects.
- For compositing, name the source, the destination, and what to match: "Place the dog from image 2 to the right of the woman in image 1; match lighting, perspective, scale, and shadows."
- For text edits, quote the old and new text: `Replace "Boiler" with "Caldera"; keep typography and placement.`
- Keep the original framing unless the user asks for a new shape.

To keep a character or product consistent across a series, pass the earlier images and repeat the same trait description word for word each time.

## Transparency

`transparent_background: true` alone is not enough, and a prompt that describes a backdrop wins over the flag.
- Set the flag and describe an isolated subject: "One die-cut sticker of an orange cat; everything outside the outline fully transparent. No backdrop, checkerboard, or shadow."
- For charts and icons, name the regions that stay transparent.
- On every later edit, set the flag again and write "Preserve the transparent background."
- A checkerboard painted into the result means the alpha channel was lost, which happens sometimes with reference images. Retry and restate the transparency.

## Review and iterate

Look at every result: text spelling, labels, the keep list, and the requested shape.
- To fix a result, send it back as image 1 with one change and the full keep list. Compare before adding more instructions.
- If edits drift or stack up, restart from the original with all accepted changes in one prompt.
- If one part regressed, send the original and the draft: "Image 1: original; image 2: draft. Keep image 2's new jacket; restore the face exactly as in image 1."
- If the reported quality is `low` on a new image, add concrete visual detail (materials, lighting, placement) and generate again.
- A region that must stay pixel-identical (an approved face, a logo, UI chrome) can't be guaranteed by prompting. Paste it back from the original with local tools.
- For an exact aspect ratio, crop the result.

## Files

Results are saved under `$TMPDIR`, which may be cleaned. When the project needs an image, copy it into the project and leave the original in place. The image is already shown to the user, so reply without embedding it as a Markdown image or file link.
