# Prompting GPT Image 2.5 (Flare, Sunburst): OpenAI first-party guidance, diffed against gpt-image-2

Researched on 2026-10-01. Scope: new images, not edits. This note extends [image-prompting-openai.md](image-prompting-openai.md) and [image-prompt-format.md](image-prompt-format.md) and does not repeat them. Sources were pinned where possible: cookbook at `2182005b` (head; the gpt-image-2 notebook last changed at `d310dfa0`), the 2.5 transparent-assets notebook at `93efae39`, `openai/codex` at `8ea2428c`, and `openai/openai-openapi` at `21cb7e98`. Pages on developers.openai.com, openai.com, help.openai.com, and learn.chatgpt.com can't be pinned; they were read on 2026-10-01. No images were generated and no API calls were made.

Source keys (URLs at the bottom):

- [IP25]: API image prompting guide, now titled "GPT Image 2.5 prompting guide"
- [IG25]: API image generation guide (2.5 version)
- [TOOL]: Responses image generation tool guide
- [ANN]: "Introducing ChatGPT Images 2.5" announcement, 2026-09-08
- [SC25]: ChatGPT Images 2.5 system card
- [MF], [MS]: model pages for `gpt-image-2.5-flare` and `gpt-image-2.5-sunburst`
- [CL]: API changelog, 2026-09-08 entry
- [OAPI]: openai-openapi commit "Add GPT Image 2.5 models…"
- [CB2]: gpt-image-2 cookbook prompting notebook at `d310dfa0` (the 2.5 guide links it as the "original notebook"). This is the gpt-image-2 baseline.
- [CBT25]: transparent-assets notebook, updated for 2.5 (`93efae39`)
- [CX]: Codex image-generation doc
- [HC]: Help Center "Images in ChatGPT"
- [RN]: ChatGPT release notes, 2026-09-08
- [AC]: OpenAI Academy "Creating images with ChatGPT"
- [CXSRC]: `openai/codex` source at `8ea2428c`
- [EP]: endpoint notes in [codex-images-endpoint.md](codex-images-endpoint.md)
- [FORUM]: OpenAI Developer Community launch thread (staff post plus user replies)

**Baseline caveat.** The pre-2.5 version of the developers.openai.com prompting guide could not be retrieved. Wayback's only capture is from 2026-09-08 19:18 UTC, after the launch, and it returned HTTP 429. The gpt-image-2 baseline here is therefore [CB2], which [IP25] names as "the pinned GPT Image 2 notebook". Every `[IP]` and `[IG]` quote in image-prompting-openai.md was read on 2026-09-30, so it already comes from the 2.5 guides. For example, its L46 "specify the composition, aspect ratio, and important placement constraints" is [IP25] text. When this note marks [IG25] text as **Same**, it means the text is written generically for "GPT Image models" and was carried into the 2.5 page. It does not mean a pre-2.5 copy was compared. [PRIMARY] [INFERENCE]

## Bottom line

- **OpenAI did not change its prompting advice for 2.5.** All 24 example prompts in [IP25] are the [CB2] gpt-image-2 prompts, with only minor wording fixes (for example "4 equal-sized panels" became "4 panels"). Each one runs unchanged on Flare and Sunburst. The guide calls itself "shared techniques" for all GPT Image models. Its migration advice is to keep prompts fixed and tune settings first. [PRIMARY] [IP25] [CB2] [INFERENCE: text comparison done in this research]
- **Flare and Sunburst take the same prompts.** No source gives model-specific prompting advice. The models differ in speed, quality, and editing precision. [PRIMARY] [IP25] [ANN] [IG25]
- **The changes are in settings and verification, not in prompt wording.**
  - New quality levels `xhigh` and `max`.
  - Transparency is no longer "preview" on 2.5.
  - New instructions to verify diagram labels and relationships, historical details, and alpha at fine edges.
  - `low` quality is now framed as "quick drafts".
  [PRIMARY] [IG25] [IP25] [OAPI]
- **On our endpoint, none of the new settings can be used, and the effective model is unknown.** Codex docs still say "Built-in image generation uses `gpt-image-2`", and Codex source still hardcodes `"gpt-image-2"`. The announcement says Images 2.5 reaches "Codex users". [PRIMARY] [CX] [CXSRC] [ANN] [EP]

## 1. Cited findings

