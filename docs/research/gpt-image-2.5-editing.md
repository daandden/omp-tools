# gpt-image-2.5 edits and multi-reference composition

Researched on 2026-10-01. This note extends `image-prompting-editing.md` and `image-prompt-criteria-edit.md` without repeating them. No images were generated and no paid API calls were made. Pinned sources:
- `openai/codex` at `8ea2428c` (main, 2026-10-01)
- cookbook at `93efae39`
- `openai-openapi` at `21cb7e98` (the commit that added 2.5) and `9f25f936` (main)

Labels:
- **[PRIMARY]**: OpenAI docs, source code, or system card; a benchmark owner's own page; or a paper's own measurements.
- **[SECONDARY]**: community material. Each use carries a rigor note.
- **[INFERENCE]**: my conclusion, not directly observed.

Status tags:
- **Same**: unchanged from the gpt-image-2 guidance.
- **Changed**: different for 2.5.
- **New**: appears for the first time with 2.5.

## 0. What our route actually runs

- **Same.** This repo sends `model: "gpt-image-2"` (`extensions/codex-images.ts:83`). Codex at `8ea2428c` still hardcodes `IMAGE_MODEL = "gpt-image-2"` and `MAX_EDIT_IMAGES = 5`. Its image-generation extension last changed on 2026-09-24 (#47956), and its bundled imagegen skill on 2026-09-01 (a formatting-only change). [PRIMARY] CXS
- The Codex doc still says "Built-in image generation uses `gpt-image-2`". The announcement says Images 2.5 is "rolling out today to … Codex users across all tiers". [PRIMARY] CXD, ANN
- **What two independent probes of the native endpoint found** [SECONDARY] I43965 (two requests per prober, no maintainer reply):
  - An intentionally invalid `model` returned HTTP 200.
  - The response has no effective-model field.
  - The C2PA metadata reads `gpt-image 2.0`.
- [INFERENCE] We can't tell or choose whether gpt-image-2, Flare, or Sunburst serves our edits. Treat every 2.5 capability claim below as possibly true on our route, never as something a prompt can rely on.

## 1. Cited findings

**Preservation ("change only X")**
- **Same.** Prompting fundamental #6 matches the gpt-image-2 guide word for word: "For edits, say “change only X” and list the details to preserve, such as identity, geometry, layout, lighting, or labels. … For precise local edits, also identify saturation, contrast, arrows, camera angle, and surrounding objects that must remain unchanged." [PRIMARY] IP25
- **Same.** Every edit example prompt in the 2.5 guide copies the gpt-image-2 cookbook word for word: translate, style transfer, try-on, combine, cutout, sketch, remove, insert a person, furniture swap, and the winter follow-up. Each is now illustrated with Flare and Sunburst outputs side by side, both from the same prompt. The GPT Image 2 tab says: "Its illustrated examples use GPT Image 2.5 Flare and GPT Image 2.5 Sunburst; outputs can differ across models." [PRIMARY] IP25, CB2. So OpenAI changed no edit-prompting technique for 2.5 and wrote no model-specific prompts.
- **Same.** The 2.5 migration section keeps the limit: "Repeated edits can still change details you intended to preserve. Restate those constraints and inspect each result. If a region must remain pixel-identical, composite the approved edit into the original image instead of relying on prompting alone." [PRIMARY] IP25
- **Changed (claim only).** OpenAI's three statements:
  - Guide: "Both models offer improvements in precise editing and subject preservation." [PRIMARY] IP25
  - Announcement: "Images 2.5 is better at editing only what you’ve asked for, while keeping the rest of the details the same—even with more complex subjects and backgrounds." [PRIMARY] ANN
  - System card: "Users can change an image’s setting, style, or composition while retaining more of the details." It reports safety evaluations only, with no edit-quality numbers. [PRIMARY] SC
- **Changed, partly confirmed by an independent test** [PRIMARY for its own benchmark] FRG §4.1. Setup: one masked receipt field was edited, with identical prompts and alpha masks for every model.
  - OCR found changes to the surrounding text in 31.7% of Flare outputs and 31.2% of Sunburst outputs, against 44.2% for gpt-image-2 at both low and medium. On unedited copies, OCR reports a change 12.1% of the time.
  - The new value itself was not correct more often: 67.7–77.1%, with no significant difference between models.
  - Rigor: preprint (v2, 2026-09-16) from one API account; primary contrasts chosen after the results were known; the gain is concentrated in one corpus (CORD) and depends on alignment; the edits used the API `mask`, which our route never sends.
- **A community five-round edit chain on one portrait** [SECONDARY] RD1. Rigor: one chain per model, the author's own pixel diff, run through a reseller the author links with campaign-tagged URLs.
  - Round 2's keep list left out a chalkboard sign, and all three models (gpt-image-2, Flare, Sunburst) removed it.
  - In round 5 (add a second person), gpt-image-2 changed about 60% of the pixels and reframed the shot. Flare and Sunburst each changed about 18% and kept the camera fixed.
  - Faces held on all three models.
- [INFERENCE] 2.5 may over-edit less, but anything missing from the keep list can still change.

**Masks and naming the region**
- **Same.** "Masking with GPT Image is entirely prompt-based. The model uses the mask as guidance, but may not follow its exact shape with complete precision." "If you provide multiple input images, the mask will be applied to the first image." The examples now use `gpt-image-2.5-sunburst`. [PRIMARY] IG25. Both model pages list "inpainting". [PRIMARY] MS, MF
- **Same.** In ChatGPT's selection tool, "Highlights are not always precise, and edits may extend beyond the area you selected." The Help Center adds: "If you want the edit to apply to a specific area, include that area in your prompt." [PRIMARY] HC
- **Same.** Our route sends no mask, so the target region is still named in words. [PRIMARY] CXS

**Input fidelity**
- **Changed (now undocumented).** The input-fidelity note has moved under "Earlier GPT Image models … not Sunburst or Flare". There, for gpt-image-2, "omit this parameter; the API doesn't allow changing it because the model processes every image input at high fidelity automatically." No document states how 2.5 behaves. [PRIMARY] IG25. The insert-a-person example still says only "For `gpt-image-2`, omit `input_fidelity`". [PRIMARY] IP25
- **The API reference is generic.** It lists `input_fidelity: "high" | "low"` described only as "Controls fidelity to the original input image(s)". [PRIMARY] ER. The spec's `InputFidelity` schema says it is "only supported for `gpt-image-1` and `gpt-image-1.5` and later models … Defaults to `low`". [PRIMARY] OAS
- **Observed rejection.** Sending `input_fidelity="high"` to `gpt-image-2.5-flare` returned HTTP 400 `invalid_input_fidelity`. Sunburst was assumed to behave the same but wasn't tested. [PRIMARY for its own call log] FRG App. A
- **Forum speculation.** One user's speculation is that Sunburst is "like a 'model branding' of the image input fidelity setting". [SECONDARY, unsupported] FORUM #5
- **Effect on us: none.** Our route never sends `input_fidelity`, so the prompt stays the only lever for preservation. [PRIMARY] CXS; [INFERENCE]

**Identity, products, and recurring subjects**
- **Same** identity-lock prompt: "Do not change her face, facial features, skin tone, body shape, pose, or identity in any way. Preserve her exact likeness, expression, hairstyle, and proportions. Replace only the clothing…". The guide adds: "This pattern also applies to edits where a product or object must remain recognizable." [PRIMARY] IP25
- **Changed (claim).** Images 2.5 "is better at preserving the subjects in your reference photos". "Image subjects look more recognizable … distinctive features are more likely to carry through." [PRIMARY] ANN
- **Same.** The Limitations section still lists Consistency ("may occasionally struggle to maintain visual consistency for recurring characters or brand elements across multiple generations") and Composition Control. [PRIMARY] IG25. The character workflow is also unchanged: "Repeat the appearance constraints so the character stays consistent", with the constraint "Do not redesign the character". [PRIMARY] IP25
- **Reference products** [PRIMARY for its own benchmark] FRG §4.3:
  - 2.5 rendered the small SKU code on a reference product exactly more than twice as often: Flare 64% and Sunburst 61%, against 28% for gpt-image-2 low and 23% for medium.
  - It also drew the product larger than asked. The prompt requested "a product about a tenth of the frame width". The label filled 4.1% (Flare) and 3.9% (Sunburst) of the frame, against 2.7% and 2.4% for gpt-image-2.
  - The size-controlled gain did not replicate.
  - [INFERENCE] A stated size for an added object is not reliably followed.
- **New (safety).** The system card says 2.5's "heightened realism … could, absent safeguards, allow more convincing deepfakes". Its monitor runs "combined analysis of input images and prompts to evaluate potential malicious edits" and blocks at "the image input (editing) and image output layers". [PRIMARY] SC. The Codex doc asks users to "confirm that you have permission to use their likeness". [PRIMARY] CXD

**Number of references, their roles, and indexing**
- **Same.** On the API, "For GPT image models, you can provide up to 16 images". The 2.5 OpenAPI commit adds the 2.5 model ids to that sentence. [PRIMARY] ER, OAS. Codex and our route allow at most 5, unchanged at `8ea2428c`. [PRIMARY] CXS
- **Same.** Each reference gets a number and a role:
  - The guide says: "Identify each input by number and purpose: subject, style, clothing, or background. Explain how the inputs should combine and which elements should move where." [PRIMARY] IP25
  - For compositing: "Pass the scene photograph as image 1 and the dog photograph as image 2. Specify which element to move, its destination, and what must remain unchanged." [PRIMARY] IP25
  - The Codex doc says "Use a small set of reference images", "Identify each image by order", and "Use spatial terms such as foreground, background, left, and right". [PRIMARY] CXD
- **Same, but missing from our earlier notes.** The Responses tool guide says: "Image generation works best when you use terms like `draw` or `edit` in your prompt. For example, if you want to combine images, instead of saying `combine` or `merge`, you can say something like 'edit the first image by adding this element from the second image.'" [PRIMARY] RT. That guide covers the Responses tool, where a mainline model rewrites the prompt; whether it holds for our raw prompt is [INFERENCE].
- **No guidance on how many references 2.5 handles well.** No OpenAI doc says how 2.5 fidelity changes as references are added. The guide's gift-basket example passes 4 references to Sunburst. [PRIMARY] IG25. Fewer references remain the safe default. [INFERENCE]
- **New (benchmark).** On Arena's multi-image edit board, Sunburst leads Flare, which leads gpt-image-2 (§2). [PRIMARY] ARENA-M

**Style transfer**
- **Same** prompt and advice: "Assign the reference image a specific role: its palette, texture, or visual medium. Describe the new subject separately." [PRIMARY] IP25
- **Changed (claim).** Images 2.5 is "better at reflecting visual styles"; the system card's line about changing "setting, style, or composition" applies here too. [PRIMARY] ANN, SC. I found no measurement of this.

**Text edits and translation**
- **Same** prompt: "Translate the text in the infographic to Spanish. Do not change any other aspect of the image." The guide still says to "check the translation and any words left in the original language". [PRIMARY] IP25
- **Independent results** [PRIMARY for its own benchmark] FRG §4.1, §4.4:
  - Text around the edit changed less often.
  - The edited value was not correct more often.
  - Fine print showed no measurable gain above the OCR limit.
  - [INFERENCE] Every edited string still needs checking.

**Follow-up edits**
- **Same** advice: "Pass the previous output as the next edit input, request one change, and repeat the details to preserve. References such as “same style as before” can carry context, but restate critical constraints if the result drifts." [PRIMARY] IP25
- **New wording** in the migration section: "For editing workflows, test the complete sequence of edits as well as individual steps." [PRIMARY] IP25
- **Changed (claim, ChatGPT only).** "During longer ChatGPT conversations, Images 2.5 follows specific editing instructions more reliably across multiple edits. Earlier changes are more likely to stay consistent, and each new edit builds on the work you’ve already done without degrading image quality over time." [PRIMARY] ANN. Our tool is stateless: every call is a fresh request. [INFERENCE]
- **Not confirmed on fresh requests** [PRIMARY for its own benchmark] FRG §4.2:
  - Photo chains (6 turns): every model kept about 94–96% of its edits, with no difference between models.
  - Receipt chains (4 edits): Flare kept fewer earlier edits than gpt-image-2 (89%, against 94% for low and 98% for medium; significant after Holm correction). Its first-try success was also lower, but not significantly after correction (Holm p = 0.0504). Sunburst did not differ from gpt-image-2.
- **The guide's follow-up example has no keep list.** It is a single line, "Make it look like a winter evening with snowfall.", the same as in the gpt-image-2 cookbook. [PRIMARY] IP25, CB2. The input image already carries the scene, so this does not show that keep lists are unnecessary. [INFERENCE]

**Transparency with reference images**
- **Changed.** Transparency is no longer in preview for 2.5. The API reference says "`gpt-image-2.5-sunburst` and `gpt-image-2.5-flare` … support `opaque` and `transparent` backgrounds" and that "For `gpt-image-2` … this support is in preview". [PRIMARY] ER. The cookbook dropped "(in preview)" and switched its example to Flare. [PRIMARY] CBT25
- **Same.** The cutout prompt, which uses a reference image, is unchanged and shown on both 2.5 models with `background="transparent"`: "Extract the product from the input image and isolate it on a fully transparent background…". The guide still says: "For subsequent edits, repeat the requirement to preserve the transparent background." [PRIMARY] IP25. The 2.5 cookbook keeps the warning "Prompt instructions take priority over `background="transparent"`". [PRIMARY] CBT25
- **New wording.** The model-parameters section says "Check the decoded image's alpha channel, including hair, glass, shadows, and object edges." The final checklist asks "If transparency is required, does the file contain an alpha channel rather than a painted background?" [PRIMARY] IP25
- **Changed (claim).** The announcement says the model "can handle more complex layouts including transparent backgrounds". A customer quote cites "improved transparent-background generation". [PRIMARY] ANN
- **Unchanged on our route** [SECONDARY] I42743, comment dated 2026-09-13, after the 2.5 rollout, on Codex 26.908.4834.0:
  - With the same RGBA reference, some outputs came back RGBA and others came back RGB with a checkerboard painted into the pixels. One batch failed 5 of 5; a later batch with simpler prompts succeeded 5 of 5, four of them with a reference.
  - The cause was not isolated. The commenter says the negative wording "no painted checkerboard" was not shown to cause the failure.
- **Flag versus prompt word.** In a reseller test, the word "transparent" in the prompt without the flag produced painted checkerboards, and setting the flag produced real alpha. [SECONDARY] RD1

## 2. Edit benchmarks that report 2.5

| Benchmark (owner's page) | Sunburst | Flare | gpt-image-2 | Notes | Label |
|---|---|---|---|---|---|
| Arena image edit, overall (votes to 2026-09-29) | 1522 (1517–1528), 47,289 votes | 1478 (1473–1484), 44,792 votes | 1461 (1458–1465), "gpt-image-2 (medium)", 293,819 votes | Quality setting of the 2.5 entries not stated | [PRIMARY] ARENA |
| Arena multi-image edit (votes to 2026-09-21) | 1527 (1520–1533), 14,999 votes | 1478 (1472–1484), 15,443 votes | 1453 (1449–1457), 110,462 votes | Closest public signal for multi-reference composition | [PRIMARY] ARENA-M |
| AA-Image-Editing v2.0 (fetched 2026-10-01) | 1182 ±8 at max, 17,899 samples | 1162 ±8 at max, 18,643 samples | 1122 ±8 at high, 14,114 samples | "Voters compare edited outputs from the same input image and editing instruction." Recruited panel plus Image Arena votes cast before 2026-01-01. | [PRIMARY] AA |
| AIForge-Doc v3, forgery tasks with known answers | §1 | §1 | §1 | Only test that scores whether unchanged regions stayed unchanged | [PRIMARY for its own benchmark] FRG |
| GEdit-Bench, ImgEdit, KRIS-Bench | not reported | not reported | not reported | Repos last pushed 2026-04-29 (Step1X-Edit), 2025-11-05 (ImgEdit), 2025-10-19 (KRIS). The KRIS page lists GPT-4o only. | [PRIMARY] GEDR, IMGR, KRISP |
| GEditBench v2 | not listed | not listed | not listed | The only OpenAI entry is "GPT Image 1.5 (26-03-04)" | [PRIMARY] GEB2 |

- Preference Elo measures which edit voters liked, not whether untouched regions stayed untouched. FRG makes the same point. Scores can't be compared across the two boards. [INFERENCE]

## 3. Flare vs Sunburst for edits

- **OpenAI's positioning:**
  - Sunburst is for "workflows where editing precision matters most" [IG25] and "for precise editing" [RT]. It is "built for premium visual workflows that benefit from tighter control across edits" and offers "an extra level of precision for detailed creative work with longer generation times" [ANN].
  - Flare is for "fast, high-quality everyday image generation" [IG25] and is "the default choice for most applications" [ANN]. [PRIMARY]
- **OpenAI contradicts itself on Flare against gpt-image-2.** The guide says Flare has "image quality comparable to GPT Image 2". The announcement says it delivers "higher-quality images than GPT‑Image‑2 at 50% lower latency". [PRIMARY] IP25, ANN
- **The edits API defaults to Sunburst:** "Defaults to `gpt-image-2.5-sunburst`." [PRIMARY] ER. The two models have identical token prices. [PRIMARY] MS, MF
- **Prompts don't differ.** Every guide example uses the same prompt for both models, and the guide gives no model-specific prompting advice. [PRIMARY] IP25
- **Measured differences:**
  - Sunburst leads both preference boards: by 44 points on Arena overall, 49 on Arena multi-image, and 20 on AA. [PRIMARY] ARENA, ARENA-M, AA
  - In receipt chains, Flare lost more of its earlier edits and Sunburst did not. Both disturbed surrounding text equally little. [PRIMARY for its own benchmark] FRG
  - At matched output tokens, Sunburst was 1.2–2.0× slower than Flare. [PRIMARY for its own benchmark] FRG App. A
- **Unverified ChatGPT routing claim.** A forum post says ChatGPT defaults to Flare and escalates to Sunburst for "heavy editing". It is unsourced ("AFAIK"). [SECONDARY, unverified] FORUM #19
- **For our tool:** the model can't be chosen, so the skill can't act on any of these differences. [INFERENCE from CXS, I43965]

## 4. Skill impact

Scope: SKILL.md lines 51–96 (edits, transparency, and the edit rules in review) and line 39 (sets passed as references).

**Summary.** 2.5 requires no change to any edit or reference rule:
- OpenAI kept every edit technique and every example prompt.
- The route still names gpt-image-2, allows at most 5 references, and sends no mask or `input_fidelity`.
- Independent tests don't confirm the multi-turn claim on fresh requests.

Two wording additions come from current OpenAI text; one of them is new in the 2.5 guide. Four explicit non-changes follow, because 2.5 marketing invites them.

| Line | Rule (as written) | Verdict | Evidence | Proposed wording |
|---|---|---|---|---|
| 39 | **Sets**: … Earlier images are passed as references. | Stays | IG25 (Consistency limitation kept), IP25 (character workflow unchanged) | — |
| 54 | `referenced_image_paths` … The image being edited goes first. | Stays | IG25 (mask applies to the first image), IP25 (scene passed as image 1), CXS | — |
| 55 | `num_last_images_to_include` … Image 1 is the oldest of the N. | Stays | CXS (still chronological) | — |
| 56 | Use one or the other, never both. Send as few references as the task needs. | Stays | CXS (≤5, unchanged); CXD ("small set"); no 2.5 doc on how fidelity scales with references | — |
| 59 | **Roles first** … | Stays | IP25 fundamental #7 unchanged | — |
| 60–62 | **Operation**, **Scope and target**, **End state** | Stay | IG25 (masks are prompt-based), HC (selection imprecise), CXS (no mask sent) | — |
| 63 | **Keep list**: what stays unchanged … | Stays. Don't shorten it because of 2.5's preservation claims. | IP25 ("Repeated edits can still change details you intended to preserve"), RD1 (an omitted sign was removed by both 2.5 models), FRG §4.2 | — |
| 64 | **Framing** | Stays | — | — |
| 67 | **Add**: what, where …, how large, and how it blends in … | Stays | FRG §4.3: 2.5 drew placed reference products larger than requested, so the size must still be stated and checked. Line 91 checks "placement"; adding "size" there is outside this scope. | — |
| 68–72 | **Remove**, **Replace**, **Change an attribute**, **Restyle**, **Background** | Stay | IP25 (prompts identical to the gpt-image-2 era) | — |
| 73 | **Text or translation**: the old and new strings quoted, or the target language and which text is in scope. Typography and placement are kept. | Add a check (not 2.5-specific) | IP25 translate section: "check the translation and any words left in the original language"; FRG §4.1 (the edited value was not correct more often) | `- **Text or translation**: the old and new strings quoted, or the target language and which text is in scope. Typography and placement are kept. In the result, check each edited string and look for words left in the original language.` |
| 74 | **Compose**: each moved element's source, destination, and what it must match, plus one sentence describing the final scene. | Add phrasing (not 2.5-specific) | RT: say "edit the first image by adding this element from the second image" instead of "combine" or "merge"; [INFERENCE] that it transfers to raw prompts | `- **Compose**: phrase it as an edit of the base image ("Edit image 1: add the dog from image 2 …"), not as "combine" or "merge". Give each moved element's source, destination, and what it must match, plus one sentence describing the final scene.` |
| 75 | **Outcome edits** | Stays | — | — |
| 78 | Each follow-up restates every constraint accepted earlier … | Stays | IP25 (restate constraints); ANN's multi-turn claim covers ChatGPT conversations only; FRG §4.2 (no gain on fresh requests, Flare worse on receipts) | — |
| 79 | To go back, send the version to return to and name it. | Stays | — | — |
| 80 | After two or three chained edits, or at the first sign of drift, restart from the original … | Stays | FRG §4.2 | — |
| 84 | Set `transparent_background: true` and describe an isolated subject … Any backdrop the prompt describes overrides the flag. | Stays | CBT25 (the "priority" warning is still present after the 2.5 update); IP25 (cutout prompt unchanged) | — |
| 85 | For charts and icons, name the regions that stay transparent. | Stays | CBT25 | — |
| 86 | On every later edit, set the flag again and ask to preserve the transparent background. | Stays | IP25 | — |
| 87 | A checkerboard painted into the result means transparency was lost: retry and restate it. | Change (new 2.5 guide wording) | IP25: "Check the decoded image's alpha channel" and "does the file contain an alpha channel rather than a painted background?"; I42743 (the failures are RGB files; reference edits are still intermittent after the 2.5 rollout) | `- Check the saved file's alpha channel with a local tool. A painted checkerboard or a file with no alpha channel means transparency was lost: retry and restate it.` |
| 94–96 | Fix an edit one thing per call … send the original and the draft … paste pixel-identical regions back … | Stay | IP25 (restate, compare, composite; kept verbatim in the 2.5 guide) | — |

**Explicit non-additions:**
- **No Flare or Sunburst guidance, and no model-selection advice.** The route can't choose a model, the endpoint accepts any `model` string, and OpenAI uses the same prompts for both models. Evidence: CXS, I43965, IP25.
- **No shorter keep lists and no dropping of restatement.** 2.5's preservation and multi-turn claims don't justify it. Evidence: RD1, FRG §4.2, IP25.
- **No `input_fidelity` or mask advice.** The route sends neither. Evidence: CXS.
- **No higher reference cap.** The route caps references at 5, not the API's 16. Evidence: CXS, ER.

## Sources

[IP25]: https://developers.openai.com/api/docs/guides/image-prompting (GPT Image 2.5 tab; GPT Image 2 tab)
[IG25]: https://developers.openai.com/api/docs/guides/image-generation (Edit Images, mask, Limitations, Earlier GPT Image models)
[RT]: https://developers.openai.com/api/docs/guides/tools-image-generation (Prompting tips)
[ER]: https://developers.openai.com/api/reference/resources/images/methods/edit
[OAS]: https://github.com/openai/openai-openapi/commit/21cb7e98d8166a691a0eb8679a90419eb816cf35 and `InputFidelity` in https://github.com/openai/openai-openapi/blob/9f25f93610b782cd518d6470ccfafc614d28b079/openapi.yaml
[MS]: https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst
[MF]: https://developers.openai.com/api/docs/models/gpt-image-2.5-flare
[ANN]: https://openai.com/index/introducing-chatgpt-images-2-5/
[SC]: https://deploymentsafety.openai.com/chatgpt-images-2-5
[CB2]: https://github.com/openai/openai-cookbook/blob/d310dfa05d20fb653caa9c1c4b89ac1a4aeeeae4/examples/multimodal/image-gen-models-prompting-guide.ipynb (pinned by IP25; still gpt-image-2)
[CBT25]: https://github.com/openai/openai-cookbook/blob/93efae39998351b540f917e33f847c6d6097cda7/examples/multimodal/transparent-image-assets-for-campaigns-and-presentations.ipynb
[CXS]: https://github.com/openai/codex/blob/8ea2428c38f8994e18d789669f5cbc5df75e1f17/codex-rs/ext/image-generation/src/tool.rs#L58-L59 and https://github.com/openai/codex/tree/8ea2428c38f8994e18d789669f5cbc5df75e1f17/codex-rs/skills/src/assets/samples/imagegen
[CXD]: https://learn.chatgpt.com/docs/image-generation
[HC]: https://help.openai.com/en/articles/11084440-images-in-chatgpt
[I42743]: https://github.com/openai/codex/issues/42743
[I43965]: https://github.com/openai/codex/issues/43965
[FRG]: https://arxiv.org/abs/2609.13617 (Raj et al., "ChatGPT Images 2.5 on Forgery Tasks", v2 2026-09-16)
[ARENA]: https://arena.ai/leaderboard/image-edit
[ARENA-M]: https://arena.ai/leaderboard/image-edit/multi-image-edit
[AA]: https://artificialanalysis.ai/image/leaderboard/editing
[GEB2]: https://zhangqijiang07.github.io/gedit2_web/
[GEDR]: https://github.com/stepfun-ai/Step1X-Edit
[IMGR]: https://github.com/PKU-YuanGroup/ImgEdit
[KRISP]: https://yongliang-wu.github.io/kris_bench_project_page/
[RD1]: https://www.reddit.com/r/ChatGPT/comments/1wcj1ud/gpt_image_25_prompt_guide_2026_23_9_official_edit/ (community post, vendor-linked)
[FORUM]: https://community.openai.com/t/introducing-gpt-images-2-5-in-the-api-and-chatgpt/1395897 (posts #5 and #19 by non-staff users)
