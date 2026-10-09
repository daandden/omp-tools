# GPT Image 2.5 (Flare, Sunburst): independent evidence for prompting

Researched on 2026-10-01. This note covers benchmarks, format tests, and community reports on gpt-image-2.5. It extends [image-prompt-format.md][FMT], [image-prompt-criteria-failures.md][FAIL], [image-prompting-openai.md][OAI], and [codex-images-endpoint.md][EP] and does not repeat them. No images were generated and no paid API calls were made. I inspected published outputs only: 9 img.ly outputs from one JSON prompt (3 each from GPT Image 2, Flare, and Sunburst) and Ronald Luc's JSON/prose pair. Leaderboards were rendered in a headless browser on 2026-10-01. Reddit threads were also captured in a headless browser, because Reddit blocks plain fetches.

Tags: [PRIMARY] means papers, OpenAI docs, and the leaderboard operators' own pages. [SECONDARY] means blogs, vendor mini-benchmarks, the forum, and Reddit. [INFERENCE] means my conclusion. Each finding also carries a **Δ** marker against gpt-image-2: **same**, **changed**, or **new**. A **measured** finding has a protocol, counts, and published outputs. An **anecdotal** finding has none of these.

Baseline from OpenAI, quoted verbatim: "Short prompts, descriptive paragraphs, JSON-like structures, instructions, and tags can all express the same intent. Choose the format that makes the requirements easiest to read and update rather than relying on special syntax." Also: "Flare is the small model, optimized for speed, with image quality comparable to GPT Image 2. GPT Image 2.5 Sunburst is the base model, optimized for quality, with higher image quality than GPT Image 2." [PRIMARY] [IP]

## Bottom line

- **Nothing measured on 2.5 requires a different way of writing prompts.** No source documents prompt syntax specific to Flare or Sunburst. OpenAI tells migrators to "Compare quality levels before rewriting the prompt" [PRIMARY] [IP]. Luc ran 50 community prompts, mostly written for GPT Image 2, and reports "They carry over" [SECONDARY] [LUC-G]. Measured gains are in preference, physics, lighting, materials, and harder compositional sets. The failure modes are the same kinds as before: group-level counts, unrequested extra content, open-ended attributes, implicit physics, dense text, full-body people, and unrequested copy. [PRIMARY] [AA-CAT] [VVR] [SECONDARY] [IB] [PF]
- **Text rendering did not clearly improve. On designed dense-text prompts, 2.5 trails GPT Image 2.** On Artificial Analysis (AA) Text Rendering, GPT Image 2 (high) scores 1205, Flare (max) 1183, and Sunburst (max) 1162. On AA Productivity & Knowledge Work, GPT Image 2 scores 1232 and ranks alone at 1, while both 2.5 models score 1187. LMArena's user-prompt Text Rendering board points the other way: Sunburst 1467, Flare 1435, GPT Image 2 (medium) 1425. An arXiv study finds "fine print show[s] no measurable gain". [PRIMARY] [AA-CAT] [LMA-TR] [FORG]
- **Format: on 2.5, JSON neither helps nor hurts in any test found.** The one content-matched pair, JSON versus the same fields in prose on Sunburst at high, gave "Nearly the same image" (n = 1). I inspected 10 published outputs from JSON prompts, and none rendered keys, braces, hex codes, or non-text quoted values. There is no controlled test, and the OpenAI baseline stands. [SECONDARY] [LUC-G] [IMGLY-J] [INFERENCE]
- **One real leak was observed, from prose.** A quoted *sample* caption in a prose prompt was rendered verbatim, even though the prompt said to adapt or drop it (n = 1, Sunburst). Quotation marks remain a strong render signal on 2.5. [SECONDARY] [LUC-G]
- **On our endpoint we cannot tell which model runs.** The endpoint accepts any `model` value with no visible effect [EP] [CX43965]. The Codex doc still says "Built-in image generation uses `gpt-image-2`" (checked 2026-10-01) [PRIMARY] [CXIG]. C2PA metadata reads `gpt-image 2.0` even for explicit API Flare requests [SECONDARY] [OAF25-23]. Our `quality: auto` cannot request the `max` tier that AA benchmarks [EP]. Skill rules therefore have to hold for both models. [INFERENCE]

## 1. Measured: large-sample preference leaderboards