Status tags: **Same** = same guidance as gpt-image-2. **Changed** = guidance differs. **New** = new for 2.5.

**Flare vs Sunburst: intended use, speed and quality, prompting**
- **New.** Positioning in the prompting guide: "GPT Image 2.5 Flare is the small model, optimized for speed, with image quality comparable to GPT Image 2. GPT Image 2.5 Sunburst is the base model, optimized for quality, with higher image quality than GPT Image 2. Both models offer improvements in precise editing and subject preservation." [PRIMARY] [IP25]
- **New, and it conflicts with the guide.** The announcement says Flare "is the default choice for most applications, delivering higher-quality images than GPT‑Image‑2 at 50% lower latency". The guide says Flare's quality is "comparable to GPT Image 2". [PRIMARY] [ANN] [IP25] Sunburst "offers an extra level of precision for detailed creative work with longer generation times" and "is built for premium visual workflows that benefit from tighter control across edits." [PRIMARY] [ANN]
- **New.** In the API guide and changelog: "Choose Sunburst for workflows where editing precision matters most, and Flare for fast, high-quality everyday image generation." [PRIMARY] [IG25] [CL] The Responses tool guide says: "Set the `image_generation` tool's `model` to `gpt-image-2.5-sunburst` for precise editing, or `gpt-image-2.5-flare` for fast, high-quality image generation." [PRIMARY] [TOOL] Model page taglines: Flare "Fast, high-quality everyday image generation"; Sunburst "Our most capable model for image generation and editing". [PRIMARY] [MF] [MS]
- **No prompting difference.** "If GPT Image 2.5 Sunburst meets your quality requirements, then test GPT Image 2.5 Flare with the same prompts and inputs." Every illustrated example shows one prompt rendered by both models. [PRIMARY] [IP25] Both models have the same token prices, but "Equal token rates don't mean equal cost per image: token consumption can differ by model and quality setting." [PRIMARY] [IG25]
- Customer quote on the OpenAI page: "Flare delivers high-quality images at two to four times the speed of GPT‑Image‑2." [PRIMARY: customer statement on the OpenAI page, unmeasured] [ANN]
- One forum user claims that ChatGPT "defaults to the lighter, 50% faster **Flare** model" and "escalates to **Sunburst**" for complex prompts. [SECONDARY] [FORUM] Rigor: the post says "AFAIK", cites no source, and has no OpenAI confirmation.

**Structure and order**
- **Same in substance, reworded.** [CB2]: "Write prompts in a consistent order (background/scene → subject → key details → constraints) and include the intended use (ad, UI mock, infographic) to set the “mode” and level of polish. For complex requests, use short labeled segments or line breaks instead of one long paragraph." [IP25]: "Name the subject and intended use, such as a product photograph, advertisement, or diagram. Specify the composition, aspect ratio, and important placement constraints. For complex requests, organize the prompt as scene, subject, details, and constraints, using labeled sections." [PRIMARY]
- The 2.5 overview gives an order: "Start with the image you need, then describe the subject, composition, style, and constraints." [PRIMARY] [IP25] The fixed scene → subject → details → constraints order is now attached to complex requests only, and the "mode"/"polish" wording is gone. Nothing suggests the model behaves differently. [INFERENCE]
- New in ChatGPT, product-side: templates for "Poster" or "Merch" ask users to "add details like information to convey, design elements, or styles". With templates, "ChatGPT may ask follow-up questions to help refine your request." The Help Center adds: "if you’re creating a poster, describe what it’s for and any text you want it to include." [PRIMARY] [ANN] [RN] [HC]

**Prompt format**
- **Same.** [IP25]: "Short prompts, descriptive paragraphs, JSON-like structures, instructions, and tags can all express the same intent. Choose the format that makes the requirements easiest to read and update rather than relying on special syntax." [CB2]: these formats "can all work well as long as the intent and constraints are clear". [PRIMARY]
- **Same: no JSON example.** Of the 12 new-image prompts in [IP25]:
  - 7 are plain prose.
  - 4 use labeled lines: `Character:`/`Theme:`/`Style:`/`Constraints:`, `Scene:`/`Mood:`/`Style:`/`Constraints:`, `Concept:`/`Style:`/`Constraints:`, and `Panel 1:`…`Panel 4:`.
  - 1 uses Markdown bold and bullets (`**"Market Opportunity"**`, `* **TAM:** $42B`).
  - Quoted copy appears under labels such as `Include ONLY this card text (verbatim):` and `Billboard text (EXACT, verbatim, no extra characters):`. Constraint lines are often `-` bullets.
  - No prompt contains `{`. All of these come from [CB2]. [PRIMARY] [IP25] [CB2] [INFERENCE: count done in this research]
