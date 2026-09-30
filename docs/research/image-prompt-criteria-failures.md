# Prompt criteria from T2I failure modes

Scope: failure modes from compositional benchmarks and OpenAI docs, each paired with a prompt property that can be checked before sending. Most benchmark numbers come from older models (SD, Imagen, DALL-E 3). gpt-image-2 has no published per-skill scores, so applying them to it is [INFERENCE]. OpenAI still lists text placement, cross-generation consistency, and precise layout as limitations of current GPT Image models [PRIMARY][IG]. Tags: arXiv papers and OpenAI docs are [PRIMARY]. The mitigation column is [INFERENCE] unless a source is named.

## 1. Criteria

| # | Criterion (checkable) | Priority / trigger | Failure mode and rationale | Source |
|---|---|---|---|---|
| 1 | Every required entity is named in its own noun phrase. Nothing is implied by "etc.", "and more", or a category word. | MUST | *Catastrophic neglect*: subjects get dropped. TIFA reports failures at "composing multiple objects". | [PRIMARY][AE][TIFA] |
| 2 | Each attribute sits next to the noun it modifies. No modifier is shared across nouns. Each attributed object gets its own clause or labeled line. | WHEN ≥2 objects carry attributes | *Attribute leakage/swap* ("pink sunflower, yellow flamingo" comes out swapped). Binding is among the weakest GenEval tasks (best model 35%). Shape binding is hard in T2I-CompBench. | [PRIMARY][SG][GE][CB] |
| 3 | Instances of the same kind are listed one by one, each with its own distinguishing attribute and position. | WHEN same-category instances differ | GenAI-Bench "differentiation" is an advanced skill and scores lower than basic prompts. | [PRIMARY][GB] |
| 4 | A quantity is a numeral with an unambiguous count unit ("pairs" vs. items). Larger counts also get an arrangement (rows, grid, or per-instance positions). | WHEN a quantity matters | Counting fails "even for a small number of objects". In DSG-1k, counting prompts scored lowest with human raters (27–33%). The model has to keep a separate identity for each instance. The "two shoes" vs. "two pairs" ambiguity is documented. An LLM-planned layout about doubles accuracy on numeracy and spatial tasks (LMD; model-side, so its use for prompt wording is [INFERENCE]). | [PRIMARY][GE][DSG][MIC][GB][LMD] |
| 5 | Each spatial relation names both objects (target and anchor), gives a frame region (left third, foreground), and says whose left/right it means. | WHEN placement matters | Spatial is the hardest T2I-CompBench sub-category. Position is at 15% in GenEval. DALL-E 3: "to the left of", "underneath", "behind" are "quite unreliable". OpenAI lists "composition control" as a GPT Image limitation. | [PRIMARY][CB][GE][D3][IG] |
| 6 | Actions state who does what to whom, in the active voice. Multi-person scenes give each person's pose and points of contact. | WHEN an interaction is depicted | Role reversal ("horse eating grass" vs. the reverse) is a known encoder confusion. GPT-4o fails at multi-person and object–human interactions (broken poses, impossible overlaps). | [PRIMARY][VQS][GIE] |
| 7 | Comparisons give the explicit ratio or relative size against a named object. | WHEN a comparison matters | "Comparison" is among the hardest GenAI-Bench skills. | [PRIMARY][GB] |
| 8 | No scene content is specified by negation. Each "no X" or "without X" is rewritten as the positive state. Only artifact classes (text, watermark, logo, checkerboard) go in the closing exclusions. | MUST | In GenAI-Bench, negation is "the most challenging skill", and it is the one skill where DALL-E 3 did not rank best. | [PRIMARY][GB]; exclusion tail per OpenAI (see openai.md) |
| 9 | "Every" or "all" is backed by an explicit count or a restatement per instance. | WHEN universality is required | "Universality" is an advanced GenAI-Bench skill and fails more often. | [PRIMARY][GB] |
| 10 | The distinct concepts per image stay within about 10–20. Beyond that, split into panels or separate images. | SHOULD | OpenAI says GPT-4o handles "up to 10–20" objects and lists "high binding problems" as a limitation. | [PRIMARY][4o] |
| 11 | Every requirement can be checked visually as an atomic yes/no statement about one entity, attribute, or relation. No subjective quality words ("highly detailed"). | MUST | DSG defines faithfulness as a set of atomic propositions. Even human raters disagree on subjective terms. Atomic requirements also become the review checklist. | [PRIMARY][DSG] |
| 12 | Rendered text states its language and script (e.g., simplified vs. traditional). Its size is large enough to read, not dense small print. | WHEN text is rendered | "Multilingual text rendering" and "dense information with small text" are listed 4o limitations. GPT-4o makes Chinese font and script errors. Character-blind encoders misspell (supports letter-by-letter spelling). | [PRIMARY][4o][GIE][CA][D3] |
| 13 | Facts come from the prompt, not the model's memory. Rare species and proper nouns get a visual description, and chart values are written out. | WHEN content depends on specific knowledge or data | DALL-E 3 is "unreliable" for specific terms such as species. "Hallucinations" and "precise graphing" are listed 4o limitations. | [PRIMARY][D3][4o] |
| 14 | In tall or long formats, critical elements are kept away from the edges, with an explicit margin at the bottom. | WHEN a portrait or poster shape is used, or content sits near an edge | 4o "can occasionally crop longer images, like posters, too tightly, especially near the bottom". GPT-ImgEval reports automatic edge cropping. | [PRIMARY][4o][GIE] |
| 15 | Color temperature/white balance and the level of detail are stated whenever the intent differs from warm and hyper-sharp. | WHEN neutral/cool color or blur/low fidelity is intended | GPT-4o shows a warm color bias when color isn't specified, and it over-refines even when blur is requested. | [PRIMARY][GIE] |

