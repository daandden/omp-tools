# Prompt criteria from academic T2I research, filtered for gpt-image-2

Researched 2026-09-30 from full paper text. "Transfer" says whether a finding should hold for gpt-image-2. Most studies test Stable Diffusion, VQGAN+CLIP, DALL-E 3, or GPT-4o/gpt-image-1. No paper tests gpt-image-2, so every transfer claim is [INFERENCE] unless marked otherwise.

## 1. Criteria

| # | Criterion (checkable before sending) | Priority / trigger | Rationale and transfer | Source |
|---|---|---|---|---|
| A1 | The main subject is a concrete, depictable noun phrase, not only an abstraction or mood. | MUST | Abstract subjects often dropped out of the image, and all top-10 subjects were concrete [PRIMARY]. The subject term is the only required modifier [PRIMARY]. It transfers because the result can be checked [INFERENCE]. | [LC] §7.4, [OPP] Table 2 |
| A2 | The prompt describes the subject, its surroundings/background, the style/medium, and the coloration, plus any in-image text: the fields of a descriptive caption. | MUST | DALL-E 3 trained on 95% descriptive captions and must be sampled "exclusively… with highly descriptive captions", upsampled to 15–80 words [PRIMARY]. RECAP agrees [PRIMARY]. In DiffusionDB, very short prompts are over-represented among misaligned SD outputs [PRIMARY]. With no rewriter here, the agent is the upsampler [INFERENCE]. | [D3] §3.5, App. C; [RECAP]; [DDB] §3.5 |
| A3 | Written as grammatical sentences. Every attribute sits syntactically next to the entity it modifies; there are no detached comma-separated keyword runs. | MUST | Attribute binding and object neglect are core failures [PRIMARY]. Models with stronger text encoders (T5, LLM/MLLM) do better at capturing "syntactic dependencies (e.g., modifiers, clauses)" [PRIMARY]. Liu & Chilton found connecting words don't matter, but only for VQGAN+CLIP. That finding does **not** transfer [INFERENCE]. | [AE], [GB] §4, [DM] §4, [LC] §3 |
| A4 | No community "folk" modifiers: no quality boosters (masterpiece, trending, 8k, highly detailed), no repetition for emphasis, no "magic terms", no weights, no artist names used as quality boosters. | MUST | These come from an ethnography of CLIP/SD communities and may be "folk theories" [PRIMARY]. Even on SD, the popular keywords were not the effective ones [PRIMARY]. Manual prompts "often cannot be transferred between various model versions" [PRIMARY]. | [OPP] §4–5, [PU] §4.3, [PR] §1 |
| A5 | Every element the user specified appears in the prompt, and no added element contradicts or replaces one. | MUST | Promptist's reward penalizes losing relevance to the original input [PRIMARY]. DSG's alignment standard, written for evaluation questions, is "All contents of the prompt, and only the contents of the prompt" [PRIMARY]. Applying it to prompt writing is [INFERENCE]. | [PR] §2.2, [DSG] §2 |
| A6 | Each constraint is stated once. Detail goes to scene-level properties (light, style, background) before per-entity micro-attributes. No entity carries a long attribute stack. | SHOULD | On prompts averaging 285 tokens, GPT Image-1's accuracy on attributes, locations, and relations "plateaus around 50%". Accuracy falls as length grows, attributes leak in person-object interactions, and scene attributes are the most reliable [PRIMARY]. Length correlates with ratings only weakly (r = 0.197, LDM) [PRIMARY]. | [DM] §4, App. R; [XIE] §4.3 |
| A7 | Every placement is image-relative (left/right, foreground, top third), each object has exactly one placement, and any placement that goes against real-world convention is stated explicitly. | WHEN placement matters | DALL-E 3 found words like "to the left of", "underneath", and "behind" "quite unreliable" [PRIMARY]. Models pull objects to the center and to their usual real-world positions [PRIMARY]. On GenEval, GPT-4o scores 0.75 on position and 0.61 on attribute binding [PRIMARY]. | [D3] §5.1, [DM] App. R, [GIE] Table 1 |
| A8 | Quantities are numerals attached to one entity type. Each differing instance of the same category gets its own clause with its own attributes. | WHEN counts or differentiated instances | Counting, differentiation, and comparison score below basic skills even for DALL-E 3 (3.4–3.6 vs 4.3 out of 5) [PRIMARY]. | [GB] Table 6, [GE] §3 |
| A9 | Scene content is never specified by negation ("no X", "without Y"). The only exclusions are artifact classes, placed at the end. | MUST | Negation is DALL-E 3's weakest skill (3.0 out of 5 from humans), and it is the one skill where DALL-E 3 isn't preferred over other models. Negation VQAScores stay flat at 0.49–0.52 across all image models [PRIMARY]. This agrees with the vendor advice in `image-prompting-craft.md`. | [GB] Table 6 |
| A10 | Every specialist term (species, cultivar, product model, rare word) comes with its visible traits. | WHEN domain-specific term | DALL-E 3 is "unreliable at generating imagery for specific terms" because its captioner hallucinated or left out species [PRIMARY]. It likely transfers to any model trained on synthetic captions [INFERENCE]. | [D3] §5.3 |
| A11 | The medium and style use precise names (named technique, medium, era, material), not generic words like "art" or "nice style". | SHOULD | Lay prompters wrote descriptive prompts but "lacked style-specific vocabulary" [PRIMARY]. Style modifiers "consistently reproduce a characteristic style" [PRIMARY]. | [OPS], [OPP] §4 |
| A12 | The style fits the subject, or the prompt says how the subject should look in that style. | WHEN style is anachronistic or abstract for the subject | Subject and style interact significantly. Mismatched subjects were dropped ("website" in premodern styles) [PRIMARY]. | [LC] §7.4 |
| A13 | Color temperature/palette and sharpness are stated whenever they matter, including intended blur, softness, or low detail. | SHOULD; MUST when a soft or low-detail look is wanted | GPT-4o drifts toward a warm yellow/orange palette unless told otherwise. It also over-refines, and struggles to produce blurred or low-detail images [PRIMARY]. Whether gpt-image-2 inherits this is unverified [INFERENCE]. | [GIE] §4 |
| A14 | Rendered text is short and in Latin script unless another script is required. Non-English text is flagged for verification. | WHEN non-English text | GPT-4o often makes mistakes in Chinese signage [PRIMARY]. DALL-E 3's text errors come from mapping word tokens to letters [PRIMARY]. | [GIE] §4, [D3] §5.2 |
| A15 | A regenerated prompt is rewritten as one integrated description, not the old prompt with a patch appended. | SHOULD, on text-to-image retries | The DALL-E 3 upsampler rule: "you should not simply make the description longer… refactor the entire description" [PRIMARY]. | [D3] App. C |

