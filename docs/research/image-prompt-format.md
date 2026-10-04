# Prompt format for image models: prose, labeled lines, tags, or JSON

Researched on 2026-09-30. This note extends [image-prompting-openai.md](image-prompting-openai.md) L22–24, [image-prompting-craft.md](image-prompting-craft.md) L9 and L13, [image-prompt-criteria-academic.md](image-prompt-criteria-academic.md) A3, and [image-prompt-criteria-vendor.md](image-prompt-criteria-vendor.md) #13, without repeating them. Cookbook pinned at `2182005b`, `openai/codex` at `d4205609`. No images were generated. One published OpenAI sample output was inspected.

## Bottom line

- **gpt-image-2: write plain sentences. For complex prompts, use short labeled lines where each line is itself a sentence.** OpenAI says any format "can all work well". Every prompt OpenAI and Codex publish is prose or labeled lines, and none is JSON. [PRIMARY] [CB2] [IP] [SKS]
- **Format barely moves strong LLM-based models. Information does.** The only large content-matched test found (FEPBench, 1,300 prompts) turned free-form prompts into labeled sections. For GPT Image 2, faithfulness moved by +0.003 and precision fell by 0.026. [PRIMARY] [FEP] The best-controlled training study finds that "at matched information both land on one fit". [PRIMARY] [SCALE]
- **Default to prose or labeled sentences for gpt-image-2; JSON has no demonstrated advantage there, and no demonstrated harm.** OpenAI explicitly allows "JSON-like structures" [PRIMARY] [CB2] [IP], and no content-matched JSON-vs-prose test exists for gpt-image-2. A plausible risk, untested on gpt-image-2: JSON quotes every value, and quotes are the signal this skill, OpenAI, and other vendors use for "render this text". JSON and code text leaking into images is reported only for other models. [INFERENCE] [SECONDARY]
- **JSON is worth it in three cases.**
  - The model was trained on JSON captions: Ideogram 4 and Bria FIBO.
  - A FLUX.2 pipeline is automated; BFL supports JSON there and calls both formats equal.
  - As an authoring or template format on the agent's side, flattened into sentences before sending. [PRIMARY] [IDEO4] [FIBO] [BFL-JSON] [INFERENCE]
- **Tag lists: still rewrite them as sentences for gpt-image-2**, even though OpenAI says tags "can all work well". Sentences keep each attribute bound to its noun (academic note A3). Tag habits come from CLIP-era encoders, which behave like bags of words [PRIMARY] [ARO], and gpt-image probably does not use them [INFERENCE].

## 1. Cited findings

**OpenAI: what the docs say about format**
- The gpt-image-2 cookbook adds a bullet that the 1.5 guide lacks: "Use the format that is easiest to maintain. Minimal prompts, descriptive paragraphs, JSON-like structures, instruction-style prompts, and tag-based prompts can all work well as long as the intent and constraints are clear. For production systems, prioritize a skimmable template over clever prompt syntax." [PRIMARY] [CB2] [CB15]
- The current API guide, now titled for GPT Image 2.5, says: "Short prompts, descriptive paragraphs, JSON-like structures, instructions, and tags can all express the same intent. Choose the format that makes the requirements easiest to read and update rather than relying on special syntax." It also says: "For complex requests, organize the prompt as scene, subject, details, and constraints, using labeled sections." [PRIMARY] [IP]
- Codex skill: "Reformat user prompts into a structured, production-oriented spec", and "Treat this as prompt-shaping guidance, not a closed schema. Use only the lines that help". [PRIMARY] [SK] All 36 recipes in `sample-prompts.md` are labeled lines (`Use case:` … `Avoid:`). None is JSON, and the file has no `{`. "The labeled lines are prompt scaffolding, not a closed schema." [PRIMARY] [SKS]
- No OpenAI guide, cookbook notebook (prompting, 1.5, transparent assets, evals, GPT Image intro), or Codex sample uses a JSON prompt, although the docs say JSON "can work". [PRIMARY] [CB2] [IP] [SKS]
- **Labels did not leak in OpenAI's own sample.** The cookbook's toy-airplane prompt uses the sections `Concept:`, `Style:`, `Constraints:` (with `-` bullets) and `Include ONLY this packaging text (verbatim):`. The published gpt-image-2 output renders only "Christmas Memories Edition"; no label text appears. [PRIMARY] [CB2] [CB2-IMG] This is one sample chosen by the vendor, not a test.

