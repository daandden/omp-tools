# Tern views

Rules shared by every omp-tools view in Tern: the Picker, the `/btw` panel,
and the English coach panel. In terminals that speak the Tern Surface
Protocol, OMP calls `describe(cx)` instead of `render()`.

- A scrolling region is a `scrollBox` (`ask-editor.ts`), a capped `list`,
  because a `col` with `max.h` only clips. Put the `scroll` request on the
  content: Tern scrolls the scroller at or above the asking node, and the
  list's scroller is inside the list node.
- Tern's sheets style only `omp.*` roles, so each view sends its own sheet
  (the `s` verb) with every `describe` when `cx.feature("styles")`: the
  Picker's `NATIVE_SHEET`, `omp-tools-btw`, and `omp-tools-english-coach`. A
  sheet belongs to one surface, and pi-tui opens a new inline surface on
  `gone` with the same describe context, so a once-only send is lost.
- Every sheet goes out through `sheetMessage` (`tern-theme.ts`), which leads
  it with the omp theme rules. On each omp-tools root (an `omp.editor` or
  `omp.overlay.*` column holding an `omp-tools.*` role, so the composer and
  native `/btw` keep Tern's look) it sets Tern's palette variables (`--t*`,
  `--l*`, `--accent`, `--sf-*`, `--sf-c-*`) and the background from the active
  omp `theme`: `selectedBg` for the surface, `toolDiffAdded` and
  `toolDiffRemoved` for `ins` and `del`. An empty `text` token leaves Tern's
  `--t1`. The rules are rebuilt when the theme instance changes. A doubled
  `.sf-col` outranks Tern 0.9.26's chat-reader rule that washes overlays with
  white. A view's root therefore needs an `omp-tools.*` role in every state.
- Tern scopes a program sheet to strict descendants of its region, so a rule
  on `.sf-region` never applies (Tern 0.9.5).
- Tern's Markdown hangs list numbers 2 cells left of the text, where a scroll
  box clips them, so `SCROLL_BOX_CSS` pads each `scrollBox` scroller 2 cells
  left and cancels it with a negative margin.
- Tern draws with its own CSS engine (stencil), not a browser. `position:
  absolute` with `right` and `bottom` works; the logical `inset-inline-end`
  and `inset-block-end` are ignored (Tern 0.9.26). Prefer physical properties
  in sheets.