**LMArena Text-to-Image** [PRIMARY] [LMA] [LMA-CAT]. Default view, board dated 2026-09-25, checked 2026-10-01. Votes are pairwise and blind, on user-submitted prompts sorted into categories. Both 2.5 entries are flagged "Preliminary". GPT Image 2 is listed as "gpt-image-2 (medium)", and the 2.5 entries carry no quality label.

| Category | Sunburst (votes) | Flare (votes) | gpt-image-2 medium (votes) |
| --- | --- | --- | --- |
| Overall | 1424 ±8 (10,884) | 1401 ±8 (10,058) | 1383 ±4 (88,744) |
| Text Rendering | 1467 ±12 (3,699) | 1435 ±12 (3,360) | 1425 ±6 (32,795) |
| Photorealistic & Cinematic | 1432 ±12 | 1419 ±12 | 1381 ±6 |
| Portraits | 1469 ±17 | 1452 ±18 | 1431 ±8 |
| Product, Branding & Commercial | 1415 ±12 | 1394 ±12 | 1387 ±6 |
| Cartoon, Anime & Fantasy | 1441 ±12 | 1418 ±12 | 1402 ±6 |
| 3D Imaging & Modeling | 1418 ±21 | 1386 ±22 | 1364 ±9 |
| Art | 1391 ±16 | 1370 ±16 | 1367 ±8 |
| Image Edit, single image (board 2026-09-30) [LMA-E] | 1522 ±5 (47,289) | 1478 ±5 (44,792) | 1461 ±3 (293,819) |

- **Δ changed.** Sunburst leads in every category. Flare's interval separates from GPT Image 2 (medium) only in Overall and Photorealistic; it overlaps in every other category. Sunburst's lead over Flare is +44 on edits and +32 on Text Rendering and 3D.

**Artificial Analysis AA-Image-T2I v2.0** [PRIMARY] [AA] [AA-CAT]. Checked 2026-10-01; the page shows no update date. The method: "Voters compare two images generated from the same prompt without knowing which model created each image." Votes come from a "recruited human panel, together with public Image Arena votes cast before 1 January 2026". The 2.5 models shipped in September 2026, so their votes are panel-only [INFERENCE]. AA describes its capability categories as "The model skill the prompt is written to test". It compares 2.5 at `max` with GPT Image 2 at `high`, which carry the same list price ($210.7 vs $211.0 per 1k images).

| Category (Elo, AA rank range) | Sunburst (max) | Flare (max) | GPT Image 2 (high) |
| --- | --- | --- | --- |
| Overall (n ≈ 13–15k each) | **1197** (1–2) | 1190 (1–2) | 1172 (3) |
| Text Rendering | 1162 (2–5) | 1183 (1–4) | **1205** (1–2) |
| Productivity & Knowledge Work | 1187 (2–5) | 1187 (2–5) | **1232** (1) |
| Layout | **1240** (1–3) | 1219 (1–3) | 1226 (1–3) |
| Complex Compositions | 1230 (1–3) | **1237** (1–3) | 1216 (1–4) |
| Reasoning | 1175 (3–4) | **1203** (1–2) | 1200 (1–2) |
| Knowledge | 1195 (1–4) | 1203 (1–4) | 1194 (1–4) |
| Lighting | **1174** (1–2) | 1155 (1–2) | 1101 (4–8) |
| Material | **1180** (1–2) | 1173 (1–2) | 1128 (3–6) |
| Physics | **1193** (1) | 1167 (2) | 1143 (3–4) |
| Human Anatomy | **1220** (1–2) | 1189 (2–3) | 1194 (1–3) |
| UIUX Design | 1223 (1–3) | 1224 (1–3) | 1207 (1–4) |
| Editing board [AA-E] | **1182** (1) | 1162 (2) | 1122 (4–6) |

Each capability category has about 1.4k–1.8k samples per model, with 95% intervals of ±22–27.

- **Δ changed: lighting, material, and physics improved; Sunburst is ahead on all three.** These map to the skill's "Photos" and "Mood" rules. Nothing suggests those rules should change.
- **Δ changed (regression): text rendering and knowledge-work assets.** GPT Image 2 (high) is preferred for designed text prompts and for knowledge-work deliverables (slides, documents, diagrams). This holds at equal price and equal output-token budget: per [HAT], 2.5 `max` and GPT Image 2 `high` both use 7,024 tokens. Flare beats Sunburst on Text Rendering and Reasoning.
- **Conflict with LMArena on text.** The two boards differ on prompt source (designed capability prompts vs user prompts), on the GPT Image 2 tier (high vs medium), and on raters (recruited panel vs public). A plausible reading is that 2.5 renders short, casual text better but dense, designed text no better [INFERENCE]. Either way, no evidence supports loosening the skill's "short, essential text" rule.