**OpenAI: does an LLM read or rewrite the prompt?**
- The model lineage is a language model. gpt-image-1 "is a natively multimodal language model that accepts both text and image inputs, and produces image outputs." [PRIMARY] [M1] For 4o: "Unlike DALL·E, which operates as a diffusion model, 4o image generation is an autoregressive model natively embedded within ChatGPT." [PRIMARY] [4OSC] Also: "The tighter binding of objects to their traits and relations allows for better control." [PRIMARY] [4O]
- Neither the gpt-image-2 model page nor the Images 2.0 system card describes the architecture. [PRIMARY] [M2] [I2SC] If it shares the lineage, a language model parses the prompt, so any readable syntax gets understood, and gains have to come from content [INFERENCE].
- Rewriting is documented only above the model:
  - The Responses tool: "the mainline model (for example, `gpt-5.5`) will automatically revise your prompt for improved performance." [PRIMARY] [IG]
  - ChatGPT thinking mode uses "our reasoning stack to turn a basic prompt into a well-researched and thought-through final image." [PRIMARY] [I2SC]
  - The Images API returns `revised_prompt` "For `dall-e-3` only". [PRIMARY] [IAR]
- Codex records its own argument as `revised_prompt`. [PRIMARY] [EP] So on our endpoint the agent's exact syntax reaches gpt-image-2 [INFERENCE]. Community JSON-vs-prose tests run through ChatGPT or Gemini chat may measure a rewriter, not the model [INFERENCE].
- Budget: the prompt can be up to "32000 characters for the GPT image models". [PRIMARY] [IAR] The characters JSON spends on syntax don't matter at this size [INFERENCE].
- DALL·E 3 is the general rule behind format advice. It used a T5-XXL encoder and 95% descriptive prose captions. "Likelihood models like our text-to-image diffusion models have a notorious tendency to overfit to distributional regularities in the dataset", so "we will need to exclusively sample from them with highly descriptive captions." [PRIMARY] [D3] The right format is whatever matches the training captions, and OpenAI has never said its GPT image models were trained on JSON [INFERENCE].

**Other vendors**
- **FLUX.2 (BFL): JSON is supported, and no training claim is made.** "For complex scenes and production workflows, FLUX.2 interprets structured JSON prompts". Use JSON for "Automation and programmatic generation" and "When you need to iterate on specific elements independently". Also: "FLUX.2 understands both formats equally well—choose based on your workflow needs." and "You can include the JSON directly in your prompt, or flatten it into natural language." [PRIMARY] [BFL-JSON]
  - BFL's own upsampler: "Keep structured inputs structured (enhance within fields). Convert natural language to detailed paragraphs." and "Put ALL text in quotation marks". [PRIMARY] [BFL-SYS]
  - The official comic example uses inline labels ("Style: Classic superhero comic Character: Worried scientist…"). [PRIMARY] [BFL2]
  - The encoder is "the Mistral-3 24B parameter vision-language model" [PRIMARY] [BFL-BLOG]. The open-weights code has `MAX_LENGTH = 512` [PRIMARY] [BFL-TE].
