# Prompt patterns for generate_image

Fill the brackets and drop lines that don't help. Sources are in `docs/research/image-prompting-*.md` in the omp-tools repo.

## Templates

**Product**
```
Studio product photo for [purpose] of [product: material, color, finish] on [surface].
[Lighting setup and direction]. [Angle] showing [key feature]; sharp focus on [detail].
[Orientation + ratio], [space left for copy, if any]. No text, no watermark, no extra logos.
```

**Portrait**
```
Photorealistic [framing: close-up / waist-up / full body, feet included] portrait of [person details],
[expression and gaze], in [setting]. [One lens cue], [depth of field], [light source and direction].
[Palette or film look]. Real skin texture, no retouching. [Orientation + ratio].
```

**Illustration or sticker**
```
A [style/medium] illustration of [subject] [doing X]. [Line and shading traits], [palette].
[Background, or: everything outside the outline fully transparent]. [Ratio]. No text.
```

**Icon** (set `transparent_background` when it goes on a UI)
```
A single [flat / 3D] icon of [object], [stroke weight, corner radius], [palette],
centered with generous padding, square. Fully transparent background. No text, no shadow.
```

**Logo**
```
Original logo for "[Name]", a [business]. [Mark idea]. Simple, strong silhouette,
flat vector shapes, [palette], legible when small. Centered, square.
The name "[Name]" appears exactly once in [type traits] below the mark. No other text.
```

**Diagram or infographic**
```
[Artifact type] titled "[Title]" for [audience]. [Flow direction]: "[Node 1]" → "[Node 2]" → "[Node 3]"
in [shape] with arrows. [Visual system: flat vector, one accent color]. Readable sans-serif labels,
white background. [Ratio]. No other text, no decoration.
```

**UI mockup**
```
Screenshot of a shipping [platform] app screen for [product]: [layout top to bottom],
[real elements with real labels], [visual style and palette]. Crisp UI text. [Device-shaped ratio].
```

**Edit**
```
Edit image 1: [one change, naming exactly what changes].
Keep [identity, layout, framing, camera angle, lighting, labels, other objects] unchanged.
```

**Multi-reference**
```
Image 1: [role, e.g. base scene]. Image 2: [role, e.g. object to insert / style reference only].
[What moves where, using left/right/foreground]. Match [lighting, perspective, scale, shadows].
Change nothing else.
```

## Before → after

| Rule | Before | After |
|---|---|---|
| Purpose, then scene and subject | `a coffee mug` | `Landing-page hero image. A matte white ceramic coffee mug on a pale oak table, soft window light from the left, clean product photography, wide 3:2 composition with empty space on the right for copy. No text, no logos, no watermark.` |
| Leave a vague request unpadded | user: "red fox logo" → `…fox in a forest with a moon and the slogan "Wild at heart"` | `Original minimal logo mark of a red fox head, flat vector shapes, strong silhouette, generous padding, centered, square. No text.` |
| Concrete words, not praise | `8K ultra-detailed portrait, 85mm f/1.4, beautiful lighting` | `Photorealistic candid photo of a baker at dawn, flour on weathered hands, natural window light from the left, shallow depth of field, unposed, no retouching.` |
| Describe what fills the frame | `a street with no cars or people` | `A quiet, empty cobblestone lane at dawn, shutters closed, puddles reflecting the sky. No text, no watermark.` |
| Text: quote, style, count | `poster that says grand opening` | `Poster with the headline "GRAND OPENING" exactly once, bold white sans-serif on one line, centered in the top third. No other text.` |
| Shape in words | `banner of mountains` | `Wide 16:9 landscape banner of misty mountains at sunrise, horizon in the lower third, open sky on the left for a headline.` |
| Transparency in the prompt | flag set, prompt: `a sticker of a cat on a pink background` | `One die-cut sticker of a grinning orange cat with a cream border; everything outside the border fully transparent. No backdrop, checkerboard, shadow, or text.` |
| Roles for references | `combine these` | `Image 1 is the base room photo; image 2 is the lamp to insert. Place the lamp from image 2 on the left nightstand in image 1, matching lighting, perspective, and scale. Change nothing else.` |
| Style-only reference | `Make a poster like this with a fox.` | `Create a new poster. Image 1 is a style reference only: copy its palette, paper texture, and ink linework. Subject: a red fox on a snowy hill. No text.` |
| One change plus keep list | `A sunny living room with a grey sofa, oak floor, plants…` (rewritten scene) | `Edit image 1: replace only the grey sofa with a brown leather chesterfield. Keep the pillows, floor, plants, lighting, shadows, camera angle, and framing unchanged.` |
| Lock identity | `Put her in a red dress.` | `Edit image 1: dress the woman in the red dress from image 2. Keep her face, features, skin tone, hair, expression, body shape, and pose unchanged; match the original lighting; keep the background and framing.` |
| Text edit | `Translate to Spanish.` | `Replace "Boiler" with "Caldera" and "Water Tank" with "Depósito de agua". Change only the text; keep typography, placement, and spacing.` |
| Series consistency | `the fox again, now in winter` | `Same fox as image 1: russet fur, white-tipped tail, green scarf, watercolor with soft outlines. Now standing in fresh snow at dusk. Keep face, proportions, and palette unchanged.` |
| One fix per retry | `Redo it with warmer light, different pose, and no lamp.` | `Edit image 1: remove only the floor lamp. Keep everything else unchanged.` |