- A community 2.5 showcase prompt (Sunburst and Flare at `max`) uses ALL-CAPS section headers (`ART DIRECTION`, `LAYOUT`, `TEXT FIDELITY`, `PRIORITIES, IN ORDER`). [SECONDARY] [FORUM] Rigor: one prompt, two outputs, no comparison with prose.

**Length and level of detail**
- **Same.** OpenAI gives no new length rule for 2.5. The Codex doc still says "A useful image prompt is often only one to three clear sentences". The Academy page is dated April 10, 2026, has not been updated, and still says "In most cases, 1–3 clear sentences are enough." [PRIMARY] [CX] [AC] The [IP25] new-image examples are 20–143 words long, with a median of about 94. [INFERENCE: word count done in this research]
- **New capability claim.** "Images 2.5 is better at understanding complex visual instructions and translating them into coherent results." Also: "The model is more likely to retain the requested visual direction, composition, and individual details, instead of drifting as instructions become more specific." [PRIMARY: vendor claim, no metric] [ANN]

**Specificity**
- **Changed in emphasis.** For ads, [CB2] said to describe the brief "then let the model make taste-driven creative decisions inside those boundaries … the model can interpret audience cues, infer art direction, and propose visual details". The [IP25] lead-in for the same prompt says: "Quote the required copy and tell the model how many times it should appear. Specify the audience and visual treatment without adding unrelated instructions." [PRIMARY] This is closer to the skill's no-invention stance. [INFERENCE]
- **Same.** "Describe visible details. Name materials, lighting, colors, and the visual medium." Also: "For wide, cinematic, low-light, rainy, or neon scenes, specify scale, atmosphere, and color instead of relying on mood words alone." [PRIMARY] [IP25] (The [CB2] wording is equivalent.)
- **New wording.** "Set API parameters separately from the prompt." [PRIMARY] [IP25]

**Text rendering**
- **Changed: quotes only.** [IP25]: "Put required wording in quotes and describe its position and typography. Spell unusual words or brand names letter by letter when needed. Ask for no extra text, then check spelling and legibility in the output. Compare medium or high quality for small text, dense information, or multiple fonts." [CB2] said "Put literal text in **quotes** or **ALL CAPS**". The ALL CAPS alternative is gone from the 2.5 guide. It survives in the Academy page, which has not been updated. [PRIMARY] [IP25] [CB2] [AC]
- **Same.** "Quote the required copy and tell the model how many times it should appear." The Thread example keeps "Render the tagline exactly once … No extra text". [PRIMARY] [IP25]
- **Same limitation.** "Although significantly improved, the model can still struggle with precise text placement and clarity." The Limitations section is written generically for "GPT Image models" and was not revised for 2.5. [PRIMARY] [IG25] [INFERENCE]
- **No guidance on languages or scripts.** No 2.5 source gives non-English text advice. The announcement gallery shows a poster "with additional Japanese text", which demonstrates a capability, not a technique. [PRIMARY] [ANN] [IP25]
- **Same for dense copy.** Request "sharp text rendering", "review every word and finish the asset in a design tool when needed". [PRIMARY] [CX]

**Photorealism and style**
- **Same rule, with "mode" wording removed.** [IP25]: "Request “photorealistic” or “real photograph” explicitly when that is the goal, and describe framing and texture. Treat camera specifications as cues for appearance, not a guarantee of exact physical simulation." [CB2] said "photorealistic" engages "the model’s photorealistic mode". [PRIMARY]
- **New capability claims.** 2.5 "produces more natural lighting and richer textures" and is "better at reflecting visual styles". The system card says 2.5 "allows for heightened realism that could, absent safeguards, allow more convincing deepfakes". [PRIMARY] [ANN] [SC25] No new style-prompting technique is given.