## 2. Measured: capability suites and papers

**VVRBench** (arXiv 2609.35641 v1, 2026-09-28) [PRIMARY] [VVR]. Procedural scenes of colored shapes, written as plain sentences, with 46 constraint types checked by deterministic program verifiers. Settings: Sunburst snapshot 2026-09-08 and GPT-Image-2 2026-04-21, both at `medium`, 1024×1024. Flare was not tested.
- **Δ changed (better at high complexity).** On VVRBench-Fast (820 tasks), Sunburst scores 84.51% ±2.64 and GPT-Image-2 82.20% ±2.77. On VVRBench-Challenge (720 tasks), Sunburst scores **21.39% ±3.14** and GPT-Image-2 10.28% ±2.43.
- **Δ same (accuracy falls with constraint count).** On Fast, Sunburst scores 100% at complexity 3–10 but 56.67% at 36–44. On Challenge it falls from 31.67% at 45–56 to 7.92% at 69–80.
- **Group-level constraints fail** (Challenge, per-constraint pass rate, Sunburst / GPT-Image-2): same_count 56/43 (n = 266), times_as_many 58/44, each_contains 27/19 (n = 581), all_same_size 74/50, and exact_count 81/75 (n = 3,794). Pairwise relations are near ceiling: left_of, above, and right_of score 95–100, and color_shape_binding 99/98. The paper's verdict: "Generators satisfy requirements on individual objects and pairs but fail requirements that constrain whole sets of objects."
- **Unrequested objects despite an explicit exclusion.** no_unrequested_objects passes 62% for Sunburst and 51% for GPT-Image-2 (n = 720). Every prompt ends with a line like "Set the objects against a plain pale pink background; do not add other colored objects." **Δ changed** (fewer failures), but the failure is still frequent.
- Superlatives with n = 20 each are noisy. Sunburst: leftmost 15 (GPT-Image-2: 55), grid_occupancy 10 (10).
- "The GPT models always returned an image": there were no text-only abstentions, unlike Gemini.

**ImageBench V1.2** [SECONDARY, measured] [IB] [IB-S] [IB-F] [IB-2] [IB-M]. Checked 2026-10-01; the run date is not stated. The suite is 64 tests × 3 prompt variants = 192 images per model, at `quality: auto` and 1024×1024. Pass/fail verdicts come from open-weight VLM judges, every image is published, and the prompts are open source.

| Capability pass rate | Sunburst | Flare | GPT Image 2 |
| --- | --- | --- | --- |
| All (192) | 88.0% | 86.5% | 87.0% |
| Text Rendering (15 images) | 100 | 100 | 100 |
| Spatial (57): counting / relative position / scale | 98: 100 / 100 / 89 | 95: 100 / 100 / 67 | 91: 89 / 83 / 78 |
| Attribute binding / negation | 100 / 100 | 100 / 100 | 100 / 100 |
| Human realism (42): full body / hands / multi-subject | 67: **33** / 67 / 83 | 55: **8** / 67 / **50** | 69: **17** / 83 / 100 |
| Truthfulness (27): physics & reflections / world knowledge | 78: 75 / 83 | 85: 75 / 92 | 74: 58 / 83 |
| Graphical design (24): layout | 96: 89 | 100: 100 | 100: 100 |

- **Δ same (text hits the ceiling, so this suite cannot separate models on text).** Full-body people is the weakest subcategory for all three models. Flare is weakest on multi-subject scenes and on scale. Subcategory n is small (3–12 images), so treat it as a direction, not a ranking. [INFERENCE]

**ChatGPT Images 2.5 on Forgery Tasks** (arXiv 2609.13617 v2, 2026-09-16) [PRIMARY] [FORG]. Its experiments compare 2.5 at `medium` with GPT-Image-2 at `low` and `medium` (receipt edits, reference products) and use equal-cost tiers for fine print.
- **Δ same (fine print).** "Repeated editing and fine print show no measurable gain." Exact OCR-readable lines: GPT-Image-2 medium 88%, Flare high 91%, Sunburst high 83%; neither difference is significant. "Exploratory within-model tests find no higher tier better than low on OCR-readable text (0 significant comparisons out of 13)."
- **Δ changed, but driven by size.** "Product codes become more legible mainly because Images 2.5 draws the product larger." Label area in scene: 2.4% of the frame for GPT-Image-2 vs 4.1% for Flare and 3.9% for Sunburst. At matched product size the gain is +10 pp [−1, 23], not significant. Legibility tracks glyph height; the OCR floor is a 9 px cap height.
- **Flare vs Sunburst on edit chains.** On receipt chains, "succeeded and intact" was 65% for Flare (Δ −28 pp, significant after Holm correction), 86% for Sunburst (ns), and 93% for GPT-Image-2 medium. Edits are covered by the sibling note; this result is listed here because it splits the two models.

