# GPT Image 2.5 and the Codex image endpoint: which model this repo gets

Researched on 2026-10-01. `openai/codex` was read at `main` = [`8ea2428c`](https://github.com/openai/codex/tree/8ea2428c38f8994e18d789669f5cbc5df75e1f17) (2026-10-01 04:25 UTC). No images were generated, no requests were sent to `chatgpt.com/backend-api/*`, and no paid API calls were made.

This note does not repeat [codex-images-endpoint.md](codex-images-endpoint.md). It covers only what changed with Images 2.5 (released 2026-09-08).

Labels: [PRIMARY] OpenAI docs, model pages, system card, or `openai/codex` source. [SECONDARY] community probes, issues, and third-party code; a rigor note is given for each one. [INFERENCE] my conclusion, not observed directly.

Status tags: **same** = unchanged from the gpt-image-2 era; **changed**; **new** = new with 2.5.

## TL;DR

- **The official Codex client still sends `model: "gpt-image-2"`.** It has no 2.5, Flare, or Sunburst reference anywhere, and no image-generation code or prompt guidance changed after `d4205609`. **Same.** [PRIMARY] [CX-TOOL] [CX-LOG]
- **OpenAI says Codex users get Images 2.5, but it never says which variant, and the Codex docs still say `gpt-image-2`.** **Changed (product claim), same (docs).** [PRIMARY] [ANN] [CXDOC] [CXPRICE]
- **On the native endpoint, the `model` field does not select a model.** Five independent probes (2026-09-09 to 09-23) show that invalid ids return HTTP 200, and 2.5 ids give the same reported fields as invalid ones. The C2PA tag reads `gpt-image / 2.0` on every route, including real API Flare and Sunburst output, so it can't identify the model. [SECONDARY] [I43965] [I45452] [HERMES] [DSH] [MCP]
- **Verdict: keep `model: "gpt-image-2"` in `extensions/codex-images.ts`.** Confidence is high that changing it gains nothing verifiable. Confidence is low on which weights actually serve the requests: probably the Codex-side Images 2.5 deployment, variant unknown, most likely Flare-like [INFERENCE]. See "Verdict".
- **Skill impact is small.** Rules that depend on the endpoint's behavior (size and quality can't be set, shape follows the prompt, crop for exact ratio, low-quality handling) still hold. One addition: never claim which image model produced a result. One wording tweak: transparency triggers. Write prompting rules that work on both gpt-image-2 and 2.5, because the serving model can change on the server without any client change.

---

## 1. openai/codex source at `8ea2428c` [PRIMARY]

| Finding | Status | Evidence |
|---|---|---|
| `const IMAGE_MODEL: &str = "gpt-image-2";` and `const MAX_EDIT_IMAGES: usize = 5;` | same | [CX-TOOL] L58–L59 |
| Generate and edit both send `model: IMAGE_MODEL`, `n: None`, `quality: Some(ImageQuality::Auto)`, `size: Some("auto")` | same | [CX-TOOL] L445–L452, L488–L496 |
| `ImageQuality` is still `Low, Medium, High, Auto`. It cannot express the 2.5-only `xhigh` or `max`. | same | [CX-IMG] L44–L49 |
| `git grep -i 'gpt-image-2\.5\|sunburst\|flare'` over `codex-rs`, `sdk`, and `docs` returns nothing (Cloudflare hits excluded). The only `IMAGE_MODEL` hits are tool.rs L58/L448/L492. | same | [CX-LOG] |
| No commit since 2026-09-01 mentions 2.5, Flare, Sunburst, or a model change, and no PR does either (`gh search prs` returns 0). | same | [CX-LOG] |
| `d42056091…` (2026-09-30) to `8ea2428c`: **no commits** touch `codex-rs/ext/image-generation`, the imagegen skill, or `codex-api/src/{images.rs,endpoint/images.rs}`. | same | [CX-LOG] |

**Bundled `$imagegen` skill.** `SKILL.md`, `references/prompting.md`, `references/sample-prompts.md`, `references/image-api.md`, and `references/cli.md` were last changed in `8cabf5a6c` (2026-08-10, "Use native transparency in the imagegen skill (#37788)"). That predates 2.5. Their only model guidance is for the API-key CLI fallback, and it is still gpt-image-2-only: "The fallback CLI defaults to `gpt-image-2`." ([SK] SKILL.md L244–L252) and "`gpt-image-2` does not currently support the Image API `background=transparent` parameter." ([SK-API] L71). The fallback model table lists `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1`, and `gpt-image-1-mini`, with no 2.5 entry ([SK-API] L13–L18). `scripts/image_gen.py` keeps `DEFAULT_MODEL = "gpt-image-2"`; its edits since August are formatting and logging only. **Same, so 2.5 brought no prompting-rule changes to the Codex skill.** [PRIMARY]