**Diagrams, UI, slides, infographics, real-world content**
- **Same spec framing.** UI: "describe the product as if it already exists". Slides: "written like an artifact spec rather than an illustration request … provide the real text or data". Science visuals: "Prompt them like an instructional design brief … list the required components explicitly and say what should not be included." [PRIMARY] [IP25] [CB2]
- **New: verify the result.**
  - "For diagrams and information graphics, verify labels and factual relationships as well as appearance."
  - "The sample market figures and citations below are fictional design inputs. Replace them with verified data before using the slide."
  - The "Check the result" list asks: "Are diagram labels and relationships correct?"
  [PRIMARY] [IP25]
- **Changed: world knowledge.** [CB2] said the model "can infer Woodstock and produce an accurate, context-appropriate image without being explicitly told". [IP25] says "Name the place and date to establish a historical setting. The model can infer contextual details, but inspect clothing, staging, and surroundings for historical accuracy." [PRIMARY]
- **New capability claims.** 2.5 "improves infographic accuracy and layout". "Images that include real-world information have more accurate content, and the model can handle more complex layouts including transparent backgrounds." Use cases named include "UI concepts that preserve a given hierarchy, or presentation visuals that fit a defined structure". [PRIMARY] [SC25] [ANN] Chart values are still "raster artwork" to check against the source data. [PRIMARY] [CBT25]

**Negatives and exclusions**
- **Same.** "State exclusions such as unwanted text, logos, or watermarks." Most examples end with `No …` or `Avoid …` lines ("Avoid clip art, stock photography, gradients, shadows…"; "No extra text, no watermarks, no unrelated logos"). OpenAI says nothing about phrasing scene content positively. [PRIMARY] [IP25] [CB2]

**Aspect ratio and size wording**
- **Same.** "Specify the composition, aspect ratio, and important placement constraints." [PRIMARY] [IP25] The Help Center still says to "include your desired aspect ratio in your prompt". [PRIMARY] [HC] `size: auto` still lets the model "automatically select the best option based on the prompt". [PRIMARY] [IG25]
- **Same constraints.** Edges are multiples of 16, the ratio is at most 3:1, total pixels are 655,360–8,294,400, and "Outputs with more than 3,686,400 total pixels (`2560x1440`) are experimental". These match gpt-image-2. [PRIMARY] [IP25] [OAPI] [CB2]

**Transparency**
- **Changed: no longer preview on 2.5.** "`gpt-image-2.5-sunburst` and `gpt-image-2.5-flare` … support `opaque` and `transparent` backgrounds… For `gpt-image-2` and `gpt-image-2-2026-04-21`, this support is in preview." [PRIMARY] [OAPI] The cookbook dropped "(in preview)" in its 2.5 update. [PRIMARY] [CBT25]
- **Same prompt rule.** "Request both an isolated subject in the prompt and `background="transparent"` in the API… A drawn checkerboard is not transparency. For subsequent edits, repeat the requirement to preserve the transparent background." The logo prompt still says "Fully transparent background … no solid backdrop, scenery, checkerboard, or watermark." [PRIMARY] [IP25] The 2.5-updated notebook keeps "Prompt instructions take priority over `background="transparent"`". [PRIMARY] [CBT25]
- **New verification step.** "Check the decoded image's alpha channel, including hair, glass, shadows, and object edges." [PRIMARY] [IP25] Capability claims: "can handle more complex layouts including transparent backgrounds" [PRIMARY] [ANN], and "improved transparent-background generation" (customer quote) [ANN]. The 2.5 notebook's images "are retained from the original GPT Image 2 version … not measured GPT Image 2.5 results." [PRIMARY] [CBT25]

**Quality levels**
- **New: `xhigh` and `max`.** "`gpt-image-2.5-sunburst` and `gpt-image-2.5-flare` add `xhigh` and `max` quality settings. Both default to `auto`." [PRIMARY] [IG25] [OAPI]
- **New guidance on using them.**
  - "If the output falls short, test a higher quality setting… Use `xhigh` or `max` only when they improve an unmet quality requirement within your latency budget. A higher setting doesn't guarantee a better result for every prompt."
  - "The same quality label does not imply the same image quality or response time across models."
  - "Compare quality levels before rewriting the prompt."
  [PRIMARY] [IP25]
- **Changed framing of `low`.** [CB2] said to start with `low` because "In many cases, it provides sufficient fidelity". [IG25] says "Use `quality: "low"` for quick drafts. For final assets, compare higher quality settings". Most [IP25] examples run at `medium`; slides and dense diagrams run at `high`. [PRIMARY]
- A forum user infers from the token calculator that 2.5 spreads "the same total token range" over five steps, and that "'max' is the new 'high'". [SECONDARY] [FORUM] Rigor: inferred from the calculator, not measured.

