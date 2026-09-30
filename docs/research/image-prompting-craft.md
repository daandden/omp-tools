# Image-prompt craft from other vendors, filtered for gpt-image-2

Researched 2026-09-30. "Transfers" means the advice should carry over to gpt-image-2 when the agent sends raw prompt text. The OpenAI guide [OAI] and the Codex skill [CDX] serve as the check for whether it does.

## 1. Cited findings

**Structure and specificity**
- All vendors use the same skeleton: image type, subject, action, setting, style, camera/framing, lighting, color, extra details. [PRIMARY] [IMG] [BFL-B] [IDEO-S] [MJ] [FF]. It transfers: [OAI] asks for "subject, composition, style, and constraints" plus the intended use.
- Write descriptive sentences, not keyword lists: "A narrative, descriptive paragraph will almost always produce a better… image than a simple list of disconnected words." [PRIMARY] [GBLOG] [BFL-B] [IDEO]. It transfers.
- State the image's purpose. "a logo for a high-end, minimalist skincare brand" beats "a logo". [PRIMARY] [GEM]. It transfers, and [OAI] and [CDX] say the same.
- Put important content first. Ideogram gives "slightly more importance to parts placed earlier"; FLUX moves the subject ahead of the environment to control framing. [PRIMARY] [IDEO] [BFL-B]. For gpt-image this is unverified [INFERENCE], but the habit costs nothing.
- For many-element scenes, give step-by-step instructions ("First… Then… Finally…"). [PRIMARY] [GEM]. [OAI] uses the same idea for comics ("Panel 1: … Panel 2: …"), so it transfers.
- FLUX.2 and Ideogram 4 were trained on JSON captions, which is why they accept JSON prompts [PRIMARY] [BFL-JSON] [IDEO]. [OAI] allows JSON-like structure but would rather avoid "relying on special syntax". For gpt-image, use labeled lines.

**Length**
- FLUX: 10–30 words for exploration, 30–80 for most scenes, 80–300+ for complex scenes. "Specific detail helps. Filler hurts." [PRIMARY] [BFL-B]
- Ideogram's cap of about 150 words [PRIMARY] [IDEO-S] is specific to Ideogram. GPT image prompts can be up to 32,000 characters.
- Midjourney: "Short and simple prompts typically generate the best images" [PRIMARY] [MJ]. This does **not** transfer. It depends on Midjourney's default house style, and here the server picks a higher quality for more detailed prompts.
- FLUX and Ideogram "Magic Prompt" rewrite short prompts automatically [PRIMARY] [BFL-T] [IDEO]. Nothing rewrites gpt-image-2 prompts here, so the agent has to add the detail itself [INFERENCE].

**Camera, lighting, color**
- Vocabulary that works: shot distance (close-up, wide, aerial, from below), lens (35mm, 85mm, macro, fisheye), depth of field/bokeh, film look. Imagen pairs focal lengths with subjects, e.g. 24–35mm for portraits and 60–105mm macro for still life. [PRIMARY] [IMG] [BFL-B]
- "Lighting has the greatest single impact." Describe its source, quality, direction, temperature, and how it falls on surfaces. [PRIMARY] [BFL-S]
- A named palette keeps an image coherent. FLUX.2 also accepts hex colors ("in color #0047AB") [PRIMARY] [BFL-B] [BFL-HEX]. OpenAI does not document hex for gpt-image, so pair each hex with a color name [INFERENCE].
- Camera and film-stock names are "cues for appearance, not a guarantee" [PRIMARY] [OAI]. Use one or two cues and don't stack generic quality words [PRIMARY] [BFL-B]. Imagen's "4K, HDR, beautiful" modifiers [IMG] are probably filler for gpt-image, since no OpenAI example uses them [INFERENCE].

**Aspect ratio**
- Google puts the ratio in the prompt text itself, even where an API field exists: "Aspect ratio 16:9.", "Square image.", "(9:16 aspect ratio)" [PRIMARY] [GEM] [IMG]. [OAI] asks the prompt to "specify the composition, aspect ratio". Transfers.
- Match the ratio to the content: 16:9 for landscapes and slides, 9:16 for tall subjects such as waterfalls and phone screens, 1:1 for icons and products. "Mismatched ratios force the model to either crop or pad" [PRIMARY] [BFL-T] [IMG].

