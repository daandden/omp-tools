# Criteria for edit prompts (gpt-image-2 via `generate_image`)

This extends `docs/research/image-prompting-editing.md` and doesn't repeat it. Source keys:
- **Benchmarks:** [IP2P](https://arxiv.org/abs/2211.09800), [MB](https://arxiv.org/abs/2306.10012) (MagicBrush), [EMU](https://arxiv.org/abs/2311.10089) (Emu Edit), [IMG](https://arxiv.org/abs/2505.20275) (ImgEdit), [GED](https://arxiv.org/abs/2504.17761) (GEdit-Bench), [ANY](https://arxiv.org/abs/2411.15738) (AnyEdit), [KRIS](https://arxiv.org/abs/2505.16707) (KRIS-Bench), [VIE](https://arxiv.org/abs/2312.14867) (VIEScore, the GEdit judge), [OMNI](https://arxiv.org/abs/2506.18871) (OmniContext).
- **Vendor docs:** [OAI](https://developers.openai.com/api/docs/guides/image-prompting), [GEM](https://ai.google.dev/gemini-api/docs/image-generation), [BFL-M](https://docs.bfl.ml/guides/prompting_editing_multi_reference), [BFL-R](https://docs.bfl.ml/guides/usecases_editing_object_removal), [BFL-K](https://docs.bfl.ai/kontext/kontext_image_editing).

Benchmarks score three axes:
- **Following:** GED SC, IMG adherence, KRIS IF, OMNI PF.
- **Preservation:** IMG, KRIS "visual consistency", OMNI, and VIE's over-edit check ("minimally edited yet effective").
- **Realism:** VIE PQ, covering "shadow, lighting, sense of distance".

IMG caps the other two scores at the following score [PRIMARY], so ambiguity costs the most.

## 1. Criteria

### All edits

| Criterion | Priority / trigger | Rationale | Source |
|---|---|---|---|
| Names each operation with an explicit verb: add, remove, replace, change, restyle, translate | MUST | Without task conditioning, models pick the wrong edit type, for example a global edit instead of a texture edit, or a style edit instead of a local one. EMU and ANY fix this with task embeddings or a fixed verb set per task. A prompt only has words. | EMU §4.2, Fig. 4; ANY §B.2.1 [PRIMARY]; transfer [INFERENCE] |
| States the scope: a named object or region, or "the whole image" | MUST | EMU: "Change the sky to be gray" is ambiguous between a global and a local edit. | EMU [PRIMARY] |
| Singles out the target when the image has several candidates, by an attribute or a position | MUST | Multi-instance and camouflaged scenes get their own harder suite in IMG. OAI: "name it explicitly". | IMG UGE suite; OAI [PRIMARY] |
| Describes the end state as visible properties; contains no quality verbs ("improve", "fix", "make better") | MUST | BFL lists these verbs under "Avoid" and asks prompts to be "clear about the target state". | BFL-M [PRIMARY] |
| Has a keep list that names nothing the edit changes | MUST | Preservation and over-editing are scored separately. Keeping "lighting" contradicts a relighting edit. | VIE, IMG [PRIMARY]; contradiction [INFERENCE] |
| One operation per call | SHOULD. Exception: restarting from the original to fold in accepted changes | Errors accumulate across turns. Combined ("hybrid") edits are benchmarked as their own harder category. | MB §4.2; IMG [PRIMARY] |
| Doesn't re-describe content that stays the same, beyond locking critical details | SHOULD | Re-describing invites re-rendering, which VIE penalizes as over-editing. | VIE [PRIMARY]; mechanism [INFERENCE] |
| Gives counts as numbers and positions relative to the frame or a named landmark. A move or swap states where each object ends up. | WHEN-RELEVANT: counting, moving, arranging | Counting and spatial moves are documented failures. Spatial reasoning is KRIS's weakest factual area. | IP2P §Limitations; KRIS §4.2 [PRIMARY] |
| States the visible outcome instead of relying on the model's world knowledge | WHEN-RELEVANT: the request implies an outcome (aging, a reaction, time passing) | All models score lowest on procedural and scientific edits. | KRIS §4.2 [PRIMARY]; mitigation [INFERENCE] |

### By edit type (each row is a MUST when its type applies, unless marked otherwise)

| Criterion | Trigger | Rationale | Source |
|---|---|---|---|
| Names the object and its key attributes, its position relative to an anchor, its approximate size, and how it integrates (lighting, shadow, contact, perspective) | Add | IMG writes the "position … and approximate size" into every instruction because localization is "essential". GEM's template: "Ensure the change is [integration]". | IMG §3.2; GEM [PRIMARY] |
| Says what fills the vacated area, and names nearby objects that must stay | Remove | BFL's removal prompts describe what is revealed. In IMG, one model also removed the neighbouring street light. | BFL-R; IMG §5.2 [PRIMARY] |
| Names the old and the new object. The new object keeps the old one's position, scale, and pose unless the user asks otherwise. | Replace | GEM: "change only the [element] to [new]". | GEM, OAI [PRIMARY] |
| Names the object, the attribute, and a concrete target value: a named or hex color, a material, an expression, an end pose. Lists details on the object that must survive. | Attribute: color, material, tone, motion | Only GPT-4o and ImgEdit-E1 kept the snow on a bike while recoloring it. | GED; IMG §5.2 [PRIMARY] |
| States the direction: restyle image N and keep its composition and identity, or make new content in image N's style and describe the subject in full. Names concrete style properties such as medium, stroke, and palette. Forbids new elements and text. | Style | The docs give separate templates for the two directions. | GEM; OAI sketch-to-render [PRIMARY] |
| Locks the subject (identity, pose, edges), describes the new setting, and says whether the subject is relit to match | Background | Background change is its own category in GED, EMU, and IMG. VIE scores shadows and lighting. | GED, VIE [PRIMARY] |
| Quotes the old and new strings, or names the target language and which text is in scope. Keeps typography and placement; allows no other text. | Text / translation | OAI warns about "words left in the original language". | BFL-K, OAI [PRIMARY] |
| Gives each image a number and a role, and names the base image that sets the framing. For each moved element, gives its source, its destination, and what it must match. Includes one sentence describing the final scene, and locks each subject's identity. | Compose (multi-reference) | OMNI scores consistency per subject. GEM's template ends with "The final image should be a…". BFL-M: "describe the role of each image". | OMNI, GEM, BFL-M, OAI [PRIMARY] |
| Uses the fewest reference images possible | SHOULD for compose | Fidelity drops as references are added, and both Gemini and FLUX cap the number of references. | GEM, BFL-M [PRIMARY]; gpt-image-2 [INFERENCE] |

### Iterative edits (the tool is stateless: no dialogue history is sent)

| Criterion | Priority / trigger | Rationale | Source |
|---|---|---|---|
| Restates every global constraint accepted on earlier turns | MUST on every follow-up | IMG calls this "content memory". Even GPT-4o and Gemini showed only "minimal" content memory. | IMG §3.1, §5.2 [PRIMARY]; tool [INFERENCE] |
| Has no pronouns or elliptical references to earlier turns | MUST on every follow-up | IMG "content understanding": such references get misread. | IMG [PRIMARY] |
| Names the version to go back to and sends that image | MUST for undo or going back | IMG's "version backtracking" worked only within two turns. | IMG [PRIMARY] |
| Restarts from the original once drift appears | SHOULD after 2–3 chained edits | MB: all methods do worse on multi-turn edits "due to error accumulation". EMU needed per-pixel thresholding to control it. | MB §4.2; EMU §4.4 [PRIMARY] |

## 2. Conflicts

- **Line 47 "one change" vs. line 65 "fold all changes into one prompt":** resolved by the one-operation row and its exception.
- **Keep list (line 48 includes lighting) and line 51 "keep framing" vs. tone, relight, or camera edits (GED, ANY):** resolved by the rule that the keep list names nothing the edit changes.
- **Line 25 "describe what fills the frame" vs. removal:** compatible if the fill is described.
- **Line 10 "concrete prompts give higher quality" vs. over-editing:** apply concreteness to the changed element only (VIE).
- **GEM positive phrasing and FLUX's lack of negatives vs. OAI "Do not change anything else":** keep OAI's wording, as the earlier research found.

## 3. Gaps in the current SKILL.md

1. It asks for no operation verb, no scope, and no way to single out one of several similar targets.
2. It has no per-type rules:
   - **Add:** anchor, size, integration.
   - **Remove:** fill, neighbours to keep.
   - **Attribute:** target value, details that survive.
   - **Background:** subject lock, relighting.
   - **Style:** only the case of a style-only reference is covered.
   - **Translation:** which text is in scope.
3. **Compose** lacks the base canvas, the final-scene sentence, and a minimum number of references.
4. **Iteration** lacks restating global constraints, the ban on pronouns that point to earlier turns, and a named version for going back.
5. It has no rule for explicit counts, the end positions of moves and swaps, or the visible outcome of knowledge edits.
6. The ban on quality verbs applies only to new images, not to edits.
