# Prompt completeness criteria from vendor guidance

Builds on `docs/research/image-prompting-{openai,editing,craft}.md`. Codex counts come from parsing all 36 labeled samples in [CX-SP]. All rows are [PRIMARY] unless marked.

## 1. Criteria

**Fields by vendor: core vs optional, and stated order**
| Vendor | Core | Optional | Order |
|---|---|---|---|
| OpenAI [OAI-P] [CB2] | intended use, subject, composition + aspect ratio, constraints | medium, materials, light, color, pose, text | Guide: "Start with the image you need, then … subject, composition, style, and constraints". Cookbook: scene → subject → details → constraints |
| Codex [CX-S] [CX-P] [CX-SP] | Use case, Primary request, Constraints (36/36); Input images (8/8 edits) | Style 29, Composition 27, Asset type 19, Subject 18, Scene 14, Lighting 9, Text 6, Palette 6, Materials 2 | Use case first. Constraints is the last line in 35/36. Edits declare inputs before the request in 8/8; 7 of the 8 are 4 lines long |
| Google [NBP] [GEM] | subject, composition, action, location, style; purpose | aspect ratio, camera/light, text, factual constraints, reference roles | Templates: type/style → subject → setting → light → camera → ratio |
| Imagen [IMG] | subject, context, style | photo and quality modifiers, text | Starts with the style; ratio at the end |
| BFL FLUX [BFL2] [BFL-B] | subject, action (+style, context) | camera, light, colors, effect ("You do not need every slot") | subject → action → style → context → secondary; "pays more attention to what comes first" |

**Criteria (each is a checkable property of the prompt)**
| # | Criterion | Priority / trigger | Rationale | Source |
|---|---|---|---|---|
| 1 | Names the main subject and what distinguishes it | MUST | Every vendor requires this field | all |
| 2 | Names the image type or medium | MUST | Core for Google, Imagen, and BFL; codex Style 29/36 | [NBP] [IMG] [BFL-B] [CX-SP] |
| 3 | States the intended use or audience | MUST | Use case 36/36; "Define the result"; "context and intent" | [OAI-P] [GEM] [CX-SP] |
| 4 | Includes every element the user specified; adds no subjects, props, brands, slogans, palettes, or left/right placement the user didn't imply | MUST | Primary request 36/36; codex's list of augmentations it doesn't allow | [CX-S] |
| 5 | Ends with a constraints clause (invariants, artifact exclusions) | MUST | Last line in 35/36; closing lines of OpenAI examples | [CX-SP] [OAI-P] |
| 6 | Describes scene content positively; "no …" appears only in the constraints clause, for artifacts (text, watermark, logo, checkerboard) or invariants | MUST | FLUX has no negatives; Google uses "semantic negatives"; OpenAI puts "No…" at the end | [BFL2] [GEM] [OAI-P] |
| 7 | States the action or state of any animate subject | SHOULD | Core for BFL and Google | [BFL2] [NBP] |
| 8 | States the setting, or says the subject is isolated | SHOULD | Core for Imagen and Google | [IMG] [NBP] |
| 9 | States framing and viewpoint | SHOULD | Codex 27/36; core for Google | [CX-SP] [NBP] |
| 10 | A new image states its orientation/ratio in words, with a composition that fits; an edit says to keep the framing | SHOULD | "Specify … aspect ratio"; "keep the base framing unchanged" | [OAI-P] [GEM] [CX-P] |
| 11 | Every modifier names a visible property, with no bare evaluative or quality words | SHOULD | "Specific detail helps. Filler hurts."; quality levers "only when needed" | [BFL-B] [CB2] |
| 12 | The first sentence contains the most critical requirement | SHOULD | BFL gives early words more weight | [BFL2]; transfer [INFERENCE] |
| 13 | Uses labeled lines, steps, or panels | WHEN there are ≥3 elements, panels, or data points | "labeled sections"; "step-by-step" | [OAI-P] [GEM] |
| 14 | Contains the word "photorealistic" plus real texture | WHEN a photo look is wanted | Turns on the photoreal mode | [CB2] |
| 15 | Gives body framing, scale, gaze, and object interaction | WHEN people appear | Fixes pose and proportion | [OAI-P] [CB2] |
| 16 | Quotes every string verbatim, with its count, typography, placement, and "no other text" | WHEN text is rendered | All four vendors | [OAI-P] [NBP] [BFL2] [IMG] |
| 17 | Gives the real labels and data, lists the required components, and names what to exclude | WHEN the output is a diagram, chart, slide, or UI | "list the required components explicitly"; "ensure your inputs themselves are factual" | [OAI-P] [NBP] |
| 18 | States the place and date/era | WHEN the scene is historical or a real event | "Name the place and date" | [OAI-P] |
| 19 | Says "original, non-infringing, no trademarks" | WHEN the output is a logo, brand, mascot, character, or merchandise | Appears in 4 OpenAI examples | [OAI-P] |
| 20 | Declares every image's number and role before the instruction | WHEN references are passed | 8/8 codex edits; Google and BFL ask for each image's role | [CX-SP] [NBP] [BFL2] |
| 21 | Gives one "change only X" plus a keep list, and doesn't re-describe the scene | WHEN editing | Codex edits are 4 lines; OpenAI edits are short | [CX-SP] [OAI-P] |
| 22 | Repeats the same trait block word for word | WHEN a character or product recurs across images | OpenAI "Character Consistency" block | [OAI-P] |
| 23 | Pairs each hex code with an object and a color name | WHEN exact colors are required | "associate hex codes with specific objects" | [BFL2]; transfer [INFERENCE] |