## 2. Conflicts

- **A2 vs. A6:** Descriptive prompts win [D3], but constraint load breaks binding [DM]. To meet both, describe few entities richly: spend words on scene-level fields and keep each entity's attribute stack short.
- **A2 vs. A5 / SKILL.md L23:** The DALL-E 3 upsampler invents actors (a raccoon). L23's no-invention rule is right. Upsample with surroundings, light, and palette only.
- **SKILL.md L10/L67** ("more concrete → higher quality"; add detail when quality is `low`): the academic support is weak (r = 0.197, on another model) and length has a ceiling [DM]. Add scene-level detail, not more entities.
- **SKILL.md L24 labeled lines vs. prose captions [D3]:** these are compatible if each line is itself a bound sentence (A3). [DM] supports decomposition.
- **Liu & Chilton vs. A3:** their result comes from a CLIP-guided model. Follow A3.

## 3. Gaps in the current SKILL.md

- Nothing is said about hard skills: counts, relative position, differentiated instances (A7, A8). Review should also check these first.
- There is no binding rule (A3), no de-duplication or density ceiling (A6), and no pre-send coverage check (A5).
- There is no rule to describe specialist terms by their traits (A10), and no subject–style fit check (A12).
- L26–27 miss repetition-for-emphasis and artist names used as quality boosters (A4).
- Nothing addresses default biases: warm cast, over-sharpening (A13). Nothing covers non-Latin text (A14).
- There is no integrated rewrite for new-image retries (A15); L64 covers edits only.
- There is no re-sampling step. Quality varies significantly by seed [LC] §4, and best-of-N lifts DALL-E 3 alignment by about 0.3/5 [GB] §5. On a hard-skill miss, resend the same prompt once before rewriting it [INFERENCE].

[LC]: https://arxiv.org/abs/2109.06977
[OPP]: https://arxiv.org/abs/2204.13988
[OPS]: https://arxiv.org/abs/2303.13534
[PR]: https://arxiv.org/abs/2212.09611
[PU]: https://arxiv.org/abs/2209.11711
[DDB]: https://arxiv.org/abs/2210.14896
[XIE]: https://arxiv.org/abs/2303.04587
[D3]: https://cdn.openai.com/papers/dall-e-3.pdf
[RECAP]: https://arxiv.org/abs/2310.16656
[AE]: https://arxiv.org/abs/2301.13826
[GE]: https://arxiv.org/abs/2310.11513
[GB]: https://arxiv.org/abs/2406.13743
[DSG]: https://arxiv.org/abs/2310.18235
[DM]: https://arxiv.org/abs/2505.16915
[GIE]: https://arxiv.org/abs/2504.02782