## 2. Conflicts

- **"More concrete prompts get higher quality" (SKILL L10, L67) vs. criteria 2–5.** In T2I-CompBench++, rewriting prompts to be three times longer did not improve binding (B-VQA 0.588 → 0.578): "challenges primarily lie in the visual content composition instead of the granularity of prompts" [PRIMARY][CB]. DALL-E 3 found descriptive captions help, mainly by *disambiguating relationships* [PRIMARY][D3]. Added detail should therefore disambiguate structure, not add adjectives.
- **Criterion 10 vs. L10/L67.** Adding detail uses up the concept budget. A retry should restructure or split the prompt, not only lengthen it. [INFERENCE]
- **Criterion 8 vs. L20 and L33.** "No other text" and the exclusion list are negations, and negation is the weakest skill [GB]. They conflict only for scene content. OpenAI's own prompts keep the artifact tail [PRIMARY][IP], so both rules stay, each limited to its own domain.
- **Criterion 15 vs. L23 ("add no … palettes").** Leaving color unstated does not give a neutral result; it gives the model's warm default [GIE]. Stating neutral white balance adds no palette.
- **Criteria 2, 4, 8 vs. L22 ("keep the user's words").** The meaning should be kept, but negations, shared modifiers, and vague counts need rephrasing. [INFERENCE]
- **Criterion 5 vs. openai.md's "never invent left/right placement".** Anchoring relations applies only when the user implied a placement.

## 3. Gaps in current SKILL.md

- Binding, counting, spatial anchoring, action roles, comparison, differentiation, and universality are all missing. Only "labeled lines" (L24) helps indirectly.
- Negation is only partly covered: L25 says it, but there is no rule to rewrite a user's "without X".
- There is no concept budget or rule for splitting overloaded requests.
- There is no atomicity or verifiability rule. The review step (L63) could reuse the prompt's atomic propositions as its checklist.
- Text rules lack script/language and minimum size.
- Nothing warns against relying on world knowledge for rare terms or chart data. L35 covers data only for diagrams.
- Nothing covers bottom-edge cropping in tall formats.
- Nothing covers default biases (warm cast, over-sharpening).
- Images 2.0's "thinking mode" does planning and self-checking [PRIMARY][SC2]. This tool sends prompts verbatim, so the agent has to do that decomposition itself. [INFERENCE]

[CB]: https://arxiv.org/abs/2307.06350
[GE]: https://arxiv.org/abs/2310.11513
[TIFA]: https://arxiv.org/abs/2303.11897
[DSG]: https://arxiv.org/abs/2310.18235
[GB]: https://arxiv.org/abs/2406.13743
[VQS]: https://arxiv.org/abs/2404.01291
[AE]: https://arxiv.org/abs/2301.13826
[SG]: https://arxiv.org/abs/2306.08877
[LMD]: https://arxiv.org/abs/2305.13655
[MIC]: https://arxiv.org/abs/2406.10210
[CA]: https://arxiv.org/abs/2212.10562
[D3]: https://cdn.openai.com/papers/dall-e-3.pdf
[4o]: https://openai.com/index/introducing-4o-image-generation/
[IG]: https://developers.openai.com/api/docs/guides/image-generation#limitations
[IP]: https://developers.openai.com/api/docs/guides/image-prompting
[SC2]: https://deploymentsafety.openai.com/chatgpt-images-2-0/chatgpt-images-2-0.pdf
[GIE]: https://arxiv.org/abs/2504.02782

Notes: I confirmed all seven 4o limitation headings, but the full text only for Cropping; the other captions load dynamically. DPG-Bench ([ELLA](https://arxiv.org/abs/2403.05135), 1K long prompts) shows that dense multi-object prompts degrade CLIP-encoder models, which only weakly supports criterion 10.