- **Ideogram 4 needs JSON.** "Ideogram 4 is trained exclusively on structured JSON captions (represented as string type)." For the open weights: "Passing in plain-text prompts directly to the model will not work and will likely trigger a safety warning." And: "The model was trained on JSON with a consistent key order, so maintaining it improves generation quality." [PRIMARY] [IDEO4]
  - The hosted docs soften this ("Natural language prompts still work well") because Magic Prompt converts plain text to JSON. [PRIMARY] [IDEO-J]
  - Encoder: "Instead of a text-only encoder like CLIP or T5, Ideogram 4 uses Qwen3-VL-8B-Instruct". [PRIMARY] [IDEO4-R]
  - Ideogram 2/3 are plain text, "under approximately 150 words (around 200 tokens)". [PRIMARY] [IDEO]
- **Bria FIBO is JSON-native.** "FIBO is the first open-source, JSON-native text-to-image model trained exclusively on long structured captions." [PRIMARY] [FIBO] The captions "are long, structured JSONs generated by Gemini 2.5". The paper also says: "Since users may struggle to author such lengthy prompts, we employ a vision–language model (VLM) to bridge natural human intent and structured prompts". [PRIMARY] [FIBO-P]
- **Google (Gemini image / Nano Banana): narrative prose.** "A narrative, descriptive paragraph will almost always produce a better, more coherent image than a simple list of disconnected words." The model "was trained from the ground up to process text and images in a single, unified step." [PRIMARY] [GBLOG] For many elements: "Use step-by-step instructions" [PRIMARY] [GEM]. The Cloud guide says "A simple list of keywords won't cut it; you need to describe the scene narratively", yet its formula is labeled: `[Subject] + [Action] + [Location/context] + [Composition] + [Style]` [PRIMARY] [GCLOUD]. No Google page checked mentions JSON prompts [INFERENCE].
- **Qwen-Image: prose captions inside a JSON wrapper.** The annotator emits JSON metadata, but the caption itself follows "Write the caption using natural, descriptive text without structured formats or rich text." The encoder is Qwen2.5-VL. [PRIMARY] [QWEN]
- **HunyuanImage 3.0: structured schema, variable captions.** Captions come from a structured schema: "we strategically sample and combine different fields to generate captions varying in both length and pattern". The final serialization is not stated. [PRIMARY] [HY3]
- **Seedream 4.x: coherent prose.** "Use coherent natural language to describe the subject + action + environment", and "using concise and precise prompts is usually better than repeatedly stacking ornate and complex vocabulary". One example is labeled inside prose: "Top shelf: On the left, there is a carton of milk…". [PRIMARY] [SEED]
- **Recraft: structure is for control, not quality.** "Structured prompts don’t make results “better.”They make outcomes intentional, controllable, and repeatable." Here "structured" means prose ordered from global to local, not JSON. [PRIMARY] [RECRAFT]
- **Runway: sentences plus optional keywords.** "Prompts do not need to follow a specific structure in most cases to receive quality outputs, but we recommend prompting with full sentences for more control over certain elements and appending additional keywords in cases where more variation is welcomed." [PRIMARY] [RUNWAY]
- **SD3: T5 matters only for complex prompts.** "Only for complex prompts involving either highly detailed descriptions of a scene or larger amounts of written text do we find significant performance gains when using all three text-encoders." [PRIMARY] [SD3]
- **Training-caption trend: more models train on structure without asking users to write it.**
  - NVIDIA Cosmos 3 switched to JSON annotation because "free-form captions are often precise but incomplete: they tend to describe visible content accurately, yet omit important details in complex scenes". This was measured on caption recall, not image quality. [PRIMARY] [COSMOS]
  - ERNIE-Image trains on keyword, request, instruction, and spec-style rewrites; "This prompt diversification step improves robustness to heterogeneous user expressions". [PRIMARY] [ERNIE]

