# GPT Image 2.6 Sunburst: API changes, prompting, and live probes

Researched on 2026-11-05. This note extends [gpt-image-2.5-openai.md](gpt-image-2.5-openai.md), which remains dated evidence for the earlier model. Scope: omp-tools' public OpenAI Images API mode, new GIF and SVG output, and whether Codex mode needs a request change. First-party pages were read on 2026-11-05 in the release, parameter, and Codex research reports. The live probe results below are separate observations from that date, not claims made by those pages.

Source keys resolve to URLs at the bottom. `[PRIMARY]` marks first-party documentation or source, `[OBSERVED]` marks a captured request or model response, and `[INFERENCE]` marks an interpretation. Documentation gaps remain gaps unless a probe directly addresses them.

## Bottom line

- OpenAI released Images 2.6 on 2026-11-04. The public IDs are `gpt-image-2.6-sunburst` and `gpt-image-2.6-flare`, with no dated 2.6 snapshot listed. omp-tools' OpenAI mode now sends only Sunburst, without a per-call `model` argument. The 2.5 model pages remain available without a published retirement date. [PRIMARY] [ANN] [MS26] [MF26] [DEP]
- The API adds planning `complexity`, animated GIF generation, SVG generation with a separate SVG author, and separate `svg_usage`. The prompt fundamentals remain the same. Markup is supported by both 2.5 and 2.6, not exclusive to 2.6. [PRIMARY] [IP] [IG] [CL] [SPEC]
- GIF documentation conflicts on frame counts, delays, and editing. The tool uses the common documented range, 2–16 frames at 20–2000 ms, and generation only. It preserves GIF bytes as `image/gif`. Two tested model routes accepted that content but reported only the first frame. [PRIMARY] [IG] [GEN] [EDIT] [OBSERVED, probe 1]
- OpenAI does not publish 2.6-specific maximum-edge or total-pixel bounds in the fetched sources. The tool retains only multiples of 16 and aspect ratios from 1:3 to 3:1, leaving remaining checks to the API. Applying 2.5's numerical bounds to 2.6 would be an inference. [PRIMARY] [IP] [GEN] [EDIT]
- SVG generation required `svg.model` in the tested account. Six tested OpenAI authors succeeded. The plugin defaults `svgAuthorModel` to `gpt-6.1-sol`; that is a plugin choice, not a documented API default. SVG returns a saved path to read, not image content. [OBSERVED, probe 2]
- Codex mode stays unchanged and still sends `gpt-image-2`. Its tested endpoint refused GIF output. OpenAI's product announcement does not identify the model variant serving a particular Codex OAuth request. [PRIMARY] [ANN] [CX] [CXSRC] [OBSERVED, probe 3]

## 1. 2.5 versus 2.6

### Parameters and output

The parameter report compared the official OpenAPI before the 2.6 addition at `20a459affe7aea4cc7333375802706e296a56011` with `3e288ba501d136b81181919a12a88495a0244488`. Generation adds `complexity`, `frame_count`, `frame_duration_ms`, and `svg`. Edit schemas add complexity and frame controls, despite the guide excluding GIF edits. The response adds `svg_usage`. Existing request properties were not removed from those compared schemas. Removing the tool's `model` argument is an omp-tools cutover, not an upstream parameter removal. [PRIMARY] [PRE] [SPEC]

