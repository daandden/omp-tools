# Which model serves Codex's built-in `image_gen`? (`gpt-image-2` / `gpt-image-2-codex` vs GPT Image 2.5)

Investigated 2026-10-08 with Codex CLI 0.160.0 (Homebrew cask; 0.161.0 is available), signed in with ChatGPT (plan header `prolite`). This note adds live captures to [gpt-image-2.5-codex.md](gpt-image-2.5-codex.md) (2026-10-01) and [codex-images-endpoint.md](codex-images-endpoint.md) (2026-09-29) and does not repeat them.

Labels: **[OBSERVED]** is my own live capture on this machine. **[PRIMARY]** is OpenAI docs, OpenAI's calculator code, or `openai/codex` source. **[SECONDARY]** is third-party probes and issues. **[INFERENCE]** is my conclusion.

Hypothesis tested: `gpt-image-2-codex` is a server-side alias that may route to GPT Image 2.5, even though the Codex client still names GPT Image 2.

## Verdict

**INCONCLUSIVE: the backend model cannot be established.**

- No response field, response header, error, or metadata names the model that actually ran.
- Every identifier I observed is either chosen by the client or a label set by the server. The endpoint accepts any `model` value, including invalid ids, and changing it produced no visible difference. Whether the value affects which model is selected is still unverified.
- The one artifact that changed at the 2.5 launch is the output token count. It fits GPT Image 2.5's published token ladder better than GPT Image 2's. But the count is controlled by a serving parameter, so it can't prove which weights produced the image, and it can't tell Flare from Sunburst.

Client-side observations alone can't prove or disprove the hypothesis.

## How it was tested