**Negatives**
- Other vendors agree that negation fails: "a person without glasses" produces glasses. Describe what fills the space instead: "empty, deserted street", "clean-shaven man", "plain white background" [PRIMARY] [BFL-T] [IDEO-N] [MJ] [GEM "semantic negative prompts"]. Stability says "the key to removing objects isn't negative prompting but positive prompting for object placement" [PRIMARY] [SAI].
- **OpenAI disagrees for artifact classes.** Its own gpt-image prompts end with "No extra text, no watermarks, no unrelated logos." and "Do not add new elements or text." [PRIMARY] [OAI] [CDX]. Rule of thumb: describe the scene positively, and put short explicit exclusions for artifacts (text, watermarks, logos, checkerboard) at the end.

**Text and typography**
- Put the exact wording in quotes, describe where it sits and what it looks like (serif, bold sans, neon, embossed), and give its size (headline vs. small caption) [PRIMARY] [BFL-S] [IDEO-T] [IMG] [GEM].
- Mention text early, split multi-line copy into placed chunks, and keep the scene simpler when text matters [PRIMARY] [IDEO-T].
- Imagen 3: at most 25 characters and 3 phrases [PRIMARY] [IMG]. This limit belongs to Imagen 3. gpt-image-2 renders slides and labeled diagrams [OAI], but shorter text is still safer [INFERENCE].
- Ideogram cannot match a named typeface, so describe its traits instead [PRIMARY] [IDEO-T]. The same approach likely applies to gpt-image [INFERENCE].
- OpenAI extras: say how many times text should appear ("exactly once"), spell unusual words letter by letter, and ask for no extra text [PRIMARY] [OAI].

**Infographics, diagrams, UI**
- Name the layout direction, the numbered steps, the labels, the icon style, and the background, e.g. "centered horizontal layout… arrow pointing to a rounded rectangle with the text 'Pooling layer'" [PRIMARY] [BFL-INF]. [OAI] adds: write the prompt like an artifact spec with the real data, and check labels.
- For UI, describe the product as if it already exists, cover layout, hierarchy, and real elements, and avoid concept-art language [PRIMARY] [OAI] [CDX].

**Consistency across a series**
- Feed the earlier outputs back in as references and repeat the defining traits every time [PRIMARY] [GEM "360 view"] [BFL-CC] [OAI "Keep a character consistent"]. Edits drift, so restate the invariants on each pass [PRIMARY] [OAI] [CDX].

**Syntax that does NOT apply to gpt-image-2**
- Midjourney `--ar 16:9`, `--no x`, `::` and `::-0.5` weights [PRIMARY] [MJ-AR] [MJ-NO] [MJ-W]. Stable Diffusion `negative_prompt` field [SAI]. Imagen's negative-prompt field and its keyword-list style ("wall, frame") [IMG]. Aspect and style dropdowns in Firefly, Imagen, and Ideogram.
- gpt-image-2 has no such fields or syntax, and the prompt goes through verbatim. A pasted keyword list like "wall, frame" would ask for walls and frames [INFERENCE].
- Firefly says to "avoid… *generate* or *create*" [PRIMARY] [FF]. This doesn't transfer: every [OAI] example starts with "Create…".

## 2. Rules for the agent (before → after)

1. **Lead with image type, purpose, and subject, in sentences.**
   `cat, window, cozy, 4k` → `A candid photo for a blog header: a ginger cat asleep on a sunlit windowsill, city rooftops softly blurred outside.`
2. **Put the ratio in words and let it shape the composition.**
   `mountain lake at dawn` → `Wide 16:9 landscape: a still alpine lake at dawn, mountains filling the upper third, mist on the water.`
3. **Name the camera and the light specifically, one or two cues each.**
   `portrait of a chef, good lighting` → `Waist-up portrait of a chef, 85mm lens, shallow depth of field, soft window light from the left, warm tones.`
4. **Describe what fills the space; put artifact exclusions at the end.**
   `a street with no cars or people` → `A quiet cobblestone pedestrian lane at dawn, shutters closed, puddles reflecting the sky. No text, no watermark.`
5. **Quote the text, then give its placement, style, size, and count.**
   `poster saying summer sale` → `Poster with the headline "SUMMER SALE" once, large bold condensed sans-serif across the top; subline "Up to 50% off" small, bottom center.`
6. **Write diagrams and UI as a spec with the real labels.**
   `diagram of CI pipeline` → `Flat vector diagram, white background, left-to-right flow: "Commit" → "Build" → "Test" → "Deploy" in rounded boxes with arrows; one teal accent; readable sans labels; no decoration.`
7. **For a series, repeat a fixed description and pass earlier images.**
   `the fox again, now in winter` → `Same fox as image 1: russet fur, white-tipped tail, green scarf, watercolor with soft outlines. Now standing in fresh snow at dusk. Keep face, proportions, and palette unchanged.`
8. **Iterate one change at a time and restate what must stay.** [BFL-B] [OAI]
   (rewrite the whole prompt) → `Keep everything in image 1 unchanged except make the lighting golden-hour warm.`

