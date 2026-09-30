# Prompt criteria taken from creative briefs and art direction

Researched 2026-09-30. This builds on `docs/research/image-prompting-{openai,editing,craft}.md` and does not repeat their text, lighting, negation, or edit rules. Mapping a brief component to a prompt property is [INFERENCE] unless marked otherwise.

## 1. Criteria

| # | Criterion (checkable prompt property) | Priority / trigger | Rationale | Source |
|---|---|---|---|---|
| C1 | Names the deliverable and where it will be seen (medium, placement). | MUST | Briefs start with the objective and its context. The AOI says to state how the artwork will be used. Keep the use; drop licence, territory, and duration. | [PRIMARY] [AIGA] [AOI] [ASMP] |
| C2 | Names one primary subject or message, first. Every other element is explicitly secondary. | MUST | IPA asks for a "single-minded" objective. ASMP asks to "prioritize the views in order of importance". Material asks for "an iconic point of focus… a few meaningful elements". | [PRIMARY] [IPA] [ASMP] [M1-IMG] |
| C3 | Every user mandatory appears, and no unrequested element is added. | MUST | The AOI says to communicate a required visual "as accurately as possible" and to give "any and all restrictions" at the outset. IPA mandatories must be written down. | [PRIMARY] [AOI] [IPA] |
| C4 | The shape follows from C1's placement. | MUST | Briefs give printed size and layout. The tool has no size argument, so the prompt carries the shape. | [PRIMARY] [AOI] |
| C5 | Tone appears as visible properties (light, palette, expression, density), not only adjectives. | WHEN the user gives a mood, tone, or brand values | IPA asks "what brand/tonal values are required?" OpenAI asks for concrete visual language. | [PRIMARY] [IPA] [OAI-P] |
| C6 | Names an empty, plain region for later copy or UI, with its position. | WHEN copy, UI, or platform chrome will be overlaid | The AOI lists "space for typography". Material uses scrims for text over images. Meta uses safe zones. | [PRIMARY] [AOI] [M1-IMG]; [SECONDARY] [META] |
| C7 | Does not ask for an existing logo, badge, or trademark to be redrawn. Its area is left clear for the official artwork. | WHEN a real brand mark is needed | "Use only the badge artwork provided… Don't modify." OpenAI lists brand consistency as a known weakness. | [PRIMARY] [APB] [OAI-L] |
| C8 | Gives brand colors as name plus hex and describes the typeface by its traits. | WHEN a brand guide or palette exists | Identity guidelines are the first mandatory IPA lists. The hex and trait technique is in craft.md. | [PRIMARY] [IPA] |
| C9 | Keeps long or legal copy out of the render; it is added in post. | WHEN mandatory copy is long or small | IPA mandatories include "legal copy which must be used". WCAG prefers real text over images of text. | [PRIMARY] [IPA] [WCAG] [OAI-L] |
| C10 | Lists the routes the user rejected as closing exclusions. | WHEN dislikes were named or earlier results failed | IPA asks which creative routes "turned out to be cul-de-sacs", and whether anyone "has a thing about 'yellow'". | [PRIMARY] [IPA] |
| C11 | A photo prompt gives the vantage point, time of day, light sources by type, the people and props present, and the scene condition (no clutter, signage, or debris). | WHEN the medium is photography | The ASMP assignment checklist covers these; see [ASMP]. | [PRIMARY] [ASMP] |
| C12 | A set repeats one shared spec word for word, one shot per call, with each shot's number and its differences. | WHEN several images form a set | ASMP counts views. Apple requires a "consistent size, level of detail, stroke thickness… and perspective". | [PRIMARY] [ASMP] [HIG-I] |
| C13 | An icon prompt states one concept, few simple shapes, a consistent stroke and perspective, centered content with padding, and a plain or gradient background. It has no text unless essential, no photos, no hairlines or sharp corners, and no baked-in gloss or shadow on app icons. | WHEN the output is an icon | These properties come from Apple HIG icon guidance and Material icon guidance (live area, 2dp stroke, top-down view). | [PRIMARY] [HIG-I] [HIG-A] [M1-ICON] |
| C14 | Rendered text and meaningful marks get a named color on a named, contrasting plain area. Meaning never relies on color alone. | WHEN the image contains text, charts, diagrams, or UI | WCAG 1.4.1, 1.4.3 (4.5:1, or 3:1 for large text), and 1.4.11 (3:1 for graphics). The ratios can only be checked after generation. | [PRIMARY] [WCAG] |
| C15 | In-image text is limited to what is essential. | SHOULD | WCAG 1.4.5. Apple: icon text "doesn't support accessibility or localization". | [PRIMARY] [WCAG] [HIG-A] |
| C16 | People fit the stated audience without stereotypes. Figures are gender-neutral where identity doesn't matter. | WHEN people appear and the audience is known | Briefs define the audience. Apple: "Prefer depicting gender-neutral human figures". | [PRIMARY] [AIGA] [HIG-I] |
| C17 | A shopping image is an edit of a real product photo, with no overlays or border, and the product fills 75–90% of the frame. | WHEN the destination is a product listing | Google Merchant rejects "illustrations that don't depict the physical product" and overlays, and requires AI metadata. | [PRIMARY] [GMC] |