- **Real built-in tool.** `codex exec` ran the session model, which called `tools.image_gen__imagegen({prompt})`. I did not call the image API myself.
- **Capture.** I added one CLI flag, `-c openai_base_url="http://127.0.0.1:8787"` (the documented "Base URL override for the built-in `openai` model provider", [config_toml.rs#L424-L425](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/config/src/config_toml.rs#L424-L425)). It routed Codex through a local logging proxy that forwarded to `https://chatgpt.com/backend-api/codex`.
  - The proxy wrote down request and response bodies and every response header.
  - It redacted `Authorization`, `ChatGPT-Account-ID`, and cookies.
  - It refused the WebSocket upgrade, so Codex fell back to HTTP/SSE.
  - On some runs it overwrote the `model` field in the image request; everything else in the request stayed as Codex sent it.
- **No permanent changes.** `~/.codex/config.toml` and `auth.json` were not modified (their mtimes are 09-29 and 09-28).
- **No paid API calls.** `auth.json` has `OPENAI_API_KEY: null`, and no `OPENAI_*` variable is set, so step 7 (comparing against the direct API) did not apply. All 11 generations counted against the ChatGPT plan: 8 through the built-in tool, 3 against the hosted Responses tool.
- **Tool arguments** were read from the session rollout (`~/.codex/sessions/2026/10/08/rollout-…-01a11809-3f09-7792-944b-e010fc579312.jsonl`). **C2PA** was parsed from the PNG `caBX` chunk with a small JUMBF/CBOR/COSE reader, because exiftool and c2patool are not installed.

## 1. Observed model identifiers

| Identifier | Where it appears | Set by | What it represents |
|---|---|---|---|
| `gpt-image-2` | `const IMAGE_MODEL` in [tool.rs#L58](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/ext/image-generation/src/tool.rs#L58) (0.160.0), also in 0.161.0 and `main` `11da6b9e`. It is the `model` field of every captured `/images/generations` body. | Client, hardcoded | The model the client asks for. Swapping it for other or invalid ids changed nothing visible (§2.3). Its effect on selection is unverified. |
| (absent) | Native `/codex/images/*` responses. Top-level keys are only `created, background, data, output_format, quality, size, usage`, and `data[]` holds only `b64_json, generation_id`. | — | No field names the model that ran. |
| `gpt-image-2-codex` | Hosted Responses route `/codex/responses`: echoed in `response.tools[0].model`. | Server | The echo shows this value for every requested id, including a nonexistent one (§2.4). It never appears in Codex 0.160.0's traffic, binary, or source (§2.1). |
| `imagegen_premium` | `x-codex-active-limit` response header on the native route (1440-minute window). The hosted route reports `premium` (10080 minutes). | Server | Names the quota bucket. The client only recognizes `image_gen` ([tool.rs#L266-L267](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/ext/image-generation/src/tool.rs#L266-L267)). It names no model. |
| `{"name":"ChatGPT","version":"gpt-image"}` | C2PA `c2pa.created.softwareAgent` on every image generated today. | Server (signing service) | A product/family label. It has no version. |
| `{"name":"gpt-image","version":"2.0"}` | The same C2PA field on Codex Desktop images from 2026-09-14, after the 2.5 launch. | Server | This label was dropped server-side between 09-14 and 09-29 (§2.5). |
| `gpt-6-astra` | `response.model` on `/codex/responses` | Client config | The chat model that writes the prompt, not the image model. |

## 2. Evidence

### 2.1 Client source, binary, and traffic [PRIMARY] [OBSERVED]

- **Source.** At `rust-v0.160.0` = [`a956835d`](https://github.com/openai/codex/tree/a956835d020762cb2b570053af06f643a11c0ecc), generate and edit both send `model: IMAGE_MODEL.to_string()` ([tool.rs#L448](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/ext/image-generation/src/tool.rs#L445-L452), [#L492](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/ext/image-generation/src/tool.rs#L488-L496)) with `quality: Auto` and `size: "auto"`.
- **Response parsing.** The client deserializes only `created, data[{b64_json, generation_id}], background, quality, size` ([images.rs#L51-L68](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/codex-api/src/images.rs#L51-L68)). Anything else the server returns is dropped before the rollout or the UI sees it. That is why I needed the proxy.
- **Binary.** In the installed binary, `strings` finds 0 hits for `gpt-image-2-codex`, `gpt-image-2.5`, `sunburst`, `flare-`, `chatgpt-image-latest`, and `imagegen_premium`. `gpt-image-2` sits next to the `ext/image-generation/src/tool.rs` path strings.
- **Repository history.** A full clone of `openai/codex` (all refs) shows `git log --all -S'gpt-image-2-codex'` with 0 commits. The hosted `image_generation` spec that Codex sent from 2026-03-03 until [#31596](https://github.com/openai/codex/commit/a7c72aee8b385486746bfc2b48f5158a47526804) (2026-07-09) never had a `model` field: it was `{"type":"image_generation"}`, then `{"type":"image_generation","output_format":"png"}` ([`2342b2c2` tool_spec.rs](https://github.com/openai/codex/blob/2342b2c2a66b5ac2a07278afb4f5f38700be452e/codex-rs/tools/src/tool_spec.rs#L13-L29)). [PRIMARY]
- **Tools offered to the chat model.** In the captured `/responses` SSE, the `tools` list was only `namespace` entries (`functions`, `clock`, `collaboration`, `mcp__cua_repl`). It had no hosted `image_generation` tool. The image tool is the client-side function `image_gen.imagegen`. [OBSERVED]

**Codex does not rewrite `gpt-image-2` to `gpt-image-2-codex`.** No client version ever contained or sent `gpt-image-2-codex`. Only the server's hosted route emits it.

### 2.2 The built-in tool call, verbatim [OBSERVED]

Tool invocation, from the rollout (`custom_tool_call`, code-mode `exec`):

```js
const result = await tools.image_gen__imagegen({prompt:"A single red apple on a plain white table, soft studio lighting, square photo."});
generatedImage(result);
```

Request on the wire (proxy log, run `baseline1`, 2026-10-07T20:23:55Z):

```json
POST /backend-api/codex/images/generations
originator: codex_exec
user-agent: codex_exec/0.160.0 (Mac OS 26.5.2; arm64) ghostty/1.3.2-main_33da6848d (codex_exec; 0.160.0)
version: 0.160.0
x-codex-image-turn-id: 01a11809-5329-7fc3-80b7-9a09ecf4ee75
authorization / chatgpt-account-id: <redacted>

{"prompt":"A single red apple on a plain white table, soft studio lighting, square photo.",
 "background":"opaque","model":"gpt-image-2","quality":"auto","size":"auto"}
```

Raw response: HTTP 200 after 17.5 s. `b64_json` is replaced with its hash.

```json
{"created":1791404650,"background":"opaque",
 "data":[{"b64_json":"<2,459,344 chars; sha256 76bfdc22…b44a>","generation_id":"45986bb5-4915-4d3d-9268-a25de95b31c5"}],
 "output_format":"png","quality":"low","size":"1254x1254",
 "usage":{"input_tokens":23,"input_tokens_details":{"image_tokens":0,"text_tokens":23},
          "output_tokens":515,"output_tokens_details":{"image_tokens":515,"text_tokens":0},"total_tokens":538}}
```

Every non-generic response header. No other `x-*` header was present.

```text
x-codex-active-limit: imagegen_premium        x-codex-plan-type: prolite
x-codex-imagegen-request-id: 57441d35-a6bd-42fb-aae8-17ac1c117a42
x-oai-request-id:            57441d35-a6bd-42fb-aae8-17ac1c117a42
x-codex-primary-used-percent: 0               x-codex-primary-window-minutes: 1440
x-codex-primary-reset-after-seconds: 86400    x-codex-primary-reset-at: 1791491035
x-codex-primary-over-secondary-limit-percent: 0
x-codex-secondary-used-percent: 0             x-codex-secondary-window-minutes: 0
x-codex-secondary-reset-after-seconds: 0
x-codex-credits-has-credits: False            x-codex-credits-unlimited: False
x-openai-proxy-wasm: v0.1                     server: cloudflare
```

What reached the client: the rollout's `image_gen.generation` item kept only `status`, `revisedPrompt` (the model's own prompt, not a server rewrite), `result`, `transparentBackground: false`, and `savedPath`. `generation_id` and the request id are `#[serde(skip)]`. Debug traces (`RUST_LOG=codex_api=trace,codex_image_generation_extension=trace`) logged the Responses SSE but nothing model-bearing for the image call.

### 2.3 Does the native route honor `model`? Controlled runs [OBSERVED]

All runs used the real built-in tool and the same prompt. In the "`model` sent" column, `baseline` means the value Codex sent itself. Every other value was swapped in by the proxy.

| Run | `model` sent | HTTP | quality | size | out tokens | in tokens | latency | C2PA agent |
|---|---|---|---|---|---|---|---|---|
| baseline ×3 | `gpt-image-2` | 200 | low | 1254x1254 | 515 | 23 | 17.5 / 15.1 / 18.0 s | ChatGPT / gpt-image |
| sunburst | `gpt-image-2.5-sunburst` | 200 | low | 1254x1254 | 515 | 23 | 15.2 s | ChatGPT / gpt-image |
| flare | `gpt-image-2.5-flare` | 200 | low | 1254x1254 | 515 | 23 | 16.1 s | ChatGPT / gpt-image |
| invalid id | `zz-nonexistent-image-model-0` | 200 | low | 1254x1254 | 515 | 23 | 15.4 s | ChatGPT / gpt-image |
| alias | `gpt-image-2-codex` | 200 | low | 1254x1254 | 515 | 23 | 17.1 s | ChatGPT / gpt-image |
| originator `Codex Desktop` (via `CODEX_INTERNAL_ORIGINATOR_OVERRIDE`) | `gpt-image-2` | 200 | low | 1254x1254 | 515 | 23 | 18.5 s | ChatGPT / gpt-image |

- Every run returned the same response keys and the same response-header set, including `x-codex-active-limit: imagegen_premium`.
- Every image hash differs, so these are fresh generations, not a cache.
- Side by side, the images are visually interchangeable. That is circumstantial only.
- **Invalid ids are accepted, and every id gave the same visible result: `gpt-image-2`, `gpt-image-2-codex`, both 2.5 ids, and a nonexistent id.** The response shows no change in model selection. That does not show the server ignores the field. It can't rule out that unknown ids fall back to a default, or that different ids select different models that share token counts and C2PA labels, as Flare and Sunburst share token counts. Third-party controlled probes report the same pattern ([OmniRoute#14617](https://github.com/diegosouzapw/OmniRoute/issues/14617), n=21 with an invalid id; [opencode-gpt-imagegen#107](https://github.com/yuji-hatakeyama/opencode-gpt-imagegen/issues/107)). [SECONDARY]

### 2.4 Where `gpt-image-2-codex` comes from: the hosted Responses route [OBSERVED]

These were direct `POST /backend-api/codex/responses` calls with `tools:[{type:"image_generation", model:X}]`, `tool_choice:{type:"image_generation"}`, `stream:true`, and `store:false`. They are not the built-in tool's path, but this is the route that reports the alias. The `response.completed` echo was identical for every X:

```json
"tools":[{"type":"image_generation","background":"auto","model":"gpt-image-2-codex","moderation":"auto",
          "n":1,"output_compression":100,"output_format":"png","quality":"auto","size":"auto"}]
"tool_usage":{"image_gen":{"input_tokens":27,"output_tokens":515,"output_tokens_details":{"image_tokens":515}}}
```

| X requested | Echoed `model` | Image item |
|---|---|---|
| `gpt-image-2` | `gpt-image-2-codex` | `quality: low`, `size: 1254x1254`, 515 tokens, 20.3 s |
| `gpt-image-2.5-sunburst` | `gpt-image-2-codex` | same, 18.2 s |
| `zz-nonexistent-image-model-0` | `gpt-image-2-codex` | same, 23.2 s |

- The `image_generation_call` item has the keys `id, type, status, action ("generate"), background, output_format, quality, size, result, revised_prompt`. None of them is a model.
- The echoed `model` is therefore not the requested id; the server writes `gpt-image-2-codex` into the normalized tool config. Whether the requested id still affects routing behind that label is not visible. [INFERENCE]
- It is also older than 2.5. It appears in hosted echoes and rate-limit errors from June 2026 onward ("Rate limit reached for gpt-image-2-codex (for limit gpt-image)…", [forum 1382726](https://community.openai.com/t/bug-report-global-rate-limit-exhaustion-4000-rpm-for-gpt-image-2-codex-affecting-most-image-requests/1382726), 2026-06-05; [codex#28723](https://github.com/openai/codex/issues/28723)) and has not been renamed since 2.5 launched. [SECONDARY]
- [INFERENCE] It names a deployment or quota pool. The name alone can't tell you whether that pool's weights changed on 2026-09-08.

### 2.5 Image metadata: EXIF and C2PA [OBSERVED]

- **Chunks.** The PNG has only `IHDR`, `caBX` (21,881 bytes), `IDAT`, and `IEND`. There is no EXIF, `tEXt`, `iTXt`, or XMP.
- **C2PA claim** (`c2pa.claim.v2`): `claim_generator_info.name: "OpenAI Media Service API"`, `org.contentauth.c2pa_rs: "0.79.2"`, `specVersion: "2.2.0"`, `dc:title: "image.png"`.
- **Actions:** `c2pa.created` (`digitalSourceType: trainedAlgorithmicMedia`, `softwareAgent: {"name":"ChatGPT","version":"gpt-image"}`), then `c2pa.converted`, then `c2pa.watermarked.unbound`.
- **Signer:** `CN=OpenAI Media Service, O=OpenAI OpCo, LLC`. The issuer is either Trufo C2PA Claim Signing CA (2025) or SSL.com C2PA ICA R1 2025; both appear on different images.
- No assertion carries a model id or version.

The `softwareAgent` value changed over time with no client change. Timeline from every C2PA-signed image on this machine, using the manifest's own `when` timestamps:

| Generated (manifest `when`, UTC) | Route / originator | `softwareAgent` |
|---|---|---|
| 2026-09-14 11:08–11:12 (6 images) | Codex Desktop 0.154.0-alpha | `gpt-image` / `2.0` |
| 2026-09-29 06:35–10:48 (33 images) | direct native and hosted probes | `ChatGPT` / `gpt-image` |
| 2026-10-07 20:24–20:40 (11 images) | built-in tool (`codex_exec` and `Codex Desktop` originators) and hosted | `ChatGPT` / `gpt-image` |

- **The label was not set by the 2.5 launch.** A third-party count found `gpt-image / 2.0` on Codex PNGs from 08-25 through 09-13 ([code-climb.com](https://code-climb.com/codex-image-generation-images-2-5-check-2026/)) [SECONDARY], and this machine has it on 09-14, after the 09-08 launch. The label also appears on real API Flare and Sunburst output ([codex#45452](https://github.com/openai/codex/issues/45452)) [SECONDARY].
- **The label did not depend on the client.** It became `ChatGPT / gpt-image` between 09-14 and 09-29, for every originator, including `Codex Desktop`.
- **C2PA can't identify the model**, and today it no longer even claims a version.
- `c2pa.watermarked.unbound` (a soft watermark not bound to the manifest) is present from 09-14 onward. The 2.5 system card announces SynthID "through ChatGPT, Codex, and the OpenAI API", but the 2.0 card already promised an imperceptible watermark. No pre-launch Codex PNG exists on this machine to compare against.

### 2.6 The one moving signal: output token counts [PRIMARY formula + OBSERVED/SECONDARY data]

**The formula.** OpenAI's image-generation guide says "The models can use different token counts for the same quality setting", and its calculator code ([GptImageTokenCalculator.react.CzmuucD9.js](https://developers.openai.com/_astro/GptImageTokenCalculator.react.CzmuucD9.js), fetched 2026-10-08) contains:

```js
c={"gpt-image-2":{low:16,medium:48,high:96},"gpt-image-2.5":{low:16,medium:24,high:48,xhigh:64,max:96}}
… let s=o/(i/a),l=Math.floor(s),u=s-l===.5?l+l%2:Math.round(s),d=(t>=n?o:u)*(t>=n?u:o);
return Math.ceil(d*(2e6+t*n)/4e6)
```

Here `o` is the long-side patch count G for the chosen quality. I ran OpenAI's function unchanged on the sizes Codex returns:

| Model, quality (G) | 1024×1024 | 1254×1254 | 1312×1199 |
|---|---|---|---|
| gpt-image-2 low (16) | 196 | 229 | 215 |
| gpt-image-2 medium (48) | 1756 | 2058 | 1887 |
| gpt-image-2.5 low (16) | 196 | 229 | 215 |
| gpt-image-2.5 medium (24) | 439 | **515** | **472** |
| gpt-image-2.5 high (48) | 1756 | 2058 | 1887 |

What the formula shows:

- For 515 tokens at 1254×1254, the only patch count from 1 to 128 that fits is G = 24.
- G = 24 appears only in GPT Image 2.5's ladder, where it is `medium`. No public `gpt-image-2` quality produces 515 at that size: its values are 229, 2058, and 8232.

What the observations show:

- On the same native route before the launch (2026-09-06), a response reported `low / 1254x1254` with **229** output tokens and 23 input tokens, which is G = 16 ([banana-browser@fe880f02](https://github.com/aburkard/banana-browser/blob/fe880f02d4f777cba6137b76728ed6f15d50f25c/docs/plan-quality-investigation-2026-09-06.md)) [SECONDARY, n=1].
- After the launch, the same reported `low / 1254x1254` gives **515** in all 11 of my generations.
- The 09-29 probe report on this machine (`~/Pictures/omp-codex-image-probe/report.html`) recorded 472 image tokens for a `low` apple generation. That set's `low` images are 1312×1199, where 472 also solves to G = 24. [INFERENCE: the report does not print that call's size next to its token count]
- Third-party data after 09-23 is consistent with this (OmniRoute#14617, axiom#114, opencode-gpt-imagegen#107).

Why this is not proof:

- G is a serving parameter. The Codex service runs its own quality ladder: since the launch, Codex `medium` solves to G = 32, which is in **neither** public table (opencode-gpt-imagegen#107: 601 tokens at 1536×1024 and 772 at 1370×1148) [SECONDARY].
- So "low → G = 24" shows that OpenAI changed the Codex serving configuration around the 2.5 launch. It does not show which weights ran.
- Flare and Sunburst share one calculator entry and measured identical counts ([tech.hatada.jp](https://tech.hatada.jp/apps/en/image-bench/)), so tokens can never separate the two variants.
- Latency (15–18 s here for 515 tokens, against 15.3 s for 229 tokens on 09-06) leans the same way, but different prompts, n=1 before the launch, and network overhead confound it.

### 2.7 Official statements [PRIMARY]

- **Codex doc:** "Built-in image generation uses `gpt-image-2` and counts toward your general Codex usage limits." ([learn.chatgpt.com/docs/image-generation](https://learn.chatgpt.com/docs/image-generation), re-read 2026-10-08).
- **Codex pricing:** lists only "GPT-Image-2 (image)" and "(text)" rows.
- **Changelog:** the 2026-10-01 to 10-08 entries have no image items.
- **Announcement:** "Images 2.5 is available to all ChatGPT, ChatGPT Work, and Codex users across desktop, mobile, and web." ([announcement](https://openai.com/index/introducing-chatgpt-images-2-5/)). It maps no product to Flare or Sunburst.
- **Model ids:** No OpenAI document mentions `gpt-image-2-codex`; the full-text indexes of both doc sites return 0 hits.
- **Issues:** No OpenAI member has replied on codex#43965, #45452, #44369, #28723, or #48134 ("Codex serving Image-2 instead of Flare & Sunburst", which has no artifacts).

## 3. Server-side routing: what can and cannot be verified

**Observed:**

- The client always sends `gpt-image-2` and never sends or rewrites to `gpt-image-2-codex` (source, binary, wire capture).
- The native route accepts `gpt-image-2`, `gpt-image-2-codex`, both 2.5 ids, and a nonexistent id, and returns the same visible result for all of them. No change in model selection was visible. Whether the field affects selection is unverified.
- On the hosted route, the tool-config echo reads `gpt-image-2-codex` whatever image model is requested.
- No response body field, header, rollout field, or C2PA assertion names the model that ran.
- The C2PA `softwareAgent` and the token-per-quality ladder were both changed server-side without a client change: the ladder around 09-08, the C2PA label between 09-14 and 09-29.

**Cannot be verified from the client:**

- Whether the weights behind `gpt-image-2-codex` or `imagegen_premium` are gpt-image-2 (`2026-04-21`), Flare, Sunburst, or a Codex-specific snapshot.
- Whether the request `model` field affects selection: unknown ids could fall back to a default, and different ids could reach different models that share the same visible fingerprints (Flare and Sunburst share token counts, and all routes share the C2PA label).
- Whether routing varies by account, plan, prompt, or load. One account (`prolite`) was tested.
- Whether the G = 24 / G = 32 ladder is a 2.5 serving profile or a re-tuned gpt-image-2.

## 4. Confidence and what would settle it

| Claim | Confidence |
|---|---|
| The Codex client requests `gpt-image-2` and never `gpt-image-2-codex` | High (source + binary + wire) |
| `gpt-image-2-codex` is a server-assigned label, not a value the client sends | High (source, binary, wire; the echo is the same for every id, including invalid ones) |
| Invalid `model` ids are accepted, and changing the id produces no visible difference on the native route | High (n=8 here, plus independent controlled probes) |
| The request `model` field has no effect on which model is selected | Unverified (fallback for unknown ids, or different models with identical visible fingerprints, can't be excluded) |
| No client-visible field identifies the effective model | High |
| The serving stack changed at the 2.5 launch toward a 2.5-style token ladder | Medium (one pre-launch data point, from a third party) |
| Codex images are actually rendered by GPT Image 2.5 | Unestablished. [INFERENCE] More likely than not, given OpenAI's "Codex users" rollout statement and the token ladder change, but not shown. |
| Which variant (Flare or Sunburst) | Unknowable with current artifacts |

**Definitive evidence.** The verdict could be settled only by an OpenAI-attested record of the inference snapshot that actually served a request, tied to that request. Any one of these would do:

1. A server response field or header that names the snapshot that served this request. Examples: a `model` or snapshot key in the Images response, or a header returned with `x-codex-imagegen-request-id`.
2. An OpenAI lookup or support answer that resolves a captured `generation_id` or `x-oai-request-id` (for example `45986bb5-…` / `57441d35-…` above) to the snapshot that served it.
3. A signed provenance assertion whose stated meaning is the snapshot that served the request (not a product or version tag), bound to this image.

**Strong but not request-specific.** An OpenAI statement or doc that maps Codex built-in image generation, or `gpt-image-2-codex`, to a specific snapshot. This would settle the documented policy. It would not show that every request follows it, because routing could vary by account, plan, or load.

**Circumstantial only. None of these can confirm the model:**

- A C2PA `softwareAgent.version`, or a content-provenance check (`POST /v1/content_provenance_checks`) returning a versioned `model`. A signature proves only that the signer issued the label. It does not prove that the label describes the inference backend; today's label is `ChatGPT / gpt-image`, and the earlier `2.0` tag also appeared on real API 2.5 output. The provenance check needs an API key and was not run.
- A matched public-API comparison: the same prompts on `gpt-image-2`, Flare, and Sunburst at Codex's size and grid, scored with a perceptual or embedding metric against Codex outputs over many samples. This is statistical, and Flare and Sunburst may not separate. It costs paid API calls, so it was not run.
- Token-ladder matches (§2.6), latency, output size, and visual quality.

## 5. Implications for this repo

- Keep `model: "gpt-image-2"` in `extensions/codex-images.ts`. It matches the official client byte for byte. Changing it produced no visible difference, and any hidden effect is unknown, so the safe choice is to keep matching the client.
- Correction to [gpt-image-2.5-codex.md](gpt-image-2.5-codex.md) §3: the C2PA tag no longer reads `gpt-image / 2.0`. On Codex output generated from 09-29 onward it reads `ChatGPT / gpt-image`. The conclusion stands: C2PA does not identify the model.
- The response `usage` is the only signal that tracks serving changes. If someone needs to re-check routing later, log `quality`, `size`, and `usage.output_tokens`, and solve for G with the calculator formula above.
- `generate_image` now keeps `x-codex-imagegen-request-id`, `generation_id`, and `usage.output_tokens` in its tool details. The request and generation ids are the handles for the only definitive check (§4). Errors name the request id.

## 6. Can the backend return WebP directly? [OBSERVED, 2026-10-08]

Two probes ran on the same account: 8 generations on the native route and 5 on the hosted route.

| Route | Request | Returned | C2PA |
|---|---|---|---|
| Native `/codex/images/generations` and `/edits` | `output_format` `webp`, `jpeg`, or `bogus`; `output_compression: 100`; `Accept: image/webp`; `response_format: b64_json` | Always PNG with HTTP 200. The response's `output_format` reads `png`, which matches the bytes, so the field reports what was produced, not what was asked for. | `caBX` manifest kept |
| Hosted `/codex/responses` `image_generation` tool | `output_format: "webp"`, with compression omitted or set to `100` | Lossless WebP (`VP8L`), 1.28–1.30 MB, about 73% of the PNG control | A `C2PA` RIFF chunk (about 21.9 KB); its hash matches the returned bytes |
| Hosted | `output_format: "webp"`, `output_compression: 50` | Lossy WebP (`VP8 `), 57 KB | kept |
| Hosted | `background: "transparent"`, `output_format: "webp"` | Lossless WebP with real alpha. The server picked `medium` (2058 tokens, 39 s) | kept |

- **The native route can't return WebP.** The extension's local re-encode is the only way to get WebP from it, and the re-encode drops the manifest. A local lossless re-encode of the PNG was 1.21 MB, slightly smaller than the server's WebP.
- **The hosted route can return WebP and keep C2PA.** The trade-offs:
  - It puts a chat model in the loop: `revised_prompt` was verbatim in these runs, but nothing guarantees that.
  - Each call added about 2.3k chat input tokens.
  - It reported `x-codex-active-limit: premium` with a 10080-minute window (20% used), not the native route's daily `imagegen_premium` window, so it appears to draw on the general weekly Codex limit.
  - Only the hosted echo reports `gpt-image-2-codex`. Which model serves the request is no better established on this route.
- Probe details: `/tmp/webp-probe/native/` and `/tmp/webp-probe/HostedWebpProbe/` (temporary).