**`imagegen_description.md` (the tool description the model sees).** Two lines were added in September. Neither depends on the model:

- `2f1583b4` (2026-09-14, #45544), L8: "Avoid printing the full result or its base64 image data with `text()` or `notify()`; print only small metadata when needed." Not relevant to prompting. [PRIMARY] [TD]
- `40eac3ce` (2026-09-23, #47484), L9: "Set `transparent_background` to true when the request calls for a transparent background, including background removal or a cutout; set it to false otherwise. For edits, preserve existing transparency unless the user asks to change it." The same PR changed the wire default from `background: "auto"` to `"opaque"`: "Map `true` to `transparent` and `false` or omission to `opaque`, replacing the previous `auto` background setting." **Changed, but unrelated to 2.5.** This repo already sends `opaque`/`transparent` ([EXT] L82). [PRIMARY] [TD] [PR47484]
- Unchanged and still matching our skill: "Directly generate the image without reconfirmation or clarification unless required images must be attached again." (L17). [PRIMARY] [TD]

## 2. Official docs and announcement [PRIMARY]

- **Announcement, Codex rollout. New.** "Images 2.5 is available to all ChatGPT, ChatGPT Work, and Codex users across desktop, mobile, and web." and "Images 2.5 is rolling out today to ChatGPT, ChatGPT Work, and Codex users across all tiers". The API gets two separate models: "GPT‑Image‑2.5 Flare brings the same improvements in quality, editing, and speed to the API and is the default choice for most applications, delivering higher-quality images than GPT‑Image‑2 at 50% lower latency." and "GPT‑Image‑2.5 Sunburst is built for premium visual workflows that benefit from tighter control across edits." No sentence maps Codex or ChatGPT to either variant. [ANN]
- **Codex image-generation doc. Same (not updated for 2.5).** It still says: "Built-in image generation uses `gpt-image-2` and counts toward your general Codex usage limits." It never mentions 2.5, Flare, or Sunburst. [CXDOC]
- **Codex pricing. Same.** The credit table lists only "GPT-Image-2 (image)" (200 / 50 / 750 credits) and "GPT-Image-2 (text)" (125 / 31.25 / 250), with no 2.5 rows. [CXPRICE]
- **Codex changelog, 2026-09-01 to 09-30.** No Images 2.5 entry. The only image items are CLI 0.158.0 ("Image generation and editing can explicitly request transparent backgrounds, and edits now accept file-backed conversation images. (#47484, #47956)") and internal PR titles. [CXLOG]
- **System card. New.** It evaluates "GPT-Image-2.5-Sunburst and GPT-Image-2.5-Flare" against "ChatGPT Images 2.0 (baseline)". It adds SynthID watermarking "through ChatGPT, Codex, and the OpenAI API" and keeps "a continued commitment to C2PA metadata". It does not map products to variants. [SC]
- **Model pages. New, and Flare and Sunburst differ here.** Flare: "our fastest model for high-quality, everyday image generation". Sunburst: "Our most capable model for image generation and editing … Use it for workflows where editing precision matters most." Both: "supports `low`, `medium`, `high`, `xhigh`, `max`, and `auto`", snapshots `-2026-09-08`, and "Token rates match GPT Image 2." gpt-image-2 stays a separate model (snapshot `gpt-image-2-2026-04-21`), and no page calls it an alias of 2.5. [MF] [MS] [M2]
- **`chatgpt-image-latest`. Changed.** "This points to the Image snapshot previously used in ChatGPT. We recommend GPT-Image-2.5 Sunburst for API use." That implies ChatGPT now runs a different snapshot, but the page doesn't name it. [MCL]
- **API guide. Changed.** The examples now default to `gpt-image-2.5-sunburst`. Size rules are unchanged (multiples of 16, ratio 1:3 to 3:1, at most 3840 px, 655,360 to 8,294,400 px). The guide adds "For transparent backgrounds with either model, set `background: "transparent"`". [IG]
- [INFERENCE] **Which variant Codex gets.** Probably a Flare-class model. The consumer copy ("reduced image generation latency by up to 50% compared with Images 2.0") matches Flare's "50% lower latency", and the copy says Flare "brings the same improvements" to the API. The claim that ChatGPT "defaults to … Flare" and "escalates to Sunburst" comes from an unsourced forum post ("AFAIK") [SECONDARY] [COMM]. Treat the variant as unknown.

## 3. Community probes on the native endpoint [SECONDARY]

| Date | Source | Request → result | Rigor |
|---|---|---|---|
| 09-09 | [DSH] dsh-codex-auth | Sunburst/Flare, `low`/`xhigh`/`max`, sizes 1024² and 1536×864, gen+edit → all **1254×1254**, 20–24 s | 4 calls, one account, no invalid-model control |
| 09-09/10 | [I43965] NguyenAnh718, Serg2000Mr (Codex app) | Built-in tool after the in-app "try Image 2.5" prompt; C2PA `gpt-image` / `2.0`, "claim generator: OpenAI Media Service API" | Assistant-written; signatures not verified; the notification was not captured |
| 09-10 | [I43965] Joeywrz | `gpt-image-2.5-flare` vs an invalid id: both 200, both **1254×1254**, `quality=low`; keys `background, created, data, output_format, quality, size, usage`; no effective-model field | Has a negative control; n=2; one account |
| 09-14 | [HERMES] teknium1 (Hermes maintainer) | `gpt-image-2.5-sunburst`, `high`, `1536x1024` → `low`, **1254×1254**, C2PA 2.0; `totally-not-a-model` → "HTTP 200 with the identical result". Hermes then "deliberately NOT" added 2.5: "A 2.5 tier here would be a label with no effect." | Has a control; small n; details not public |
| 09-15 | [I43965] Dr-Amp | Sunburst, low, 1024² → **1536×1024**; invalid id → 1254×1254; both C2PA 2.0 | Has a control; n=2; the author says "a single stochastic pair cannot establish" routing |
| 09-22/23 | [MCP] codex-imagegen-mcp BACKEND.md | `gpt-image-bogus-does-not-exist` → 200 and a normal image; 2.5 ids, `xhigh`/`max`, and 2K sizes → "the service's default size, with `medium` or `low` quality". Outputs about 1.57 MP shaped by the prompt (1254², 1536×1024, 1672×941, 1916×821, 1370×1148), 12–48 s. The app's "ImageGen 2.5" announcement is reportedly "gated by a Statsig flag" | Most thorough; Plus account; claims not independently checked |
| 09-14 | [I45452] | Real **API** `gpt-image-2.5-flare` and `-sunburst` outputs also carry C2PA `gpt-image` / `2.0` | Shows that C2PA 2.0 does not identify the model |
| 09-09 | [COMM] Sam Saffron (term-llm) | "This is supported natively in Codex subscriptions!!!" Sunburst and Flare images look different | **No control**; term-llm forwards `model` to the same endpoint ([TERM]); contradicted by the controlled probes |
| Hosted Responses route | [H107233] [MCP] | `/codex/responses` rewrites any `image_generation` tool spec to `model=gpt-image-2-codex quality=auto size=auto` (invalid-model and empty-spec controls) | Not the route this repo uses |

What these probes show:

- **The model field.** The native route does not validate `model` and does not reliably honor it. One pair (Dr-Amp) had different sizes, which is weak and stochastic. No probe shows a 2.5 id producing something an invalid id cannot. [SECONDARY]
- **Fingerprints that don't identify the model:**
  - C2PA `gpt-image / 2.0` is the same on Codex, API Flare, and API Sunburst [I45452].
  - The response has no model field.
  - `usage` token counts were not published by any post-2.5 probe. OpenAI says 2.5 "token rates match GPT Image 2", and a forum analysis says the 2.5 quality steps span the same token range as gpt-image-2 low..high [COMM]. So `usage` is unlikely to separate the models either. [INFERENCE]
- **Size.** 1254×1254 is not a multiple of 16, so it is not a legal public-API size [IG]. The fixed ~1.57 MP aspect-matched canvases look like a service-side size policy, not a model trait. No public pre-2.5 vs post-2.5 size comparison exists. [INFERENCE]
- **Latency.** 2.5-era probes report 12–48 s [MCP] [DSH]. The one pre-2.5 timed native call took 55.8 s for a high/2160×3040 request ([I28723], 2026-07-21). That fits a faster model, but the prompts differ and n=1, so it is not evidence. [INFERENCE]
- **SynthID.** The 2.5 system card adds SynthID "through … Codex". If it was introduced with 2.5, a SynthID-positive Codex output would be the first real 2.5 fingerprint. Nobody has tested this. [INFERENCE]
- **No OpenAI reply.** No OpenAI member has answered #43965, #45452, or #44369 (closed as a duplicate of #43965). [SECONDARY]

## 4. Verdict on `extensions/codex-images.ts` (`model: "gpt-image-2"`, L83)

**Recommendation: keep `model: "gpt-image-2"`. Don't change it to `gpt-image-2.5-flare` or `-sunburst`.**

Evidence:

1. **It matches the official client byte for byte** ([CX-TOOL] L448/L492 at `8ea2428c`). Whatever OpenAI routes Codex to, which it says is Images 2.5, is what this repo gets. The route is set by the server through auth, originator, and plan, not by this field. [PRIMARY] + [INFERENCE]
2. **The field has no observable effect today.** Several controlled probes show invalid ids return the same result as 2.5 ids, and there is no effective-model field to confirm a selection. [SECONDARY]
3. **A 2.5 id would be a claim we can't verify.** The Hermes maintainer and the #43965 reporters reached the same conclusion, and Hermes removed 2.5 from its OAuth provider for this reason. [SECONDARY]

Risks:

- **If we change the id.** Should OpenAI start validating `model` on this route against a Codex allowlist (today `gpt-image-2`; issue #25965 shows the server checks model existence at least sometimes: "The model 'gpt-image-2' does not exist"), a 2.5 id could start failing or billing differently. It would also make our requests differ from the official client, which matters given the [SECONDARY] reports that OpenAI asks third-party harnesses to look honest and consistent (see codex-images-endpoint.md Q5).
- **If we keep it.** Should OpenAI later honor `model` and send `gpt-image-2` to the literal April snapshot while Codex moves to a new id, we would silently stay on the older model. Mitigation: re-check `IMAGE_MODEL` at [CX-TOOL] L58 whenever Codex is updated, and follow it.
- **Confidence.**
  - High that "keep" is correct today.
  - High that the request field does not choose Flare or Sunburst.
  - Low to medium on what actually serves the requests. OpenAI's statement points to Images 2.5 [ANN], the Codex doc still says gpt-image-2 [CXDOC], and no artifact can tell them apart.
  - Unknown which variant serves; Flare-class is more likely [INFERENCE].

## 5. Skill impact (`skills/generate-image/SKILL.md`)

Principle: the agent cannot pick or detect the image model, and the server can change it silently (gpt-image-2 or a 2.5 variant). Rules must therefore work for both and must not assume model-specific behavior. Rules about 2.5's prompting itself (edit precision, multi-turn drift) belong to the sibling research notes. This section covers only rules that depend on the endpoint or the serving model.

| SKILL.md line | Action | Evidence | Proposed wording / reason |
|---|---|---|---|
| L8 "Generate right away, without asking the user to confirm." | **Stays** | [TD] L17 | Matches Codex's own instruction. |
| L10 "The prompt is used exactly as written … Size and quality can't be set; the shape follows the prompt." | **Stays** | [CX-TOOL] L450–L451, [MCP], [HERMES], [DSH] | Still true after 2.5: size and quality are ignored or replaced, and an aspect line in the prompt sets the canvas. |
| L26 **Shape** "orientation and aspect ratio in words" | **Stays** | [MCP] | "Aspect ratio: 16:9, wide landscape (horizontal) canvas" → 1672×941 after 2.5. |
| L54–L56 references (implicit cap of 5) | **Stays** | [CX-TOOL] L59 | `MAX_EDIT_IMAGES = 5` is unchanged. Don't adopt the API's 16-image limit. |
| L80 "After two or three chained edits, or at the first sign of drift, restart…" | **Stays (for this note)** | [ANN] vs [I43965] | 2.5 claims better multi-turn consistency, but nobody can confirm it serves this route. Keep the conservative rule; Edit25Guidance may revise it. |
| L84 Transparency, first bullet | **Change (wording)** | [TD] L9, [PR47484] | "When the user asks for a transparent background, a cutout, or background removal, set `transparent_background: true` and describe an isolated subject on a fully transparent background, with no backdrop, checkerboard, or shadow. Any backdrop the prompt describes overrides the flag." This adds the cutout and background-removal triggers from Codex's own guidance. |
| L86–L87 re-set flag on edits; checkerboard = lost | **Stays** | [TD] L9, [MCP] | Codex: "preserve existing transparency unless the user asks to change it". RGBA output was seen after 2.5, but the flag is "a strong hint rather than a switch". |
| L93 "If quality is `low`, add scene-level detail…" | **Stays** | [I43965] Joeywrz, [HERMES], [EXT] L29–L31 | After 2.5 the backend often reports `quality=low` for `auto`, and the extension passes that value to the agent. The rule is still relevant. |
| L96 "For an exact aspect ratio, crop." | **Stays** | [MCP], [IG] | Outputs are about 1.57 MP service sizes (1254×1254 isn't even a legal API size). |
| L97 "Tell the user about anything the tool can't deliver: vector output, exact pixel sizes, an exact match to official logo artwork." | **Change (add item)** | [I43965], [I44369], [I45452], [COMM] post 18 | "…vector output, exact pixel sizes, a chosen image model or version (such as GPT Image 2.5 Flare or Sunburst), an exact match to official logo artwork." Users ask for 2.5 by name, and agents in #43965 invented an API-key requirement. |
| (new, after L97) | **Add** | [I45452], [I43965], [CX-TOOL] | "Don't tell the user which image model made a result. The tool doesn't report it, and the C2PA tag `gpt-image 2.0` appears on 2.5 output too." This stops a failure seen repeatedly in #43965, #44369, and the OpenAI forum. |
| Any rule conditioned on "gpt-image-2" or "2.5" | **Don't add** | §3 | The serving model can't be verified and can change on the server. A model-conditional rule would be wrong whenever routing changes. |
| L101 Files | **Stays** | — | Not model-dependent. |

## Source keys

- [CX-TOOL]: https://github.com/openai/codex/blob/8ea2428c38f8994e18d789669f5cbc5df75e1f17/codex-rs/ext/image-generation/src/tool.rs#L58-L59 (also `#L445-L452`, `#L488-L496`)
- [CX-IMG]: https://github.com/openai/codex/blob/8ea2428c38f8994e18d789669f5cbc5df75e1f17/codex-rs/codex-api/src/images.rs#L44-L49
- [CX-LOG]: `git log`/`git grep` on https://github.com/openai/codex at `8ea2428c38f8994e18d789669f5cbc5df75e1f17`, range `d42056091aded7feb1d88ac7e83972108b2aa478..8ea2428c` and `--since=2026-09-01`
- [TD]: https://github.com/openai/codex/blob/8ea2428c38f8994e18d789669f5cbc5df75e1f17/codex-rs/ext/image-generation/imagegen_description.md
- [PR47484]: https://github.com/openai/codex/commit/40eac3ce8a0c10cbcb9db910d529355eb2f8fc09 (PR https://github.com/openai/codex/pull/47484); #45544: https://github.com/openai/codex/commit/2f1583b411becb2a6345be50754e2e51c53790c8
- [SK]: https://github.com/openai/codex/blob/8ea2428c38f8994e18d789669f5cbc5df75e1f17/codex-rs/skills/src/assets/samples/imagegen/SKILL.md (last changed https://github.com/openai/codex/commit/8cabf5a6cf103cebe338d46346e43e3201e64f41)
- [SK-API]: https://github.com/openai/codex/blob/8ea2428c38f8994e18d789669f5cbc5df75e1f17/codex-rs/skills/src/assets/samples/imagegen/references/image-api.md
- [EXT]: `extensions/codex-images.ts` (this repo), L29–L38, L82–L85
- [ANN]: https://openai.com/index/introducing-chatgpt-images-2-5/
- [SC]: https://deploymentsafety.openai.com/chatgpt-images-2-5
- [CXDOC]: https://learn.chatgpt.com/docs/image-generation
- [CXPRICE]: https://learn.chatgpt.com/docs/pricing#image-generation-usage-limits
- [CXLOG]: https://learn.chatgpt.com/docs/changelog
- [MF]: https://developers.openai.com/api/docs/models/gpt-image-2.5-flare
- [MS]: https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst
- [M2]: https://developers.openai.com/api/docs/models/gpt-image-2
- [MCL]: https://developers.openai.com/api/docs/models/chatgpt-image-latest
- [IG]: https://developers.openai.com/api/docs/guides/image-generation#size-and-quality-options
- [I43965]: https://github.com/openai/codex/issues/43965
- [I44369]: https://github.com/openai/codex/issues/44369
- [I45452]: https://github.com/openai/codex/issues/45452
- [I28723]: https://github.com/openai/codex/issues/28723
- [HERMES]: https://github.com/NousResearch/hermes-agent/issues/106708 (closing comment; PR https://github.com/NousResearch/hermes-agent/pull/111000)
- [H107233]: https://github.com/NousResearch/hermes-agent/issues/107233
- [DSH]: https://github.com/suntianc/dsh-codex-auth/blob/main/docs/gpt-image-2.5-compatibility.md
- [MCP]: https://github.com/ShalomObongo/codex-imagegen-mcp/blob/main/docs/BACKEND.md
- [TERM]: https://github.com/SamSaffron/term-llm/blob/main/internal/image/chatgpt.go
- [COMM]: https://community.openai.com/t/introducing-gpt-images-2-5-in-the-api-and-chatgpt/1395897 (posts 5, 9, 18–20)