**Academic and empirical evidence**
- **FEPBench is the only large, content-matched inference-time comparison.** Expert free-form prompts were converted by GPT-5.4 into labeled-section bullets, "explicitly instructed to preserve the original meaning". Setup: 1,300 science illustrations, 9 models, MLLM judge. [PRIMARY] [FEP] Overall scores, free-form → structured:

  | Model | Faithfulness (IF) | Precision (SP) |
  | --- | --- | --- |
  | GPT Image 2 | .663 → .666 | .716 → .690 |
  | GPT Image 1.5 | .595 → .602 | .688 → .699 |
  | Nano Banana Pro | .638 → .620 | .713 → .752 |
  | FLUX.2 [dev] | .515 → .547 | .668 → .642 |
  | HunyuanImage-3.0 | .358 → .461 | .605 → .621 |

  The paper concludes that closed-source models are "more robust to prompt format", and that structured prompts "can reduce SP by encouraging additional, unsupported details. Thus, prompt rewriting is not a universal improvement strategy". Caveats: no significance test, the LLM conversion itself can add explicitness, one domain, and labeled bullets rather than JSON.
- **At matched information, structure and prose tie.** In the best-controlled training study (15 caption configurations, separate diffusers at the same budget), "prose saturates in information while structure keeps gaining (top), yet at matched information both land on one fit (bottom)". The authors add that the comparison "tests richer content and organization jointly rather than JSON syntax in isolation". At inference, "Naively increasing prompt length degrades performance across all evaluated open-weight models (Qwen-Image, HunyuanImage 3.0, BAGEL, FLUX.1 Dev, and Emu3)". Their JSON system wins (72.5 vs 56.2 GenEval2 GM against a matched NL retrain), but only for a diffuser trained on that JSON. [PRIMARY] [SCALE]
- **Strong models ignore surface form (length).** "Top-performing models demonstrate strong robustness to variations in prompt length, producing consistent results for both short and long versions of semantically equivalent prompts." This tests length, not format. [PRIMARY] [TIIF]
- **Mismatched format hurts JSON-trained models.** For Ideogram 4, "text legibility, near-zero when the model is prompted with raw strings, reaches 55% OCR exact-match under the JSON captions it expects." The format change is confounded with LLM expansion. [PRIMARY] [ID4Q]
- **Consistent order helps a little at training time.** "structured versions consistently yield higher text-image alignment scores" came from fixed-order vs shuffled captions on PixArt-Σ and SD2. The gains were ≤0.02 VQA, with no significance test. [PRIMARY] [RELAION]
- **Weak evidence for labeled lines improving consistency.** SCHEMA (Gemini 3 Pro Image) found labeled lines gave 8–9/10 batch consistency vs 3.5–5/10 for narrative prompts with the "Same informational content". The paper itself says: "The compliance rates are based on direct practitioner assessment during operational sessions, not on automated quantitative measurement". It had one author, unblinded raters, and measured consistency, not adherence. [PRIMARY] [SCHEMA]
- **Capability only.** IMAGINE-E's Json2Image has no prose control. It notes that "Midjourney, which cannot process this format". [PRIMARY] [IMAGINE]
- **Structure helps LLM planners, not image encoders.** LayoutGPT and LLM-grounded Diffusion have an LLM emit structured layouts (CSS, captioned boxes) for a layout-conditioned diffuser. [PRIMARY] [LAYOUTGPT] [LMD] This supports planning structure on the agent's side, not sending it to gpt-image [INFERENCE].
- **No rigorous JSON-vs-prose test on gpt-image-1/2 was found.** [INFERENCE]