**Known limitations**
- **Same, not revised for 2.5.** The [IG25] Limitations section is written generically for "GPT Image models" and matches the text quoted in image-prompting-openai.md L66:
  - "Complex prompts may take up to 2 minutes"
  - text placement and clarity
  - consistency of "recurring characters or brand elements"
  - "difficulty placing elements precisely in structured or layout-sensitive compositions"
  [PRIMARY] The 2-minute figure was kept even though OpenAI says 2.5 "reduced image generation latency by up to 50% compared with Images 2.0". So this section looks carried over, not re-measured. [PRIMARY] [ANN] [INFERENCE]
- **Same.** "Repeated edits can still change details you intended to preserve… composite the approved edit into the original image instead of relying on prompting alone." [PRIMARY] [IP25]
- The system card contains no prompting guidance. Its only behavioral notes are about safety layers and "heightened realism". [PRIMARY] [SC25]

**What applies to our endpoint**
- **Model unknown.** [ANN]: "Images 2.5 is available to all ChatGPT, ChatGPT Work, and Codex users". [CX] still says: "Built-in image generation uses `gpt-image-2`". At `8ea2428c`, Codex source still has `const IMAGE_MODEL: &str = "gpt-image-2";`, and the repo contains no `gpt-image-2.5` or `sunburst` string. The bundled imagegen skill last changed content on 2026-08-10, before 2.5. [PRIMARY] [CXSRC] Probes find that `model` is ignored and that C2PA reads `gpt-image 2.0` for Codex, Flare, and Sunburst outputs alike. Issues #43965 and #45452 are open with no maintainer reply. [SECONDARY] [EP]
- **New settings can't be used.** Our tool sends `quality: "auto"` and `size: "auto"`, and the Codex `ImageQuality` enum has no `xhigh` or `max`. [PRIMARY] [EP] Because OpenAI uses identical prompts for both 2.5 models and for gpt-image-2, prompts written from the shared guidance fit whichever model serves the request. [INFERENCE]

## 2. Skill impact (`skills/generate-image/SKILL.md` at tag `#E9BD`)

No rule needs to be removed or rewritten for 2.5. The one recommended change is the Review checklist, which should cover the verification steps that are new in the 2.5 guide. All other rules stay.

