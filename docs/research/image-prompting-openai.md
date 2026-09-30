# Prompting GPT Image models: OpenAI first-party guidance

Researched on 2026-09-30. Sources were pinned where possible: cookbook at `2182005b` and `openai/codex` at `d4205609`. No images were generated.

Source keys:

- [IP]: API image prompting guide
- [IG]: API image generation guide
- [CB2]: Cookbook gpt-image-2 guide
- [CB15]: Cookbook gpt-image-1.5 guide
- [CBT]: Cookbook transparent-assets notebook
- [CBG]: Cookbook gpt-image-1 notebook
- [CX]: Codex image-generation doc
- [AC]: OpenAI Academy
- [HC]: Help Center "Images in ChatGPT"
- [SK]: codex bundled imagegen `prompting.md`, `SKILL.md`, and `sample-prompts.md`
- [TD]: codex `imagegen_description.md`

## 1. Cited findings

**Structure and ordering**
- Write in a consistent order: scene/backdrop → subject → key details → constraints. Name the intended use (ad, UI mock, infographic) to set the "mode" and the level of polish. For complex requests, use short labeled segments instead of one paragraph. [PRIMARY] [CB2] [IP] [SK]
- Format matters less than clarity. Plain prose, JSON-like text, instruction style, and tag lists all work. Prefer a format that is easy to skim over clever syntax. [PRIMARY] [CB2] [IP]
- Optional labeled schema (codex skill): `Use case / Asset type / Primary request / Input images / Scene/backdrop / Subject / Style/medium / Composition/framing / Lighting/mood / Text (verbatim) / Constraints / Avoid`; "use only the lines that help." [PRIMARY] [SK]

**Level of detail**
- "A useful image prompt is often only one to three clear sentences." Include the purpose or audience, the subject and what is happening, and the setting, composition, and style. Add framing, dimensions, lighting, colors, or materials only when they matter. State constraints. [PRIMARY] [CX] [AC]
- Specificity policy: if the user's prompt is already detailed, normalize it and add no creative requirements. If it is generic, add only detail that materially helps (framing, polish level, layout, scene concreteness). Never invent characters, props, brands, slogans, palettes, story beats, or left/right placement the request doesn't imply. [PRIMARY] [SK]
- Use concrete visual language rather than evaluative words: write "soft natural light from a window on the left", not "beautiful lighting". [PRIMARY] [CX] [AC]
- With `quality: auto`, the model "will automatically select the best option based on the prompt". [PRIMARY] [IG] Longer, detailed prompts getting higher quality on the Codex endpoint is an observation, not documented. [INFERENCE]

**Style, medium, and photorealism**
- Name the medium (photo, watercolor, 3D render) and the materials and textures. Add "quality levers" such as *film grain*, *textured brushstrokes*, or *macro detail* only when needed. [PRIMARY] [CB2]
- For photorealism, "include the word 'photorealistic' directly … to strongly engage the model's photorealistic mode". Camera specs "may be interpreted loosely", so use them for look and composition only. The 1.5-era guide also preferred camera and composition terms over "generic '8K/ultra-detailed'". [PRIMARY] [CB2] [CB15]
- To make a photo feel natural, prompt as if a real photo is being captured in the moment. Ask for real texture (pores, wrinkles, fabric wear) and avoid words that imply studio polish. [PRIMARY] [CB2]
- For wide, cinematic, low-light, rain, or neon scenes, describe scale, atmosphere, and color so the model "does not trade mood for surface realism". [PRIMARY] [CB2] [IP]
- For people, describe framing, scale, gaze, and interactions, for example "full body visible, feet included" or "looking down at the open book". [PRIMARY] [IP]

**Text rendering**
- Put literal text in quotes or ALL CAPS. Specify the font style, size, color, and placement. Spell tricky words letter by letter, for example "S-T-R-I-P-E". Keep text short. [PRIMARY] [CB2] [AC] [CX]
- State how many times the text appears ("render the tagline exactly once") and whether any other text is allowed ("no extra text"). Keep the requested capitalization. Ask for the text on one line if it must not wrap. [PRIMARY] [IP] [CX]
- For dense copy, request "sharp text rendering", review every word, and finish in a design tool when needed. [PRIMARY] [CX] [AC]