**Community tests [SECONDARY]**
- Chase Jarvis converted one scene between JSON and prose with Gemini, then ran "both the JSON prompt and the Natural Language prompt twice each in Gemini/Nano Banana Pro". Verdict: "these images all look essentially the same"; "Skip the JSON. It’s a placebo." [SECONDARY] [CJ] Rigor: n = 1 scene × 2 samples, eyeballed, not blind.
- Z-Image users on Reddit: "sometimes it puts some elements of the JSON as text into the image"; "Removing the JSON formatting and typing out just the text in the prompt gives you roughly the same image." [SECONDARY] [RZ1] [RZ2] These are anecdotes with no protocol. The quotes were captured in a headless browser because Reddit blocks plain fetches.
- Max Woolf rendered a webpage from HTML/CSS/JS in a Nano Banana prompt and saw "leaked classes/styles/JavaScript variables". For character attributes he used a prose instruction that wraps JSON: "The photo MUST accurately include and display all of the person's attributes from this JSON". [SECONDARY] [MW] n = 1 per demo, with no prose control.
- DALL·E 3 forum bug list: "DALL-E inserts the prompt into the image". [SECONDARY] [OAF]
- No report was found of gpt-image-1/2 rendering JSON keys, braces, or labels as text. [INFERENCE]

## 2. Mechanism

**Why JSON might help**
- **Explicit binding:** each field keeps an attribute next to its entity. A bound sentence does the same; see the academic note, A3 [INFERENCE].
- **Fewer omissions:** fixed fields force coverage [PRIMARY] [COSMOS]. For an agent, a checklist gives the same benefit without sending JSON [INFERENCE].
- **Templates and programmatic edits:** BFL recommends JSON "When you need to iterate on specific elements independently" [PRIMARY] [BFL-JSON].
- **Training match:** JSON helps when the model was trained on JSON (Ideogram 4, FIBO) [PRIMARY] [IDEO4] [FIBO].

**Why JSON might hurt**
- **Encoder truncation and lost layout (CLIP and T5 models only).**
  - CLIP stops at 77 tokens, and "the true effective length of CLIP is no more than 20 tokens" [PRIMARY] [LCLIP].
  - CLIP's tokenizer runs `text = re.sub(r'\s+', ' ', text)`, so newlines and indentation vanish [PRIMARY] [CLIPTOK].
  - FLUX.1 loads CLIP with `max_length=77` and T5 with `max_length: int = 512` [PRIMARY] [FLUX1].
  - T5's vocabulary has no piece containing `{` or `}` (unk_id 2) and uses a `WhitespaceSplit` pre-tokenizer [PRIMARY] [T5TOK]. JSON braces and line structure therefore reach SD3 and FLUX.1 as unknown tokens and spaces [INFERENCE].
  - None of this applies to gpt-image-2's 32,000-character, LLM-read prompt [INFERENCE].
- **Quotes as a render signal:** OpenAI says "Put required wording in quotes" [PRIMARY] [IP]. FLUX.2 says "Put ALL text in quotation marks" [PRIMARY] [BFL-SYS]. Z-Image's enhancer requires double quotes around text to render "以此作为明确的生成指令" ("as an explicit generation instruction") [PRIMARY] [ZPE]. JSON quotes every value, which blurs this signal; that is a plausible cause of the reported leaks [INFERENCE] [RZ1].
- **Weaker relations:** a field like `"position": "left"` has no anchor object. The skill's placement rule (object + anchor + whose left) needs a phrase [INFERENCE]. The one study that tested verbal and coordinate spatial variants found they "follow the same relations" [PRIMARY] [SCALE].
- **Invented detail:** structured rewrites "can reduce SP by encouraging additional, unsupported details" [PRIMARY] [FEP]. A schema with empty fields invites filling every field, which conflicts with the skill's no-invention rule [INFERENCE].

## 3. Per-model summary