**Short templates**
- *Product:* `Studio product photo of [product, material, color] on [surface]. [Lighting setup] to [purpose]. [Angle] showing [feature]. Sharp focus on [detail]. [Ratio].` [GEM]
- *Portrait:* `[Framing] portrait of [person details], [expression/gaze], in [setting]. [Lens], [depth of field], [light source and direction]. [Palette/film look]. [Ratio].`
- *Illustration/sticker:* `A [style] illustration of [subject] [doing X]. [Line and shading traits], [palette]. [Background]. [Ratio].` [GEM]
- *Icon:* `A single [flat/3D] icon of [object], [stroke weight, corner radius], [palette], centered with generous padding, square.` Set `transparent_background` if needed.
- *Logo:* `Original logo for "[Name]", a [business]. [Mark idea]. Simple, strong silhouette, flat vector shapes, [palette], legible when small. Centered, square. No extra text.` [OAI]
- *Diagram:* `[Artifact type] titled "[Title]" for [audience]. [Flow direction]: [labeled nodes]. [Visual system]. Readable labels, white background. [Ratio]. No extra text.` [OAI] [BFL-INF]

## 3. Where this conflicts with the current SKILL.md

- **Line 12** lists only subject, setting, composition, lighting, and style. It leaves out **intended use/purpose** [GEM] [OAI], and it omits **labeled lines for complex prompts** [OAI] [CDX]. "One complete prompt" also reads like "one paragraph".
- **Line 12, text:** quoting alone is too thin. Add placement, typography, size, "exactly once / no extra text", letter-by-letter spelling, and keeping the text short.
- **Line 13** is consistent with the sources. It could add "match the composition to the ratio" and suggest giving the numeric ratio next to the orientation word ("wide 16:9 landscape"), as Google does.
- **Line 14** is consistent. It could add "change only X" phrasing and restating the invariants on every iteration.
- **Line 30**, "add detail": this should mean concrete visual detail (materials, light, placement), not quality buzzwords. Also change one thing per retry [BFL-B] [OAI].
- **Missing guidance:**
  - Negatives: prefer positive description, with an explicit exclusion tail for artifacts.
  - Transparency: the prompt should also ask for an isolated subject with no checkerboard or backdrop [OAI].
  - Series consistency.
  - A warning not to use Midjourney or Stable Diffusion syntax.

[OAI]: https://developers.openai.com/api/docs/guides/image-prompting
[CDX]: https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/skills/src/assets/samples/imagegen/references/prompting.md
[GEM]: https://ai.google.dev/gemini-api/docs/image-generation
[GBLOG]: https://developers.googleblog.com/en/how-to-prompt-gemini-2-5-flash-image-generation-for-the-best-results/
[IMG]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/image/img-gen-prompt-guide
[BFL-B]: https://docs.bfl.ml/guides/prompting_unified_building
[BFL-T]: https://docs.bfl.ml/guides/prompting_unified_technical
[BFL-S]: https://docs.bfl.ml/guides/prompting_unified_style
[BFL-INF]: https://docs.bfl.ml/guides/usecases_t2i_infographics
[BFL-HEX]: https://docs.bfl.ml/guides/usecases_t2i_hex_color_prompting
[BFL-JSON]: https://docs.bfl.ml/guides/usecases_t2i_json_prompting
[BFL-CC]: https://docs.bfl.ml/guides/usecases_editing_character_consistency
[IDEO]: https://docs.ideogram.ai/using-ideogram/getting-started/prompting-guide/in-a-nutshell
[IDEO-T]: https://docs.ideogram.ai/using-ideogram/getting-started/prompting-guide/2-prompting-fundamentals/text-and-typography
[IDEO-S]: https://docs.ideogram.ai/using-ideogram/getting-started/prompting-guide/3-prompt-structure
[IDEO-N]: https://docs.ideogram.ai/using-ideogram/getting-started/prompting-guide/4-handling-negatives
[MJ]: https://docs.midjourney.com/hc/en-us/articles/32023408776205-Prompt-Basics
[MJ-AR]: https://docs.midjourney.com/hc/en-us/articles/31894244298125-Aspect-Ratio
[MJ-NO]: https://docs.midjourney.com/hc/en-us/articles/32173351982093-No
[MJ-W]: https://docs.midjourney.com/hc/en-us/articles/32658968492557-Multi-Prompts-Weights
[FF]: https://helpx.adobe.com/firefly/web/work-with-images/generate-images/writing-effective-text-prompts.html
[SAI]: https://github.com/Stability-AI/stability-ai-toolkit/blob/main/README.md