**Composition and aspect ratio**
- Specify framing, viewpoint, angle, and lighting, and give placement when layout matters ("subject centered with negative space on left"). Call out negative space when copy or UI will be placed over the image. [PRIMARY] [CB2] [SK]
- ChatGPT can make "any aspect ratio … include your desired aspect ratio in your prompt". [PRIMARY] [HC] The API prompting guide says to "specify the composition, aspect ratio, and important placement constraints". [PRIMARY] [IP]
- Our tool fixes the output at about 1.57 MP, which equals the area of 1536×1024. That suggests the shape snaps to near-standard sizes, so the prompt picks the orientation, not an exact ratio. Crop afterwards when an exact ratio is required. [INFERENCE]

**Transparency**
- The prompt must also ask for transparency. Describe "an isolated subject on a fully transparent background", and explicitly exclude scenery, solid backdrops, checkerboards, and unwanted shadows. [PRIMARY] [CB2] [IP]
- "Prompt instructions take priority over `background="transparent"`": if the prompt describes a backdrop or background color, the model may render that backdrop instead of transparency. [PRIMARY] [CBT]
- For charts and stickers, say which interior regions stay transparent ("plot area, grid, and space between bars transparent"). Also exclude panels, frames, cards, and plinths. [PRIMARY] [CBT]
- For edits, restate "preserve the transparent background" in every prompt. "A drawn checkerboard is not transparency." [PRIMARY] [IP] [CB2]
- For edits that include references, the tool description says to "preserve existing transparency unless the user asks to change it". [PRIMARY] [TD] Transparency is reportedly lost when a reference image is supplied ([#42743](https://github.com/openai/codex/issues/42743)). [SECONDARY]
- On older models, the word "transparent" in the prompt set `background` to transparent through `auto`. [PRIMARY] [CBG] Our tool always sends `opaque` or `transparent`, never `auto`, so a prompt alone won't produce transparency. [INFERENCE]

**References and edits**
- Label each input by index and role ("Image 1: edit target; Image 2: style reference"). Say how the images combine and what moves where. Use spatial words such as foreground, background, left, and right. A small set of references is easier to control. [PRIMARY] [IP] [CX] [AC] [SK]
- Don't assume every image is an edit target. Style or mood references mean "generate with references". [PRIMARY] [SK]
- For edits, write "change only X; keep Y unchanged". For surgical edits, name what else must stay: saturation, contrast, labels, camera angle, and surrounding objects. [PRIMARY] [CB2] [IP]

**Iteration**
- Start with a clean base prompt, then make one change per follow-up. Pass the previous output back as the edit input and repeat the preserve list each time. "Compare results before adding more instructions." [PRIMARY] [IP] [CB2] [CX]

**Known failure modes**
- The model may still struggle with precise text placement and clarity, with consistency of recurring characters and brands across generations, and with precise placement in layout-sensitive compositions. Complex prompts can take up to 2 minutes. [PRIMARY] [IG]
- Repeated edits can drift. When a region must stay pixel-identical, composite the edit into the original image. [PRIMARY] [IP]
- Chart numbers are "raster artwork" and need to be checked against the source data. [PRIMARY] [CBT]

## 2. Rules for the agent (before → after)

1. **Lead with the purpose, then scene → subject → details → constraints.**
   Before: `a coffee mug` → After: `Landing-page hero image. A matte white ceramic coffee mug on a pale oak table, soft window light from the left, clean product photography, wide composition with empty space on the right for copy. No text, no logos, no watermark.`
2. **Don't pad a specific request; enrich a vague one only with framing, polish, and layout.**
   Before (padded user ask "red fox logo"): `…fox in a forest with a moon and the slogan "Wild at heart"` → After: `Original minimal logo mark of a red fox head, flat vector-like shapes, strong silhouette, generous padding, centered. No text.`
3. **Say "photorealistic" and describe texture; don't rely on "8K, ultra-detailed" or lens numbers.**
   Before: `8K ultra-detailed portrait, 85mm f/1.4` → After: `Photorealistic candid photo of a baker at dawn, visible flour on weathered hands, natural window light, shallow depth of field, honest and unposed, no retouching.`
4. **Text: quote it exactly, describe its style and position, give a count, and forbid other text.**
   Before: `poster that says grand opening` → After: `Poster with the headline "GRAND OPENING" once, bold white sans-serif, centered in the top third, on one line. No other text.` Spell rare names: `"Qyrell" (Q-Y-R-E-L-L)`.
5. **State the orientation or ratio and the placement in words.**
   Before: `banner of mountains` → After: `Wide 16:9 landscape banner of misty mountains at sunrise, horizon in the lower third, open sky on the left for a headline.`
6. **Transparency: set the flag, then describe an isolated subject and name the regions and exclusions.**
   Before (`transparent_background: true`): `a sticker of a cat on a pink background` → After: `One die-cut sticker of a grinning orange cat with a cream border; everything outside the border fully transparent. No backdrop, checkerboard, shadow, or text.`
7. **Label references by role and state what moves where.**
   Before: `combine these` → After: `Image 1 is the base room photo; Image 2 is the lamp to insert. Place the lamp from Image 2 on the left nightstand in Image 1, matching lighting, perspective, and scale. Change nothing else.`
8. **Edits: write "change only X" and list what to keep. Repeat that list on every follow-up.**
   Before: `make it night` → After: `Change only the lighting to a clear night with warm window glow. Keep the building, framing, camera angle, signage text, and people unchanged.`
9. **Iterate with one change applied to the last image; don't rewrite from scratch.**
   Before (second call): the whole prompt rewritten plus 5 new asks → After: `Edit image 1: make the sky warmer. Keep composition, subject, and text unchanged.`
10. **Verify every generation.** Check the spelling of text, labels and data, the invariants, and that alpha is real. Fix one failure per retry.

## 3. Where the current `skills/generate-image/SKILL.md` falls short

- **L12 "subject, setting, composition, lighting, and style"** reads as a mandatory checklist. OpenAI says to start from purpose or intended use, which the skill omits. It also says to keep prompts to 1–3 clear sentences, to add details only when they matter, and never to add details the request doesn't imply. [CX] [SK] The skill also leaves out constraints and exclusions ("no text/logos/watermark"), which OpenAI treats as a core prompt section. [CB2] [IP]
- **L12 "exact text in quotes"** is incomplete. It is missing typography and placement, the "exactly once" and "no other text" instructions, letter-by-letter spelling, and keeping text short. [IP] [CX] [AC]
- **L14 "what to change and what must stay the same"** matches OpenAI. It omits repeating invariants on every iteration, which OpenAI stresses. [IP] [SK]
- **L18–19 Transparency** treats the flag as sufficient. OpenAI requires the prompt to request an isolated subject on a transparent background and to exclude backdrop, checkerboard, and shadow. The prompt overrides the flag if it describes a background. [CBT] [IP] Edits must restate "preserve the transparent background". [CB2]
- **L26 "image 1, image 2"** matches. The skill doesn't ask for each image's role (edit target vs. style reference) or for how the images combine. [IP] [SK]
- **L30 "add detail to the prompt and generate again"** conflicts with OpenAI's iteration advice: make one targeted change and pass the prior output as the edit input. "Compare results before adding more instructions." [IP] [CX] [AC] Retrying only because quality came back `low` has no primary support. [INFERENCE]
- **L13 aspect ratio "in words"** matches Help Center and API guidance. [HC] [IP] The example "wide 16:9" may suggest an exact ratio, but the fixed ~1.57 MP output probably snaps to a standard shape. [INFERENCE]

[IP]: https://developers.openai.com/api/docs/guides/image-prompting
[IG]: https://developers.openai.com/api/docs/guides/image-generation#limitations
[CB2]: https://github.com/openai/openai-cookbook/blob/2182005bcaf5a5cdd96bb46fb9995d08730e7b91/examples/multimodal/image-gen-models-prompting-guide.ipynb
[CB15]: https://github.com/openai/openai-cookbook/blob/2182005bcaf5a5cdd96bb46fb9995d08730e7b91/examples/multimodal/image-gen-1.5-prompting_guide.ipynb
[CBT]: https://github.com/openai/openai-cookbook/blob/2182005bcaf5a5cdd96bb46fb9995d08730e7b91/examples/multimodal/transparent-image-assets-for-campaigns-and-presentations.ipynb
[CBG]: https://github.com/openai/openai-cookbook/blob/2182005bcaf5a5cdd96bb46fb9995d08730e7b91/examples/Generate_Images_With_GPT_Image.ipynb
[CX]: https://learn.chatgpt.com/docs/image-generation
[AC]: https://openai.com/academy/image-generation/
[HC]: https://help.openai.com/en/articles/11084440-images-in-chatgpt
[SK]: https://github.com/openai/codex/blob/d42056091aded7feb1d88ac7e83972108b2aa478/codex-rs/skills/src/assets/samples/imagegen/references/prompting.md
[TD]: https://github.com/openai/codex/blob/d42056091aded7feb1d88ac7e83972108b2aa478/codex-rs/ext/image-generation/imagegen_description.md