| Line | Rule | Verdict | Evidence | Proposed wording / note |
|---|---|---|---|---|
| L10 | "Size and quality can't be set; the shape follows the prompt." | **Stays** | [EP] [CXSRC] [IG25] | `xhigh` and `max` exist only in the public API. Our tool sends `auto`. Don't mention quality or model names in the prompt ("Set API parameters separately from the prompt" [IP25]). |
| L14 | Purpose first | **Stays** | [IP25] "Name the subject and intended use"; [HC] "describe what it’s for" | — |
| L16 | Coverage, no added content | **Stays** (now better supported) | [IP25] "without adding unrelated instructions" | — |
| L17 | Visible terms; no other tools' flags | **Stays** | [IP25] "Describe visible details"; "Set API parameters separately from the prompt" | OpenAI's examples still use evaluative words ("cool", "beautiful"). The rule rests on non-OpenAI evidence, which 2.5 does not contradict. |
| L18 | Binding: sentences; keyword lists rewritten | **Stays** | [IP25] format sentence unchanged; no JSON example | — |
| L19 | Positive content | **Stays** | [IP25] says nothing about it | Exclusions remain in the constraints section (L20), as in every OpenAI example. |
| L20 | Constraints last | **Stays** | [IP25] "organize the prompt as scene, subject, details, and constraints" | — |
| L21 | Density; labeled lines for crowded requests | **Stays** | [IP25] "using labeled sections"; [ANN] less drift "as instructions become more specific" | — |
| L26 | Shape in words | **Stays** | [IP25] "Specify the composition, aspect ratio…"; [HC] | — |
| L27 | Setting; "name the place and period" | **Stays; optional tweak** | [IP25] "Name the place and date to establish a historical setting" | Optional: "For historical or real events, name the place and the date or period." |
| L37 | Photos: ask for photorealism | **Stays** | [IP25] "Request “photorealistic” or “real photograph” explicitly"; camera specs are "cues for appearance" | — |
| L39 | Sets: same spec repeated | **Stays** | [IP25] "repeating the character’s defining details"; the consistency limitation is unchanged [IG25] | — |
| L43–46 | Text: quoted, typography, letter spelling, no other text | **Stays** | [IP25] text bullet; "Render … exactly once" | 2.5 dropped the "ALL CAPS" alternative to quotes; the skill already uses quotes only. L44's non-English language/script clause has no OpenAI source, before or after 2.5. Keep it. |
| L47 | Diagrams as spec; facts from the prompt | **Stays** (reinforced) | [IP25] "provide the real text or data"; "verify labels and factual relationships"; fictional-data warning | — |
| L48 | Original logos and marks | **Stays** | [IP25] "Create an original, non-infringing logo" | — |
| L84–87 | Transparency rules | **Stays** | [IP25] cutout section; [CBT25] "Prompt instructions take priority…" | The 2.5 GA status changes nothing for the prompt, and our endpoint's model is unknown. |
| L91 | Review checklist | **Change (add)** | [IP25] "Are diagram labels and relationships correct?"; "inspect clothing, staging, and surroundings for historical accuracy"; "Check the decoded image's alpha channel, including hair, glass, shadows, and object edges." | Replace with: "Check the result against every requirement in the prompt: coverage, text spelling and legibility, diagram labels and the relationships they show, counts, placement, period details in historical scenes, the keep list, and the shape. For transparent results, also check fine edges (hair, glass, shadows) for halos or a painted backdrop." |
| L92 | Resend same prompt once | **Stays** | [IP25] "Repeat requests to measure consistency" | — |
| L93 | Integrated rewrite; if quality is `low`, add scene-level detail | **Stays** (no OpenAI support either way) | [IP25] "Compare quality levels before rewriting the prompt" (the API lever, which we can't use); [IG25] `auto` picks quality "based on the prompt" | If 2.5 serves the endpoint, the backend may report `xhigh` or `max`. The rule only triggers on `low`, so it still works. [INFERENCE] |
| L96–97 | Composite pixel-exact regions; tell the user about limits | **Stays** | [IP25] "composite the approved edit into the original image"; [IG25] limitations unchanged | — |

Not added:
- A Flare- or Sunburst-specific rule: the agent can't choose the model, and OpenAI uses the same prompts for both. [IP25] [EP]
- A quality-setting rule: quality can't be set on our endpoint. [EP]
- A prompt-length cap: OpenAI has published no new statement on length. [CX] [AC] [IP25]

[IP25]: https://developers.openai.com/api/docs/guides/image-prompting
[IG25]: https://developers.openai.com/api/docs/guides/image-generation
[TOOL]: https://developers.openai.com/api/docs/guides/tools-image-generation
[ANN]: https://openai.com/index/introducing-chatgpt-images-2-5/
[SC25]: https://deploymentsafety.openai.com/chatgpt-images-2-5
[MF]: https://developers.openai.com/api/docs/models/gpt-image-2.5-flare
[MS]: https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst
[CL]: https://developers.openai.com/api/docs/changelog
[OAPI]: https://github.com/openai/openai-openapi/commit/21cb7e98d8166a691a0eb8679a90419eb816cf35
[CB2]: https://github.com/openai/openai-cookbook/blob/d310dfa05d20fb653caa9c1c4b89ac1a4aeeeae4/examples/multimodal/image-gen-models-prompting-guide.ipynb
[CBT25]: https://github.com/openai/openai-cookbook/blob/93efae39998351b540f917e33f847c6d6097cda7/examples/multimodal/transparent-image-assets-for-campaigns-and-presentations.ipynb
[CX]: https://learn.chatgpt.com/docs/image-generation
[HC]: https://help.openai.com/en/articles/11084440-images-in-chatgpt
[RN]: https://help.openai.com/en/articles/6825453-chatgpt-release-notes
[AC]: https://openai.com/academy/image-generation/
[CXSRC]: https://github.com/openai/codex/blob/8ea2428c38f8994e18d789669f5cbc5df75e1f17/codex-rs/ext/image-generation/src/tool.rs#L58
[EP]: codex-images-endpoint.md
[FORUM]: https://community.openai.com/t/introducing-gpt-images-2-5-in-the-api-and-chatgpt/1395897
