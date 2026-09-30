# Prompting gpt-image-2 edits and multi-reference composition

Sources:
- **OAI-P**: [OpenAI image prompting guide](https://developers.openai.com/api/docs/guides/image-prompting). Its GPT Image 2 section defers to the shared edit techniques; the guide's sample outputs use 2.5 models.
- **OAI-G**: [OpenAI image generation guide](https://developers.openai.com/api/docs/guides/image-generation).
- **CB**: [OpenAI cookbook, gpt-image-2, archived](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide).
- **CX**: Codex imagegen skill, [SKILL.md](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/skills/src/assets/samples/imagegen/SKILL.md) and [prompting.md](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/skills/src/assets/samples/imagegen/references/prompting.md).
- **CXT**: [Codex tool description](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/image-generation/imagegen_description.md).
- **GEM**: [Gemini image docs](https://ai.google.dev/gemini-api/docs/image-generation).
- **BFL**: [Kontext editing](https://docs.bfl.ai/kontext/kontext_image_editing) and [FLUX.2 guide](https://docs.bfl.ai/guides/prompting_guide_flux2).

## 1. Cited findings

**What changes and what stays the same**
- Put "change only X" and the list of things to preserve in separate statements. The list covers identity, geometry, layout, lighting, and labels; for precise edits it also covers saturation, contrast, arrows, camera angle, and surrounding objects. Repeat that list on every iteration. [PRIMARY] OAI-P, CB §2, CX.
- OpenAI's own edit prompts are short: "Remove the flower from man's hand. Do not change anything else." [PRIMARY] OAI-P.
- Preservation isn't guaranteed. "If a region must remain pixel-identical, composite the approved edit into the original image instead of relying on prompting alone." [PRIMARY] OAI-P.
- gpt-image-2 always processes input images at high fidelity, and `input_fidelity` can't be changed. [PRIMARY] OAI-G. The prompt is therefore the only lever for preservation. [INFERENCE]
- Even API masks are "entirely prompt-based", and they apply to the first image. [PRIMARY] OAI-G. This tool sends no mask, so the target region has to be named in words. Gemini calls this "semantic masking": "change only the [element] … Keep everything else … exactly the same". [PRIMARY GEM; transferable, and it matches OpenAI's wording]
- To keep a critical detail such as a face or logo intact, describe it "in great detail along with your edit request". [PRIMARY GEM; probably transferable, INFERENCE]

**Identity**
- Lock the face, features, skin tone, body shape, pose, hair, and expression. Replace only the target. Match lighting, shadows, and color temperature "without looking pasted on". This "also applies to edits where a product or object must remain recognizable". [PRIMARY] OAI-P.
- For a recurring character, pass the earlier character image as input and restate its defining traits, e.g. "Do not redesign the character". [PRIMARY] OAI-P, CX. Gemini says the same: include prior outputs to keep consistency. [PRIMARY GEM, transferable]
- OpenAI lists cross-generation consistency and precise placement as known limitations. [PRIMARY] OAI-G.

**Multiple references**
- Identify each input "by number and purpose: subject, style, clothing, or background". Explain "which elements should move where". [PRIMARY] OAI-P. The Codex form is `Image 1: edit target; Image 2: style reference`. [PRIMARY] CX
- Images supplied only for style or mood make the request a *generation with references*, not an edit. [PRIMARY] CX.
- OpenAI's example: "Place the dog from the second image into the setting of image 1, right next to the woman … Do not change anything else." [PRIMARY] OAI-P. Gemini and FLUX.2 use the same index convention. [PRIMARY; transferable]
- Gemini fidelity drops as inputs are added (≤3 images for 2.5 Flash, 5 for 3 Pro). [PRIMARY GEM] Fewer references probably help gpt-image-2 too. [INFERENCE]

**Style transfer**
- Give the reference a specific role (palette, texture, medium), describe the new subject separately, and add "no extra elements". [PRIMARY] OAI-P, CB §5.1.
- There are two directions:
  - New content in the reference's style: "Use the same style from the input image and generate a man riding a motorcycle on a white background". [PRIMARY OAI-P]
  - Restyle an image while keeping its content: "Preserve the original composition … but render it with…". [PRIMARY GEM]

**Cutouts and transparency**
- The prompt must ask for the isolated subject in addition to the transparency flag. "Extract the product … isolate it on a fully transparent background … no halos/fringing. Preserve product geometry and label legibility exactly … Do not add a solid backdrop, checkerboard, scenery, or shadow." "A drawn checkerboard is not transparency." "For subsequent edits, repeat the requirement to preserve the transparent background." [PRIMARY] OAI-P, CB.
- CXT: "For edits, preserve existing transparency unless the user asks to change it." [PRIMARY]
- Alpha is sometimes lost when a reference is supplied: the output is RGB with a checkerboard painted in. This is intermittent and the cause isn't isolated. [SECONDARY] [openai/codex#42743](https://github.com/openai/codex/issues/42743).

**Iteration**
- "Pass the previous output as the next edit input, request one change, and repeat the details to preserve … Compare results before adding more instructions." [PRIMARY] OAI-P.
- Corrective follow-ups such as "restore the original background" are expected. [PRIMARY] CB §2.
- Gemini and BFL also recommend single-change iteration. [PRIMARY; transferable]

**Advice that does not transfer**
- "FLUX.2 does not support negative prompts." [PRIMARY BFL] gpt-image-2 examples use "no…" and "Do not…" throughout, so this rule doesn't carry over.
- BFL's colored annotation boxes aren't documented for GPT Image. [INFERENCE: untested]
- BFL's `Replace '[old]' with '[new]'` form for text edits matches Codex's text-localization sample. [PRIMARY; transferable]

## 2. Rules for the agent

1. **Say whether the request is an edit or a new image, and give every image a role.**
   - Before: `Make a poster like this with a fox.`
   - After: `Create a new poster. Image 1 is a style reference only: copy its palette, paper texture, and ink linework. Subject: a red fox on a snowy hill. No extra elements, no text.`
2. **Send the edit target as image 1** when using `referenced_image_paths`. [INFERENCE from the first-image rule for masks] With `num_last_images_to_include` the order is chronological, so name the roles explicitly.
3. **Edit prompt = one change plus the preserve list.** Don't re-describe the whole scene; that invites re-rendering. [INFERENCE]
   - Before: `A sunny living room with a grey sofa, oak floor, plants, big windows…`
   - After: `Edit image 1: replace ONLY the grey sofa with a brown leather chesterfield. Keep the pillows, floor, plants, lighting, shadows, camera angle, and framing unchanged.`
4. **Lock identity feature by feature.**
   - Before: `Put her in a red dress.`
   - After: `Edit image 1: dress the woman in the red dress from image 2. Do not change her face, features, skin tone, hair, expression, body shape, or pose. Match the original lighting. Keep the background and framing unchanged.`
5. **Compositing: name the source, the destination, and what to match.**
   - Before: `Add the dog.`
   - After: `Place the dog from image 2 into image 1, sitting right of the woman. Match image 1's lighting, perspective, scale, and shadows. Change nothing else.`
6. **Text edits: quote the old and new text.**
   - Before: `Translate to Spanish.`
   - After: `Replace "Boiler" with "Caldera" and "Water Tank" with "Depósito de agua". Change only the text; preserve typography, placement, and spacing. No extra words.`
7. **Transparency: set `transparent_background: true` and say it in the prompt, on every step.**
   - Before: `Remove the background.`
   - After: `Extract the bottle from image 1 onto a fully transparent background. Crisp silhouette, no halos. Preserve its geometry and label exactly. No backdrop, scenery, or shadow; do not restyle it.`
   - On later edits, add `Preserve the transparent background.`
   - After any edit that uses a reference, confirm the result has real alpha. A painted checkerboard means the alpha channel was lost.
8. **Choose which image to send next.**
   - **Latest result:** it's accepted and needs one more change. Restate the preserve list.
   - **Original:** the result drifted or the edits have stacked up. Fold all the accepted changes into one prompt.
   - **Both:** one part regressed. Example: `Image 1: original; image 2: current draft. Keep image 2's new jacket but restore the face and background exactly as in image 1.` [INFERENCE]
   - Generated outputs have file paths, so send them with `referenced_image_paths`.
9. **Fix one thing per retry.**
   - Before: `Redo it with warmer light, different pose, and no lamp.`
   - After: `Edit image 1: remove only the floor lamp. Keep everything else unchanged.`
10. **Pixel-exact regions** (an approved face, a logo, UI chrome): composite them back from the original with local tooling. Don't try to prompt them back. [PRIMARY OAI-P]
11. **Framing:** for an edit, say `keep image 1's framing and aspect ratio` unless the user wants a new shape. [INFERENCE: output shape follows the prompt text]

## 3. Conflicts with the current SKILL.md

- **Line 12 ("one complete prompt: subject, setting, composition, lighting, style")** is written for generation. OpenAI's edit prompts are short targeted instructions plus a preserve list. The rule should be split.
- **Line 13 ("state the aspect ratio")** can fight layout preservation in edits. The default for edits should be to keep the original framing.
- **Line 14** is right but too thin. It needs:
  - repeating the preserve list on every iteration
  - identity locks, feature by feature
  - the pixel-exact limit and the compositing fallback
- **Line 26** is correct but should add:
  - a role for every image
  - reference-only images mean a new generation, not an edit (CX)
  - the edit target goes first when sending paths
- **Lines 18–19** cover only the flag. OpenAI also requires the prompt to ask for the isolated subject, and to repeat "preserve the transparent background" on later edits. The skill should warn that alpha can be lost when a reference is supplied (#42743).
- **Line 30 ("add detail and generate again")** is the wrong fix for edits. OpenAI says to make one targeted change, restate the constraints, and compare. The skill also doesn't say whether to send the original or the latest result.