**img.ly AI benchmark (pilot)** [SECONDARY, measured, weak] [IMGLY] [IMGLY-J]. The suite is 37 prompts × 3 samples, via fal, scored by auto-measures plus a Claude-VLM tier; the page says it is "Not yet blind expert-panel reviewed". Sunburst scores 4.90/5 on prompt adherence across all prompts. On its one JSON prompt, which contains hex codes and `target_pct` coverage targets, Sunburst scores adherence 5.0 but color accuracy 2.0. On hex colors given in prose prompts, its color accuracy is 5.0. The JSON prompt adds a percentage-coverage requirement, so this is confounded and not a format effect [INFERENCE].

## 3. Measured, small n (vendor or author runs, published outputs)

- **PromptFrenzy re-run** (runs 2026-09-09, 3 runs per tier, `medium` defaults via AIMLAPI, hand-graded against a fixed rubric) [SECONDARY] [PF]:
  - Two-mirror reflection: Sunburst 2/3 pass; Flare and GPT Image 2 0/3. The prompt never says what the mirrors should show.
  - Arrow refraction: 0/9 across all three models.
  - Wrong-coloured fruit bowl: Sunburst 57.1, the same as GPT Image 2. Flare scores 52.4 at default and 57.1 when re-run at `high`: "So at matched spend Flare is the April model; at default spend it is a shade below it."
  - **Δ same.** The fruit-bowl page shows the mechanism, measured on GPT Image 2 (n = 1 run per version): "Name the colour and models obey. Leave it open and they revert." GPT Image 2 scored 100 when every colour was named and 57.1 when colours were left open [SECONDARY] [PF-FB]. Sunburst reproduces 57.1 on the open version, so the prior still wins on 2.5.
- **OneWave** (2026-09-08, 36 billed calls, 3 reps per cell at `high`, 1024×1024, author-scored) [SECONDARY] [OW]:
  - A table of 24 exact strings: GPT Image 2 and Flare both 24/24.
  - Seven mugs, the third one red, all handles pointing right: both passed.
  - A four-paragraph brief of 1,253 characters with 8 constraints: Flare and Sunburst 8/8, GPT Image 2 7/8 (it reversed the book-size order). The authors' summary: "Nouns are easy now. Relationships between nouns are where long briefs still break." **Δ changed (slightly better).** The report does not say whether 8/8 holds for all three reps.
- **Hatada** (2026-09-09, 26 requests, one sample per cell) [SECONDARY] [HAT]:
  - Quality ladder, in output tokens: 2.5 `high` = GPT Image 2 `medium` = 1,756; 2.5 `max` = GPT Image 2 `high` = 7,024. Flare and Sunburst consume identical token counts. **Δ new.** The forum independently found the same remap [SECONDARY] [OAF25-26].
  - A four-line Japanese poster rendered correctly on all three models. The prompt quoted each line, fixed the order, and ended with "render exactly this text and add no other characters". **Δ same.**
  - On order: "2.5 slid the illustration in directly after the headline. One sample each, so this is not a ranking."
  - The transparent fringe is unchanged (0.423% semi-transparent pixels vs 0.42% on GPT Image 2), and "Telling the model "no glow" does not remove it". **Δ same.**
- **Luc, 50 prompts, 60 images** (2026-09-26, Images API, one sample per prompt, author-graded, not blind) [SECONDARY] [LUC] [LUC-G]:
  - Unrequested copy: "Of the 22 Sunburst images made from repo prompts in that set, 12 added text nobody asked for, and in 8 of them it is a slogan about brighter or better days." Flare added copy in 2 of 11. The arms are confounded: Sunburst ran at `high`, Flare at `medium`, and the prompts differ. The author did not test a fix and suggests "no text other than the quoted strings". **Δ new / Sunburst-specific (anecdotal strength).**
  - Unrequested real brands: 3 of about 50 images showed a real logo or title (a space agency, a beer brand, a magazine). **Δ unknown.**
  - Moderation: three benign prompts about women were refused twice as written. Sunburst accepted minimally reworded versions ("lips closed, a modest neckline, jeans instead of shorts, a seated pose, fewer anatomy labels"). "Flare's output moderation was stricter than Sunburst's." **Δ new, n = 3.**
  - Flags inside the prompt: "`"resolution": "8K"`, `--ar 4:5` and `"style_strength": 0.75` are read as text". **Δ same.**