| Setting | 2.5 | 2.6 | Sources |
| --- | --- | --- | --- |
| Sunburst model | Alias `gpt-image-2.5-sunburst`, snapshot `gpt-image-2.5-sunburst-2026-09-08`. | `gpt-image-2.6-sunburst`, sole listed alias or snapshot. | [MS25] [MS26] |
| `quality` | `auto`, `low`, `medium`, `high`, `xhigh`, `max`. | Same values, default `auto`. | [IP] |
| `complexity` | Absent from prelaunch schemas. | `low`, `medium`, `high`; direct Images API default `high`. Separate planning control, not rendering quality. | [PRE] [SPEC] [IP] [IG] |
| `n` | 1–10. | Same for raster output. SVG requires 1; GIF also has an unpublished total request pixel budget. | [GEN] [IG] |
| `size` | `auto` or custom sizes, multiples of 16, ratio 1:3–3:1, maximum edge 3840, 655,360–8,294,400 pixels. Above 3,686,400 pixels is experimental. | `auto`, the same standard sizes, or custom dimensions divisible by 16 at ratio 1:3–3:1. Exact edge and pixel bounds are unconfirmed. GIF size describes each frame. | [IP] [IG] [GEN] [EDIT] |
| `output_format` | PNG, JPEG, WebP. | Adds GIF and SVG generation. GIF returns animation bytes; SVG returns base64-encoded UTF-8 XML. | [PRE] [SPEC] [IG] |
| `output_compression` | 0–100, JPEG and WebP only. | Same. Unsupported for GIF and SVG. | [GEN] [IG] |
| Transparency | PNG and WebP. | Also SVG. GIF transparency is not specified in the fetched material. | [IP] [IG] |
| GIF frame controls | Absent from prelaunch schemas. | `frame_count` and `frame_duration_ms`, defaults 9 and 200. Limits conflict, as recorded below. | [PRE] [GEN] [IG] |
| `svg.model` | Absent from prelaunch schemas. | Separate author model, required inside a supplied `svg` object. Author selection is access-dependent. No universal default or allowed-model list is published. | [PRE] [SPEC] [GEN] |
| `svg.reasoning.effort` | Absent from prelaunch schemas. | `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, subject to author support. Omission uses the author's default. | [GEN] [SPEC] |
| `svg_usage` | Absent from prelaunch response. | Separate author `model`, input, output, total, and reasoning token counts. Ordinary image `usage` remains separate. | [PRE] [SPEC] [GEN] |
| Streaming | Raster partial and completed events. | Same four event schemas. GIF and SVG do not support Images API streaming or partial images. | [PRE] [SPEC] [IG] |
| Markup | Supported on eligible 2.5 models. | Also supported on 2.6. Separate transparent PNG targets image 1, matches its oriented dimensions, and cannot be combined with a mask. | [CL] [IG] [IP] |
| `input_fidelity`, reasoning summary | Generic edit schema retains older fidelity options. | The 2.6 guide explicitly says to omit `input_fidelity`; `reasoning.summary` is unsupported. This does not establish an effective fidelity level. | [IP] [EDIT] |

SVG is generation-only, with `n=1`, no Reference images, streaming, partial images, compression, or `prompt_rewriter`. Its static vector content excludes scripts, external resources, and embedded raster images. Quality and complexity affect the reference image, not the separate author's reasoning. [PRIMARY] [IG] [GEN]

### Prices, Batch, and rate limits

Standard prices are unchanged across both 2.5 and 2.6 model families, per million tokens. [PRIMARY] [PRICE] [MS25] [MS26]

| Item | 2.5 | 2.6 |
| --- | ---: | ---: |
| Text input | $5.00 | $5.00 |
| Cached text input | $1.25 | $1.25 |
| Image input | $8.00 | $8.00 |
| Cached image input | $2.00 | $2.00 |
| Image output | $30.00 | $30.00 |

Equal token prices do not establish equal per-image costs. Models and quality settings can use different token counts. Complexity has no separate fee. SVG costs include reference-image generation and the author's tokens. The fetched costs section does not publish a separate GIF fee or a complete GIF billing formula. [PRIMARY] [IG]

The pricing page limits cached-input discounts for 2 and 2.5 to Responses, not direct Images calls. It lists 2.6 cached-input prices without explicitly resolving eligibility for direct Images requests. Neither eligibility nor ineligibility is established here. [PRIMARY] [PRICE] [IG]

The 2.5 model pages support Batch, with per-million-token Batch rates of $2.50 text input, $0.625 cached text input, $4 image input, $1 cached image input, and $15 image output. Both 2.6 model pages mark Batch unsupported, and pricing has no 2.6 Batch row. [PRIMARY] [PRICE] [MS25] [MS26] [MF26]

| Published tier | 2.5 tokens/minute | 2.5 images/minute | 2.6 |
| --- | ---: | ---: | --- |
| Build | 250,000 | 20 | Model pages defer to organization limits. |
| Launch | 3,000,000 | 150 | Model pages defer to organization limits. |
| Grow | 8,000,000 | 250 | Model pages defer to organization limits. |

Both variants' model pages support these findings. No public numerical 2.6 limit table was found in the fetched pages, so a rate increase, decrease, or equality is unobserved. Organization verification may be required; the reference also names GIF-preview and SVG-author-selection access gates. [PRIMARY] [MS25] [MF25] [MS26] [MF26] [IG] [GEN]

## 2. GIF conflicts and unknown size bounds

| Question | Generation guide | Images reference and SDKs | Tool choice |
| --- | --- | --- | --- |
| Frames | 2–64, default 9. | 2–16, default 9. | 2–16, default 9. |
| Delay | 20–2000 ms, default 200. | Minimum 20 ms, default 200, rounded to nearest 10 ms, encoded cap 655,350 ms. No 2000 ms request maximum in the Images spec. | 20–2000 ms, default 200. |
| Editing | Explicitly unsupported. | Edit schemas and SDK types include GIF and frame controls. | New images only. |
| Preview access | Describes GIF without the same explicit preview-access requirement. | Reference says preview access is required. | API refusal is reported, not bypassed. |
| Pixel budget | Per-frame size, frames, and `n` must fit an unpublished request budget. | Names model-specific limits without numerical 2.6 bounds. | API checks the remaining limits. |

Sources: [PRIMARY] [IG] [GEN] [EDIT] [SPEC] [NODE] [PY]. These conflicts were not resolved by boundary probes. The tool takes the overlap of documented limits rather than claiming the larger values work.

The prompting guide's GIF example uses 512x512 frames, so the old still-image minimum of 655,360 pixels must not be applied to GIF frames. For 2.6 still images, only multiples of 16 and aspect ratios 1:3 through 3:1 are explicit. The detailed 3840-edge and total-pixel paragraphs still name 2.5 or earlier models. Exact 2.6 maximum edge, minimum pixels, maximum pixels, and experimental threshold remain unknown. [PRIMARY] [IP] [IG] [GEN] [EDIT]

## 3. Prompting changes

The eight prompt fundamentals remain the same in the currently served 2.5 and 2.6 guide sections. There is no new prompt grammar or required format. [PRIMARY] [IP]

- Keep the same prompt, references, size, quality, and format when migrating. Leave complexity at its default initially. Change quality or complexity one at a time. High complexity helps open layout decisions and dense text. Start with low complexity for a one-detail edit, then check surrounding details. For small text, compare quality at fixed complexity. [PRIMARY] [IP] [IG]
- For a smooth GIF loop, give the subject a starting pose to return to and state whether the camera moves. [PRIMARY] [IP]
- Use SVG for assets whose paths must scale or be recolored, including logos and icons. Set `n=1` and save the decoded XML as `.svg`. [PRIMARY] [IP] [IG]
- Keep markup as a separate transparent PNG, not a flattened annotated copy. Name the marked object and target change, state preservation constraints, and ask to remove the annotation from the result. Markup applies only to image 1; other inputs are references. [PRIMARY] [IP] [IG]

## 4. Live probes on 2026-11-05

These are account- and route-specific observations. Local evidence names identify the captured probe summaries, not public documentation.

### Probe 1: GIF as model input

The `GifInput/results.tsv` captures tested both an animated GIF and a single-frame GIF as tool-result image content through OMP print JSON. [OBSERVED]

| Route | Result |
| --- | --- |
| Anthropic `claude-haiku-5-5`, `anthropic-messages` | Accepted both. For the animated input, reported only the first frame, a red background with white `ONE`. Stop reason `stop`. |
| Codex login `gpt-6-luna`, `openai-codex-responses` | Accepted both. Described the animated input as a still image with the same red background and `ONE`. Stop reason `stop`. |
| Public OpenAI `gpt-6-luna`, Responses API key | HTTP 401, missing `api.responses.write`, before the tool probe ran. GIF acceptance not established. |
| Direct public Chat Completions fallbacks | `gpt-4.1-nano` returned HTTP 404 for deprecation; `gpt-5.4-nano` returned HTTP 401 for missing `model.request`. GIF acceptance not established. |

The successful routes' fetch hook captured no provider HTTP status or request id. The observations establish acceptance on those two routes and first-frame descriptions, not model understanding of the animation. omp-tools therefore returns unchanged `image/gif` content and leaves motion inspection to local tools. [OBSERVED] [INFERENCE]

### Probe 2: SVG author requirements and supported authors

`SvgAuthor/summary.json` records a successful 2.6 raster control, HTTP 200, request `req_4a5a63a030a74942b2b555e6aa51c57c`. SVG without an author object failed with HTTP 400, `SVG generation requires 'svg.model'.`, request `req_69a1acc4dff942e2ae657ae07026b8b7`. An invalid author failed with HTTP 404, `model_not_found`, request `req_0def24a7f9744dcb82aeaf91222b47c0`. [OBSERVED]

Model lookup and listing returned HTTP 403 for missing `api.model.read`, requests `f1caf09a-28a5-430d-992e-3314ba8abc4a` and `a2ff5a6f-d9e8-4866-a6b5-8bffbe07efe8`. Those failures did not prevent image generation with the same credential. [OBSERVED]

`SvgAuthor/latest/summary.json` records successful SVG generation with all six tested authors. Each returned HTTP 200, SVG bytes, ordinary image `usage`, and separate `svg_usage`. [OBSERVED]

| Requested SVG author | `svg_usage.model` | Request id |
| --- | --- | --- |
| `gpt-6.1-sol` | `gpt-6.1-sol` | `req_2eeefffde61446de872ca6fe793e86ba` |
| `gpt-6.1-terra` | `gpt-6.1-terra` | `req_3435ddad834e4ff59a3f1f72689613cc` |
| `gpt-6-sol` | `gpt-6-sol` | `req_5eb1c29b0a28442bb764d6faaebb547c` |
| `gpt-6-luna` | `gpt-6-luna` | `req_9ac9c6a3091e4c78955287d7a8fef631` |
| `gpt-6-astra` | `gpt-6-astra` | `req_4de1970ff717426ab8628916b4e46a7d` |
| `gpt-5.6` | `gpt-5.6-sol` | `req_bb86aaefea38430a8d75abd6e438e297` |

This establishes those authors for the tested account, not a universal allowed-model list or support for every reasoning effort. The plugin's `svgAuthorModel` defaults to `gpt-6.1-sol`, with empty values using that default. Registration reads it when the session starts. A call's `svg.model` overrides it, and `svg.reasoning.effort` sets author reasoning. The tool preserves the `.svg` and returns its path only, with `svg_usage` retained as `details.svgUsage`.

### Probe 3: Codex GIF availability

`CodexGif/results.json` records a normal Codex image control returning HTTP 200, a single-frame PNG, and request id `27c93bc3-5038-4917-8028-0ab0ae7ab110`. Both a GIF request with explicit frame controls and one with default controls returned HTTP 400, `GIF output is not enabled for this request.` Neither refusal included a request id. [OBSERVED]

Official stable Codex 0.166.0, prerelease 0.168.0-alpha.3, and pinned main still send `gpt-image-2`. Main and the prerelease add optional GIF controls behind an animation feature gate, but that source support does not establish access for the tested account. Codex mode remains unchanged. No probe identifies whether its serving weights are 2.6 Sunburst, Flare, or another deployment. [PRIMARY] [CXSRC] [CXGIF] [OBSERVED] [INFERENCE]

### Plugin live API tests

The opt-in `test/generate-image-openai.live.test.ts` sends three paid public Images requests: a still image with complexity, SVG, and GIF. All three passed on 2026-11-05 in 45 seconds. It requires `OPENAI_API_KEY` and `OMP_TOOLS_LIVE_IMAGES=1`; run `OMP_TOOLS_LIVE_IMAGES=1 bun test live`. These checks establish those API paths, not OMP registration, tool-card rendering, GIF boundary limits, or a universal author list. Requests are billed to the key's API organization.

## Sources

First-party pages and pinned source below were read on 2026-11-05 in the research reports. Probe observations are identified separately above.

[ANN]: https://openai.com/index/introducing-images-2-6/
[IP]: https://developers.openai.com/api/docs/guides/image-prompting
[IG]: https://developers.openai.com/api/docs/guides/image-generation
[CL]: https://developers.openai.com/api/docs/changelog
[DEP]: https://developers.openai.com/api/docs/deprecations
[MS25]: https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst
[MF25]: https://developers.openai.com/api/docs/models/gpt-image-2.5-flare
[MS26]: https://developers.openai.com/api/docs/models/gpt-image-2.6-sunburst
[MF26]: https://developers.openai.com/api/docs/models/gpt-image-2.6-flare
[GEN]: https://developers.openai.com/api/reference/resources/images/methods/generate
[EDIT]: https://developers.openai.com/api/reference/resources/images/methods/edit
[PRICE]: https://developers.openai.com/api/docs/pricing#image-generation
[PRE]: https://raw.githubusercontent.com/openai/openai-openapi/20a459affe7aea4cc7333375802706e296a56011/openapi.json
[SPEC]: https://raw.githubusercontent.com/openai/openai-openapi/3e288ba501d136b81181919a12a88495a0244488/openapi.json
[NODE]: https://raw.githubusercontent.com/openai/openai-node/v7.51.0/src/resources/images.ts
[PY]: https://raw.githubusercontent.com/openai/openai-python/v3.46.0/src/openai/types/image_generate_params.py
[CX]: https://learn.chatgpt.com/docs/image-generation
[CXSRC]: https://github.com/openai/codex/blob/56032e9732aa9776b7f54075ed9333921596cde9/codex-rs/ext/image-generation/src/tool.rs
[CXGIF]: https://github.com/openai/codex/commit/f9e7b19df8aa75490fc1d90f98d3d95ad716d08e