**Brief items that stay out of the prompt:** budget, schedule, approvals, and licensing. The objective and success measures belong in the review step. Format, resolution, color profile, and vector output are outside the tool's control, so report them as limits.

## 2. Conflicts

- **Open brief vs. a complete prompt.** AIGA: "a brief is not a blueprint". The model interprets the prompt but can't ask questions. The SKILL L23 rule (add only framing and polish) already leaves the right room. C3 and C16 add attributes only when the user supplied the audience or guide.
- **AIGA "questions early" vs. SKILL L8 "generate right away".** A missing mandatory (exact copy, brand file, product photo for C17) is the one case where generating first wastes a call. The maintainer needs to decide whether this is an exception.
- **Brief adjectives vs. SKILL L26 concrete descriptions.** C5 reconciles the two. The skill doesn't mention the translation from adjectives to visible properties.
- **Mandatory copy vs. SKILL L31 "keep it short".** C9 moves long copy to post.
- **Safe-zone percentages vs. snapped output sizes.** Describe the region (C6) and crop afterwards (L69).
- **Icon specs vs. raster output.** Apple and Material expect vector, layered, unmasked art. Only the visual properties in C13 can be met.
- **Exclusions.** SKILL L20 lists generic artifact classes. Briefs add exclusions specific to the user (C10). Both belong in the closing list.

## 3. Gaps in the current SKILL.md

- No focal-point or priority rule (C2).
- No reserved copy or UI space (C6).
- No brand mandatories: palette hex plus name, logos composited rather than redrawn, long copy handled in post (C7–C9).
- No step for turning tone into visible properties (C5).
- No icon spec (C13).
- No accessibility rules: contrast pairing, meaning conveyed by color alone, keeping text essential (C14–C15).
- Consistency for sets appears only under edits (L52). New sets are not covered (C12).
- No check of the destination's policy (C17).
- Review (L63) doesn't check the result against the brief: C1's objective, C3's mandatories, and C14's contrast.
- No rule for reporting what can't be delivered (vector, exact pixel size, official logos).

[AIGA]: https://openlab.citytech.cuny.edu/amistry-eportfolio/files/2019/05/AIGA-Busines_Ethics-47556721-Client-s-guide-to-design-1-1-MB.pdf "AIGA client's guide, pp. 26–27; mirror, aiga.org 403"
[IPA]: https://www.acaweb.ca/en/wp-content/uploads/sites/2/2016/09/THE-CLIENT-BRIEF-FINAL-Eng-July-18-06.pdf
[AOI]: https://theaoi.com/resources/professional-practice/guide-to-commissioning/
[ASMP]: https://static1.squarespace.com/static/58d536e946c3c434504fb094/t/5a31bd6c8165f59567a50a22/1513209197040/arch_working_with.pdf
[HIG-I]: https://developer.apple.com/design/human-interface-guidelines/icons
[HIG-A]: https://developer.apple.com/design/human-interface-guidelines/app-icons
[APB]: https://developer.apple.com/app-store/marketing/guidelines/
[M1-ICON]: https://m1.material.io/style/icons.html
[M1-IMG]: https://m1.material.io/style/imagery.html
[WCAG]: https://www.w3.org/TR/WCAG22/
[GMC]: https://support.google.com/merchants/answer/6324350?hl=en
[META]: https://www.facebook.com/business/ads/facebook-instagram-reels-ads "percentages via secondary aggregators; placement pages need login"
[OAI-P]: https://developers.openai.com/api/docs/guides/image-prompting
[OAI-L]: https://developers.openai.com/api/docs/guides/image-generation#limitations