## 2. Conflicts

- **Intent position:** OpenAI's guide, the codex schema, and SKILL.md put it first; codex prompting.md puts "output intent" last. Keep it first: the guide is newer, and 36/36 samples start with Use case [INFERENCE].
- **Scene vs subject:** the OpenAI cookbook and codex put the scene first; BFL, Google, Imagen, and the newest OpenAI overview put the subject first. SKILL.md follows subject-first. No source shows that the order matters for gpt-image [INFERENCE].
- **Negatives:** BFL has no negative prompts. Imagen's separate negative field lists the unwanted items without "no". OpenAI closes prompts with "No…". #6 reconciles these, and SKILL.md already agrees.
- **Amount of detail:** Gemini says "hyper-specific"; codex says "Keep it short"; BFL says "Start short". SKILL.md line 10 ("more concrete prompts get higher quality") has no stopping rule; #11 supplies one.
- **Quality words and camera specs:** Imagen recommends "4K, HDR". BFL favors naming a camera model. OpenAI treats camera specs as "cues … not a guarantee". SKILL.md's ban on buzzwords matches OpenAI.
- **Medium:** SKILL.md step 3 groups medium with lighting, palette, and materials. Every vendor treats medium/style as core and lighting/palette as optional (#2 vs #11).
- **Position of the shape:** OpenAI states it early, Google last, SKILL.md fourth. Only its presence is checkable (#10).

## 3. Gaps in the current SKILL.md

- No mandatory/optional split: the ordered steps read as a full template, but vendors separate core fields from refinements (codex: "use only the lines that help").
- No originality/non-infringing constraint (#19).
- No factual-input check and no historical place/date (#17, #18).
- No people fields: framing, gaze, interaction (#15).
- Doesn't say to declare references before the instruction (#20), or that edits shouldn't re-describe the scene (#21).
- No rule to put the critical requirement first (#12). No guidance on color codes (#23).
- The review checks only the output. OpenAI's "Check the result" items (text, identity, only-the-requested-change, alpha) have no matching check before sending.

[OAI-P]: https://developers.openai.com/api/docs/guides/image-prompting
[CB2]: https://github.com/openai/openai-cookbook/blob/2182005bcaf5a5cdd96bb46fb9995d08730e7b91/examples/multimodal/image-gen-models-prompting-guide.ipynb
[CX-S]: https://github.com/openai/codex/blob/d42056091aded7feb1d88ac7e83972108b2aa478/codex-rs/skills/src/assets/samples/imagegen/SKILL.md
[CX-P]: https://github.com/openai/codex/blob/d42056091aded7feb1d88ac7e83972108b2aa478/codex-rs/skills/src/assets/samples/imagegen/references/prompting.md
[CX-SP]: https://github.com/openai/codex/blob/d42056091aded7feb1d88ac7e83972108b2aa478/codex-rs/skills/src/assets/samples/imagegen/references/sample-prompts.md
[GEM]: https://ai.google.dev/gemini-api/docs/image-generation
[NBP]: https://blog.google/products-and-platforms/products/gemini/prompting-tips-nano-banana-pro/
[IMG]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/image/img-gen-prompt-guide
[BFL2]: https://docs.bfl.ai/guides/prompting_guide_flux2
[BFL-B]: https://docs.bfl.ai/guides/prompting_unified_building