- **OpenAI forum, post #26** (2026-09-21): 6 matched prompts per model at 1920×1088 `high`. Mean time to complete: Flare 29.4 s, Sunburst 41.9 s. Outputs bill the same as gpt-image-2 "with quality “medium” remapped to “high” and “high” remapped to “max”". [SECONDARY] [OAF25-26]

## 4. Anecdotal community reports, 2 → 2.5 [SECONDARY]

None of these reports used blind rating or a seed. All are n ≤ a handful, or unstated.

- **"Old prompts carry over."** [LUC-G] (50 prompts, 1 sample each) and [ATL1], a Reddit guide posted 2026-09-10 with a commercial affiliation (Atlas Cloud), both report that the same prompts work on both models. The opposite claim, "The prompts did not change. The model did.", comes from [RHC] with no examples, no counts, and no model named. **Rigor: [LUC-G] is the strongest of these. The others are unverifiable.**
- **Edit drift.** In a five-round chain at `medium`, round 5 changed about 60% of pixels on GPT Image 2 and about 18% on Flare and Sunburst. When the keep line omitted a chalkboard, "All three models removed the sign." [ATL2] (n = 1 chain, no diff threshold stated). A single-edit diff showed no difference between the three models (mean diff 9.1–9.8) [HAT] (n = 1). [FORG] found no gain on repeated edits and a Flare regression on receipt chains. **Rigor: these conflict, and only [FORG] is controlled.**
- **Faces.** One commenter says Sunburst "makes faces look more plastic" [RCH]. Luc says the opposite: "Sunburst keeps pores and flyaway hairs; Flare smooths skin and warms the grade" [LUC-G]. A thread on ChatGPT output reports "pin head" and other proportion complaints [RBAD]. **Rigor: contradictory, eyeballed, and ChatGPT routing hides which model produced the image.**
- **UI generation.** "2.5 is the first model to genuinely improve on every test I throw at it" [RUI] [12UI] (12 prompts across tiers, eyeballed, from the author's own product).
- **Exclusions.** "Long exclusion lists made outputs literal and flat." [RREC] (278 reverse-engineered prompts, no counts for this claim).
- **ChatGPT-only effects.** Progressive cropping and softening across chained edits [RHOW]. Reasoning-mode retries and automatic Flare/Sunburst routing [OAF25]. These do not apply to our direct endpoint [INFERENCE].

## 5. Searched, not found

- **No 2.5 results** on GenEval, DPG-Bench, T2I-CompBench, OneIG-Bench (last README update 2025-09-19 [ONEIG]), TIIF-Bench (v2 leaderboard "will be released ASAP", as of 2026-06 [TIIF]), LongText-Bench (no OpenAI 2.5 entry [LTB]), Imag-Eval (leaderboard has no OpenAI 2.x model [IMAGEVAL]), or FEPBench (no revision after v2 of 2026-06; GPT Image 2 is the newest model [FEP]).
- **No controlled test of prompt length on 2.5.** The closest evidence is VVRBench's complexity curve (constraint count, not word count) and OneWave's 1,253-character brief (8/8).
- **No controlled JSON-vs-prose or labeled-lines-vs-prose test on 2.5.**

## 6. Prompt format on 2.5

- **Baseline (Δ same).** OpenAI still says any format "can all express the same intent", and still recommends labeled sections for complex requests [PRIMARY] [IP]. Neither Flare nor Sunburst has a documented format preference.
- **Content-matched pair (Δ same, n = 1).** Luc sent the JSON ice-cream ad verbatim (3,544 characters) and the same fields as prose, in the same order, to Sunburst at `high`, 1152×1536. Result: "Nearly the same image as J06: same four labels, same duplicate." He adds: "One sample each, so this shows the kind of difference, not a measurement." [SECONDARY] [LUC-G] I inspected both published images. Each renders only the four label strings. The JSON's other quoted values ("8K", "3:4", "warm golden-yellow gradient") do not appear as text.
- **No key or value leakage in the outputs I inspected (Δ same).** img.ly's JSON prompt reads `Render the following scene exactly: {"subject":"a lighthouse keeper",…,"colorPlate":[{"name":"coat","hex":"#F4C430","target_pct":15},…]}`. All 9 published outputs (3 each from GPT Image 2, Flare, and Sunburst) show a scene with no visible text. None renders braces, keys, or hex codes, and all honor "subject on the right" and "golden hour from the left". [SECONDARY] [IMGLY-J] (inspected by me; one prompt.)
- **Why "JSON wins" claims fail.** "The viral “JSON beats prose” comparisons usually put a detailed JSON prompt against a short prose one." Also: "the auto-generated JSON prompts in the YouArt repo are about 35% longer than prose for the same result." [SECONDARY] [LUC]
- **Quoted strings still render even when they shouldn't (Δ same).** A prose prompt quoted a sample caption, "little happy girl ♡", and told the model to adapt or drop it if the subject was not a girl. The input was an adult woman, and Sunburst rendered the sample verbatim [SECONDARY] [LUC-G] (n = 1). The format note's reason to reserve quotes for rendered text therefore still applies on 2.5, but the evidence comes from a prose prompt, not JSON. [INFERENCE]
- **Length.** No 2.5 study isolates length. Long prompts of 2.7k–3.7k characters ran fine in [LUC-G], and the 1,253-character brief scored 8/8 in [OW]. Failure grows with the number of constraints [VVR], which matches the pre-2.5 Imag-Eval finding that "instruction-following difficulty is primarily driven by the number of grounded constraints and instance bindings rather than prompt length alone" [PRIMARY] [IMAGEVAL-R]. [INFERENCE]
- **Verdict.** On 2.5, keep the existing preference for sentences and labeled lines on binding and maintainability grounds ([FMT], academic note A3). Do not justify it by harm from JSON: no 2.5 evidence shows such harm. [INFERENCE]

## 7. Failure modes a prompt rule can mitigate

| Failure on 2.5 | Evidence | Δ / Flare vs Sunburst | Prompt-side mitigation |
| --- | --- | --- | --- |
| An open-ended attribute reverts to the prior (a lemon stays yellow) | [PF] [PF-FB] | same; Flare is worse at default tier | Name the concrete value. GPT Image 2 went from 57.1 to 100 when colours were named (n = 1) |
| Implicit physics is wrong (mirror shows the back; refraction ignored) | [PF] [AA-CAT] [IB] | changed; Sunburst is better | State the visible result ("the mirror shows her face") [INFERENCE] |
| Group relations (same count, twice as many, each X contains Y) | [VVR] | changed (better) but 27–58% | Rewrite as an explicit number per group or an inventory per instance [INFERENCE] |
| Unrequested objects despite "do not add" | [VVR] | changed (62% vs 51% pass) | Give an exact inventory plus a plain, described background; check it in review [INFERENCE] |
| Unrequested slogans or copy | [LUC-G] | new; mostly Sunburst | Always end with "no text other than the quoted strings" (untested) |
| Quoted sample or placeholder text is rendered | [LUC-G] | same | Resolve every string before sending; quote only final text |
| Small text is illegible | [FORG] [AA-CAT] | same | Fewer, larger strings; long copy goes outside the image |
| Full-body and multi-person scenes | [IB] [AA-CAT] | Flare worse; Sunburst best on anatomy | State full-body framing and each person's pose and contact |
| Accuracy collapses as constraints accumulate | [VVR] | same shape | One requirement once; split overloaded requests |
| Keep list incomplete, so the omitted item is lost in edits | [ATL2] | same | Complete keep list repeated every turn |
| Benign people images refused by moderation | [LUC-G] | new; Flare stricter | Reword clothing and pose neutrally and retry once (n = 3) |
| Transparent fringe | [HAT] | same | None in the prompt; clean locally |

## 8. Skill impact (`skills/generate-image/SKILL.md` as of 2026-10-01)

The parent decides. "Stays" means the 2.5 evidence neither contradicts the rule nor adds anything to it.

**Change**

1. **L22 Checkable**: add a rule for resolving open choices. Evidence: [PF-FB], [PF], [AA-CAT] (Physics), [IB] (Physics & Reflections).
   > - **Checkable**: each requirement can be verified by looking at the result. When the user asks for an unusual property without naming it, the prompt names a concrete value ("a purple lemon", not "an unnatural colour"). An implied physical result is stated as what is visible ("the mirror shows her face").
2. **L31 Counts**: add group relations. Evidence: [VVR] Table 11 (same_count 56%, times_as_many 58%, each_contains 27% on Sunburst).
   > - **Counts**: numerals with an unambiguous unit. Larger counts also get an arrangement. "Every" or "all" is backed by a count. Relations between groups ("as many as", "twice as many", "each box holds a ball") are rewritten as a number for each group, or as a list per instance.
3. **L43**: add a rule against quoting placeholders. Evidence: [LUC-G] J19 (n = 1, Sunburst).
   > - Every rendered string is quoted exactly, short, and essential. Text the user supplied is copied character for character, never reworded or expanded. Example, placeholder, and conditional strings are resolved before sending; only the final string is quoted. Long or legal copy is added afterwards, outside the image.

**Optional (weak evidence; adopt only if the parent wants them)**

4. **L18 Binding**: a format clarification. This is not driven by any harm from JSON, because none was found on 2.5. Evidence: [IP], [LUC-G] pair, [IMGLY-J] inspected outputs, [FMT].
   > - **Binding**: the prompt is written in grammatical sentences, and each attribute sits next to the noun it describes. Keyword lists, tag lists, and JSON the user supplies are rewritten as sentences, keeping every field. A complex prompt may use short labeled lines (`Scene:`, `Subject:`, `Text:`, `Keep:`), each a full sentence.
   >
   > If the parent instead adopts [FMT]'s proposed "Never send JSON, YAML, XML, or code", it should drop "Never" or justify the rule as house convention. The 2.5 evidence shows neither gain nor harm from JSON.
5. **L44**: add "a size large enough to read at the output size". Evidence: [FORG] (legibility tracks glyph height; there is a 9 px cap-height floor) and [FAIL] criterion 12.
6. **Review, after L92**: a refusal-retry rule. Evidence: [LUC-G] (3 prompts).
   > - If a benign image of a person is blocked, restate clothing and pose in plain, modest terms and retry once; if it is blocked again, tell the user.
7. **Transparency, after L87**: a fringe-cleanup rule. Evidence: [HAT] (n = 1 per model).
   > - A faint semi-transparent rim around cutouts is normal and prompting does not remove it; for dark backgrounds, clean low-alpha edge pixels locally.

**Stays, with the 2.5 evidence checked**

| Line | Rule | Why it stays |
| --- | --- | --- |
| L8 | Generate right away | No 2.5 evidence bears on it |
| L10 | Prompt used verbatim; size and quality can't be set | Still true on our endpoint [EP]. 2.5's `xhigh`/`max` are not reachable, and `model` is ignored [CX43965] |
| L14–L15 | Purpose first, then subject | Consistent with [IP] and [ATL1] |
| L16 | Coverage; add nothing unimplied | Sunburst adds slogans and objects by itself [LUC-G] [VVR], so the prompt must not add more |
| L17 | Visible terms; no flags or boosters | "8K" and "--ar" are "read as text" [LUC] |
| L18 | Binding | Stays as written unless optional change 4 is adopted |
| L19 | Positive content | An explicit "do not add" still fails 38% of the time [VVR], which supports describing the positive state |
| L20 | Short constraints list, last | Sunburst's unrequested copy [LUC-G] argues for always excluding text, which the rule already does. Long exclusion lists were reported as counterproductive [RREC] |
| L21 | Density | Accuracy falls with constraint count [VVR] |
| L26–L29 | Shape, setting, mood, exact colors | No contrary evidence. Hex in prose scored 5/5 for color [IMGLY] |
| L30 | Several objects, one phrase each | Binding is near ceiling [IB] [VVR]. Counter-prior attributes are handled by change 1 |
| L32 | Placement with an anchor | Pairwise relations pass 95–100%. Order and superlative failures are n = 1 or n = 20 [HAT] [VVR] |
| L33–L34 | Actions; people framing | Full body is the weakest subcategory [IB], which supports "whether the full body shows" |
| L35–L39 | Specialist terms, style, photos, overlay space, sets | Consistent with [LUC-G] (one capture device, physical flaws) and [PF] (consistency) |
| L45–L49 | Spelling, "no other text", diagrams as spec, original logos, icons | No contrary evidence. AA's knowledge-work regression [AA-CAT] supports writing diagrams as a spec. Unrequested real brands [LUC-G] support "original" |
| L54–L75 | References and edit operations | No 2.5 prompt-syntax change found; the edits sibling owns these |
| L78–L80 | Restate constraints; restart after 2–3 edits | Edit-drift evidence conflicts [ATL2] [HAT] [FORG], and the Flare receipt-chain regression [FORG] argues against relaxing these |
| L84–L87 | Transparency | The flag is still required: the word alone produced a painted checkerboard in [ATL2] |
| L91–L97 | Review and iterate | "No seed. Output varies a lot" [LUC-G] and 2/3 pass rates [PF] support "resend once before changing" (L92) |
| L101 | Files | Not affected |

**No Flare- or Sunburst-specific rules.** Our endpoint cannot select the model, and no source documents a model-specific prompt syntax. [EP] [IP]

[FMT]: image-prompt-format.md
[FAIL]: image-prompt-criteria-failures.md
[OAI]: image-prompting-openai.md
[EP]: codex-images-endpoint.md
[IP]: https://developers.openai.com/api/docs/guides/image-prompting
[CXIG]: https://learn.chatgpt.com/docs/image-generation
[CX43965]: https://github.com/openai/codex/issues/43965
[LMA]: https://arena.ai/leaderboard/text-to-image
[LMA-TR]: https://arena.ai/leaderboard/text-to-image/text-rendering
[LMA-CAT]: https://arena.ai/leaderboard/text-to-image/photorealistic
[LMA-E]: https://arena.ai/leaderboard/image-edit
[AA]: https://artificialanalysis.ai/image/leaderboard/text-to-image
[AA-CAT]: https://artificialanalysis.ai/image/leaderboard/text-to-image?category=text-rendering
[AA-E]: https://artificialanalysis.ai/image/leaderboard/editing
[VVR]: https://arxiv.org/html/2609.35641v1
[FORG]: https://arxiv.org/html/2609.13617v2
[IB]: https://imagebench.ai/imagebench-v1
[IB-S]: https://imagebench.ai/imagebench-v1/openai--gpt-image-2.5-sunburst
[IB-F]: https://imagebench.ai/imagebench-v1/openai--gpt-image-2.5-flare
[IB-2]: https://imagebench.ai/imagebench-v1/openai--gpt-image-2
[IB-M]: https://imagebench.ai/methodology-v1
[IMGLY]: https://img.ly/ai-benchmarks/models/gpt-image-2-5-sunburst/
[IMGLY-J]: https://img.ly/ai-benchmarks/prompts/j01-json-scene/
[PF]: https://www.promptfrenzy.com/benchmark/gpt-image-2-5-vs-gpt-image-2
[PF-FB]: https://www.promptfrenzy.com/benchmark/wrong-colour-fruit-bowl
[OW]: https://www.onewave-ai.com/blog/gpt-image-2-5-vs-gpt-image-2-benchmark
[HAT]: https://tech.hatada.jp/apps/en/image-bench/
[LUC]: https://ronaldluc.com/posts/gpt-image-2-5-prompts/
[LUC-G]: https://ronaldluc.com/_pages/gpt-image-2-5-prompts
[OAF25]: https://community.openai.com/t/introducing-gpt-images-2-5-in-the-api-and-chatgpt/1395897
[OAF25-23]: https://community.openai.com/t/introducing-gpt-images-2-5-in-the-api-and-chatgpt/1395897/23
[OAF25-26]: https://community.openai.com/t/introducing-gpt-images-2-5-in-the-api-and-chatgpt/1395897/26
[ATL1]: https://www.reddit.com/r/ChatGPT/comments/1wcatvx/
[ATL2]: https://www.reddit.com/r/ChatGPT/comments/1wcj1ud/
[RCH]: https://www.reddit.com/r/ImagineAiArt/comments/1wdgxsn/
[RUI]: https://www.reddit.com/r/codex/comments/1wb8p1g/
[12UI]: https://12ui.com/gpt-image-2.5-vs-2
[RHC]: https://www.reddit.com/r/AI_UGC_Marketing/comments/1whw258/
[RREC]: https://www.reddit.com/r/PromptEngineering/comments/1wcbfjw/
[RBAD]: https://www.reddit.com/r/ChatGPT/comments/1woxmcy/
[RHOW]: https://www.reddit.com/r/ChatGPT/comments/1wi6tca/
[FEP]: https://arxiv.org/abs/2606.05949
[ONEIG]: https://github.com/OneIG-Bench/OneIG-Benchmark
[TIIF]: https://github.com/A113N-W3I/TIIF-Bench
[LTB]: https://huggingface.co/datasets/X-Omni/LongText-Bench
[IMAGEVAL]: https://justsecret123.github.io/imag-eval-leaderboard.io
[IMAGEVAL-R]: https://github.com/Justsecret123/Imag-Eval