| Model | Encoder / caption training | Official stance on JSON | Recommended format |
| --- | --- | --- | --- |
| **gpt-image-2** (also 1.5, 2.5) | Not published for 2. gpt-image-1 is a "natively multimodal language model"; 4o is autoregressive [M1] [4OSC] | "can all work well"; no JSON example anywhere [CB2] [IP] | Sentences; labeled sections for complex requests [IP] [SK] |
| DALL·E 3 | T5-XXL; 95% descriptive prose captions [D3] | Not stated; format must match training [D3] | Descriptive prose (GPT-4 upsampled) [D3] |
| FLUX.2 pro/dev | Mistral Small 3.2 24B VLM; 512-token cap in open-weights code; caption format not stated [BFL-BLOG] [BFL-TE] | Supported; "understands both formats equally well" [BFL-JSON] | Prose with the key content first; JSON for automation or multi-subject scenes [BFL2] [BFL-JSON] |
| FLUX.1 | T5-XXL (512) + CLIP-L (77) [FLUX1] | Not stated | "FLUX works best when your prompt reads like a clear description of the image you want to generate." [BFL-B] |
| Ideogram 2/3 | Not stated | n/a | Plain prose under ~150 words [IDEO] |
| Ideogram 4 | Qwen3-VL-8B; trained exclusively on JSON captions [IDEO4-R] [IDEO4] | Required on open weights; the hosted product converts via Magic Prompt [IDEO4] [IDEO-J] | JSON schema in fixed key order |
| Bria FIBO | LLM encoder; 1,000+-word JSON captions from Gemini 2.5 [FIBO-P] | JSON-native; a VLM expands short prompts [FIBO] [FIBO-P] | JSON |
| Gemini image (Nano Banana) | Native multimodal, "single, unified step"; captions not stated [GBLOG] | Not stated on any page checked | Narrative paragraph; step-by-step for complex scenes [GBLOG] [GEM] |
| Imagen 3 | Original plus Gemini synthetic captions [IMAGEN3] | Not stated | Descriptive prose [IMG] |
| Midjourney | Not stated | Not stated; "cannot process this format" per [IMAGINE] | Short phrases [MJ] |
| SD3 / 3.5 | CLIP-L + bigG + T5-XXL; T5 matters for complex prompts [SD3] | Not stated | Not stated officially; keep within encoder limits [INFERENCE] |
| Qwen-Image | Qwen2.5-VL; prose captions, JSON only as a metadata wrapper [QWEN] | Not stated | Prose |
| Seedream 4.x | Not stated | Not stated | Coherent prose; labeled sub-parts in examples [SEED] |
| HunyuanImage 3.0 | Field schema combined into captions of varied length and pattern [HY3] | Not stated | Not stated |
| Recraft V4 | Not stated | Not stated; "structured" = ordered prose [RECRAFT] | Ordered prose |
| Runway Gen-4 Image | Not stated | Not stated | Full sentences plus appended keywords [RUNWAY] |
| Adobe Firefly | Not stated | Not stated | Subject, descriptors, keywords [FF] |

Pattern: vendors recommend JSON only when they trained on JSON (Ideogram 4, FIBO). Everyone else recommends prose, and several still show labeled segments inside it (BFL, Google Cloud, Seedream, OpenAI) [INFERENCE].

## 4. Contradictions and open questions

- **Correction to craft.md L13:** it says "FLUX.2 and Ideogram 4 were trained on JSON captions". Only Ideogram 4 is confirmed. BFL says FLUX.2 "interprets" JSON and "understands both formats equally well", and makes no claim about training captions. [PRIMARY] [BFL-JSON] [IDEO4]
- **OpenAI "tags can work" vs. the skill's rewrite-to-sentences rule:** OpenAI offers no evidence. The binding research favors sentences (academic note A3; [ARO]), and sentences cost nothing. Keep the rule [INFERENCE].
- **OpenAI "labeled sections for complex requests" vs. FEPBench:** for GPT Image 2, labeled sections left faithfulness unchanged and cut precision by 0.026. Use labels to make a prompt easier to scan and check, not to improve quality, and write each line as a bound sentence [PRIMARY] [FEP] [INFERENCE].
- **SCHEMA vs. FEPBench:** labeled lines greatly improved consistency in one weak study but did not change faithfulness in one strong study. The metrics differ, so both can be true [INFERENCE].
- **Ideogram 4:** the open-weights docs say plain text "will not work", while the hosted docs say it "still work[s] well". The difference is Magic Prompt [PRIMARY] [IDEO4] [IDEO-J].
- **Open questions:**
  - No content-matched JSON-vs-prose test exists for gpt-image-2.
  - It is untested whether gpt-image-2 renders quoted JSON values as text.
  - No study compares formats for **edit** prompts.
  - It is unknown whether the Codex backend rewrites prompts in a way the client can't see.
  - FEPBench's precision drop may come from the GPT-5.4 conversion rather than from the format.

