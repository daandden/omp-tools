---
name: generate-image
description: Generate and edit images with the `generate_image` tool. Read before calling `generate_image`.
---

# Generating and editing images

Use `generate_image` for new images, for edits of attached, pasted, or earlier generated images, and for style changes. Generate right away, without asking the user to confirm.

The prompt is used exactly as written, and the model sees nothing else: no conversation, no earlier prompts. Size and quality can't be set; the shape follows the prompt. Before every call, check the prompt against the criteria below: all of **Every prompt**, plus each section whose trigger applies.

## Every prompt

- **Purpose**: the first sentence states what the image is for and what kind of image it is (medium or type).
- **Subject**: one primary subject, named as a concrete, visible thing, ahead of everything secondary. Abstract ideas and moods are turned into visible content.
- **Coverage**: every element the user asked for is present. Nothing is added that the user didn't imply: no extra subjects, props, brands, slogans, or palettes.
- **Visible terms**: every modifier names a visible property (light source and direction, material, color, texture, expression). No praise, quality boosters, emphasis by repetition, weights, or other tools' flags.
- **Binding**: the prompt is written in grammatical sentences, and each attribute sits next to the noun it describes. Keyword lists are rewritten as sentences.
- **Positive content**: scene content says what is there, not what is absent. A user's "without X" is rewritten as the state that replaces X.
- **Constraints last**: the prompt ends with a short list of what must stay the same and which artifacts to exclude (text, watermarks, logos, and any direction the user rejected).
- **Density**: each requirement is stated once. Detail goes into scene-level properties (setting, lighting, style, palette) before per-object detail. A crowded request keeps the composition the user asked for; manage it with labeled lines, a stated layout (rows, regions, foreground and background), and short per-object descriptions. Offer panels or separate images only as a suggestion to the user.
- **Checkable**: each requirement can be verified by looking at the result.

## When the content calls for it

- **Shape** (new images): orientation and aspect ratio in words, with a composition that fits. In tall formats, keep important content away from the bottom edge.
- **Setting**: say where the scene is, or that the subject is isolated. For historical or real events, name the place and period.
- **Mood or brand tone**: express it as light, palette, expression, and density, not adjectives alone.
- **Exact colors**: pair each hex code with a color name and the object it applies to. State color temperature and sharpness whenever the intent is neutral, cool, soft, or blurred.
- **Several objects**: each object gets its own phrase with its own attributes. Instances of the same kind are listed one by one, each with what sets it apart.
- **Counts**: numerals with an unambiguous unit. Larger counts also get an arrangement. "Every" or "all" is backed by a count.
- **Placement**: each placement names the object, an anchor (another named object or a region of the frame), and whose left or right is meant. Placements that go against normal expectations are stated explicitly.
- **Actions**: say who does what to whom, in the active voice. For several people, give each one's pose and points of contact.
- **People**: framing (including whether the full body shows), gaze, and interaction with objects.
- **Specialist terms**: rare species, products, and proper nouns come with their visible traits.
- **Style**: named precisely (technique, medium, era). When the style is unusual for the subject, say how the subject should look in it.
- **Photos**: ask for photorealism and real texture; give the vantage point, time of day, and light sources. At most one or two camera cues.
- **Overlay space**: when copy or UI will go on top, name an empty, plain region and where it is.
- **Sets**: the same spec is repeated word for word in every call, one image per call, with only the differences changed. Earlier images are passed as references.

## Text, data, and graphics

- Every rendered string is quoted exactly, short, and essential. Text the user supplied is copied character for character, never reworded or expanded. Long or legal copy is added afterwards, outside the image.
- Each string has a font style, size, color, placement, and count, on a contrasting plain area. Its language and script are stated when they are not English.
- Rare words are spelled out letter by letter.
- The prompt states that no other text is allowed.
- Diagrams, charts, slides, and UI are written as a spec: the real labels and data, the required components, and a layout. Facts and numbers come from the prompt, not the model's knowledge. A UI is described as a finished product. Meaning never depends on color alone.
- A new logo, mascot, or character that the prompt designs from scratch is requested as original, with no existing trademarks. A character or mark the user supplies or references keeps its identity, as in any keep list. When an existing logo must match its official artwork exactly, leave its area clear and composite the official file afterwards.
- Icons: one concept, few simple shapes, consistent stroke and perspective, centered with padding, no text.

## Edits and reference images

References:
- `referenced_image_paths` when every image you need has a file, including earlier generated images (use the saved path). Paths must be absolute. The image being edited goes first.
- `num_last_images_to_include` only for images without a path. Use the smallest N. Image 1 is the oldest of the N.
- Use one or the other, never both. Send as few references as the task needs.

Every edit prompt:
- **Roles first**: each image's number and role are declared before the instruction. When images are combined, say which one is the base that sets the framing. References used only for style make a new image, so describe the new subject in full.
- **Operation**: an explicit verb (add, remove, replace, change, restyle, translate) for one operation per call.
- **Scope and target**: the named object or region, or the whole image. When several similar objects exist, pick out the target by an attribute or position.
- **End state**: the result described as visible properties, never as "improve" or "fix".
- **Keep list**: what stays unchanged (identity and features, pose, layout, framing, lighting, labels, nearby objects), naming nothing the edit changes. Unchanged content is not described again.
- **Framing**: the original framing is kept unless the user asks for a new shape.

By operation:
- **Add**: what, where relative to an anchor, how large, and how it blends in (lighting, shadow, contact, perspective).
- **Remove**: what fills the vacated area, and which nearby objects stay.
- **Replace**: the old and the new object. The new one takes the old one's position, scale, and pose.
- **Change an attribute**: a concrete target value, and the details on the object that must survive.
- **Restyle**: the direction (restyle this image keeping its composition, or new content in this style), with concrete style properties and no new elements.
- **Background**: the subject locked, the new setting described, and whether the subject is relit to match.
- **Text or translation**: the old and new strings quoted, or the target language and which text is in scope. Typography and placement are kept.
- **Compose**: each moved element's source, destination, and what it must match, plus one sentence describing the final scene.
- **Outcome edits** (aging, weather, time passing): the visible result stated explicitly.

Follow-up edits:
- Each follow-up restates every constraint accepted earlier. It has no pronouns or references to earlier turns.
- To go back, send the version to return to and name it.
- After two or three chained edits, or at the first sign of drift, restart from the original with all accepted changes in one prompt.

## Transparency

- Set `transparent_background: true` and describe an isolated subject on a fully transparent background, with no backdrop, checkerboard, or shadow. Any backdrop the prompt describes overrides the flag.
- For charts and icons, name the regions that stay transparent.
- On every later edit, set the flag again and ask to preserve the transparent background.
- A checkerboard painted into the result means transparency was lost: retry and restate it.

## Review and iterate

Check the result against every requirement in the prompt: coverage, text spelling, counts, placement, the keep list, and the shape.
- If a new image misses one requirement, resend the same prompt once before changing it.
- Rewrite a new-image prompt as one integrated description, not the old one with a patch added. If quality is `low`, add scene-level detail (lighting, materials, setting), not more elements.
- Fix an edit one thing per call: send the result back as image 1 with the change and the full keep list.
- If one part regressed, send the original and the draft with roles, and say which parts to take from each.
- For regions that must stay pixel-identical, paste them back from the original with local tools. For an exact aspect ratio, crop.
- Tell the user about anything the tool can't deliver: vector output, exact pixel sizes, an exact match to official logo artwork.

## Files

Results are saved under `$TMPDIR`, which may be cleaned. When the project needs an image, copy it into the project and leave the original in place. The image is already shown to the user, so don't embed it in the reply.