## 5. Recommendation for `skills/generate-image/SKILL.md`

The current guidance is right and needs only a small tightening. "Binding" (L18) already requires grammatical sentences and rewrites keyword lists. "Density" (L21) already allows labeled lines for crowded requests. Two gaps remain:
- Nothing tells the agent what to do when a user asks for "a JSON prompt" or pastes one. Flattening it into sentences is the conservative default, because every OpenAI example is prose or labeled lines; the evidence does not show that sending JSON hurts.
- Nothing says labeled lines must be sentences, or reserves quotation marks for rendered text.

Suggested replacement for L18:

> - **Binding and format**: the prompt is plain text in grammatical sentences, and each attribute sits next to the noun it describes. Keyword lists are rewritten as sentences. A complex prompt may use short labeled lines (`Scene:`, `Subject:`, `Text:`, `Keep:`), each one a full sentence. JSON, YAML, or XML a user supplies is carried over field by field into sentences by default; OpenAI permits JSON-like prompts, but none of its examples use them and no test shows a gain. Quotation marks are used only for text that must appear in the image.

No change is needed to "Density", "Text, data, and graphics", or the edit rules.

[IP]: https://developers.openai.com/api/docs/guides/image-prompting
[IG]: https://developers.openai.com/api/docs/guides/image-generation
[IAR]: https://developers.openai.com/api/reference/resources/images/methods/generate
[CB2]: https://github.com/openai/openai-cookbook/blob/2182005bcaf5a5cdd96bb46fb9995d08730e7b91/examples/multimodal/image-gen-models-prompting-guide.ipynb
[CB15]: https://github.com/openai/openai-cookbook/blob/2182005bcaf5a5cdd96bb46fb9995d08730e7b91/examples/multimodal/image-gen-1.5-prompting_guide.ipynb
[CB2-IMG]: https://github.com/openai/openai-cookbook/blob/2182005bcaf5a5cdd96bb46fb9995d08730e7b91/images/output_images/christmas_collectible_toy_airplane_gpt-image-2.png
[SK]: https://github.com/openai/codex/blob/d42056091aded7feb1d88ac7e83972108b2aa478/codex-rs/skills/src/assets/samples/imagegen/SKILL.md
[SKS]: https://github.com/openai/codex/blob/d42056091aded7feb1d88ac7e83972108b2aa478/codex-rs/skills/src/assets/samples/imagegen/references/sample-prompts.md
[M1]: https://developers.openai.com/api/docs/models/gpt-image-1
[M2]: https://developers.openai.com/api/docs/models/gpt-image-2
[4O]: https://openai.com/index/introducing-4o-image-generation/
[4OSC]: https://cdn.openai.com/11998be9-5319-4302-bfbf-1167e093f1fb/Native_Image_Generation_System_Card.pdf
[I2SC]: https://deploymentsafety.openai.com/chatgpt-images-2-0/chatgpt-images-2-0.pdf
[D3]: https://cdn.openai.com/papers/dall-e-3.pdf
[EP]: codex-images-endpoint.md
[BFL-JSON]: https://docs.bfl.ml/guides/usecases_t2i_json_prompting
[BFL2]: https://docs.bfl.ai/guides/prompting_guide_flux2
[BFL-B]: https://docs.bfl.ai/guides/prompting_unified_basics
[BFL-BLOG]: https://bfl.ai/blog/flux-2
[BFL-SYS]: https://github.com/black-forest-labs/flux2/blob/main/src/flux2/system_messages.py
[BFL-TE]: https://github.com/black-forest-labs/flux2/blob/main/src/flux2/text_encoder.py
[FLUX1]: https://github.com/black-forest-labs/flux/blob/main/src/flux/util.py
[IDEO]: https://docs.ideogram.ai/using-ideogram/getting-started/prompting-guide/in-a-nutshell
[IDEO-J]: https://docs.ideogram.ai/using-ideogram/getting-started/prompting-guide/4.-json-prompting-ideogram-4.0
[IDEO4]: https://github.com/ideogram-oss/ideogram4/blob/main/docs/prompting.md
[IDEO4-R]: https://github.com/ideogram-oss/ideogram4
[FIBO]: https://github.com/Bria-AI/FIBO
[FIBO-P]: https://arxiv.org/html/2511.06876v1
[GBLOG]: https://developers.googleblog.com/en/how-to-prompt-gemini-2-5-flash-image-generation-for-the-best-results/
[GEM]: https://ai.google.dev/gemini-api/docs/image-generation
[GCLOUD]: https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana
[IMG]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/image/img-gen-prompt-guide
[IMAGEN3]: https://arxiv.org/html/2408.07009
[MJ]: https://docs.midjourney.com/hc/en-us/articles/32023408776205-Prompt-Basics
[SD3]: https://arxiv.org/html/2403.03206v1
[QWEN]: https://arxiv.org/html/2508.02324v1
[HY3]: https://arxiv.org/html/2509.23951v1
[SEED]: https://docs.byteplus.com/en/docs/modelark/seedream-4-0-5-0-prompt-guide
[RECRAFT]: https://www.recraft.ai/docs/prompt-engineering-guide/prompting-with-recraft-v4
[RUNWAY]: https://help.runwayml.com/hc/en-us/articles/35694045317139-Gen-4-Image-Prompting-Guide
[FF]: https://helpx.adobe.com/firefly/web/work-with-images/generate-images/writing-effective-text-prompts.html
[COSMOS]: https://arxiv.org/html/2606.02800v1
[ERNIE]: https://arxiv.org/html/2605.25347v1
[FEP]: https://arxiv.org/html/2606.05949v2
[SCALE]: https://arxiv.org/html/2607.29679v1
[TIIF]: https://arxiv.org/html/2506.02161v3
[ID4Q]: https://arxiv.org/abs/2606.12280
[RELAION]: https://arxiv.org/html/2507.05300v1
[SCHEMA]: https://arxiv.org/html/2602.18903v1
[IMAGINE]: https://arxiv.org/html/2501.13920v1
[LAYOUTGPT]: https://arxiv.org/abs/2305.15393
[LMD]: https://arxiv.org/abs/2305.13655
[ARO]: https://arxiv.org/abs/2210.01936
[LCLIP]: https://arxiv.org/html/2403.15378v3
[CLIPTOK]: https://github.com/openai/CLIP/blob/main/clip/simple_tokenizer.py
[T5TOK]: https://huggingface.co/google-t5/t5-base/blob/main/tokenizer.json
[ZPE]: https://huggingface.co/spaces/Tongyi-MAI/Z-Image-Turbo/blob/main/pe.py
[CJ]: https://chasejarvis.com/blog/does-json-prompting-actually-work-tested-with-nano-banana/
[RZ1]: https://www.reddit.com/r/StableDiffusion/comments/1peuwt7/json_prompts_better_for_zimage/
[RZ2]: https://www.reddit.com/r/StableDiffusion/comments/1p809wt/z_image_turbo_can_understand_json_prompting_very/
[MW]: https://minimaxir.com/2025/11/nano-banana-prompts/
[OAF]: https://community.openai.com/t/collection-of-dall-e-3-prompting-tips-issues-and-bugs-check-first-post/889278
