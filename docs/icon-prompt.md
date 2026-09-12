# Icon prompt

`build/icon.png` was generated with this prompt through `codex exec`, which has
an image tool. `build/icon-handdrawn.png` is the earlier programmatic version,
kept as a fallback.

Note that `-m astra` is rejected on a ChatGPT account — _"The 'astra' model is
not supported when using Codex with a ChatGPT account"_ — so this went through
the default model's image tool instead.

Regenerating: run the prompt, save over `build/icon.png` at 1024×1024, then
rebuild `icon.icns` with `sips` and `iconutil`.

## What the first attempt got wrong

Worth keeping, because a fresh generation will likely repeat them:

1. **A glossy highlight** — a soft white streak across the top-right, despite
   the prompt asking for flat. Flattening it afterwards made it worse: the soft
   gradient became a hard white crescent that read as a rendering bug.
2. **8,104 distinct colours** where the brief said two.
3. **Illegible at 32×32.**

Naming those three failures explicitly in a second prompt fixed all of them, so
the prompt below includes them.

## The prompt

> A macOS application icon, 1024×1024, for a developer tool called **Loupe**
> that inspects where an AI coding session's tokens and cache were spent.
>
> **Form.** A rounded-square app tile in the modern macOS style — a squircle
> with a corner radius roughly 22% of the tile, flat, no bevel, no drop shadow,
> no reflection, no 3D. Leave about 9% clear margin on all sides so the tile
> does not touch the canvas edge. Transparent background outside the tile.
>
> **Colour.** The tile is a single flat terracotta orange, `#C15F3C`. The mark
> on it is a warm off-white, `#FAF9F8`. Two colours only. No gradients, no
> glow, no additional accent colours.
>
> **Mark.** A magnifier — a bold circular lens outline with a short straight
> handle leaving the lower right at 45°, with rounded stroke ends. The stroke
> is heavy and even, roughly 6% of the tile width. Inside the lens sit two
> short horizontal rounded bars of unequal length, stacked, reading as a tiny
> bar chart: what the magnifier is examining is a measurement, not text. The
> lens sits slightly above and left of centre so the handle is fully contained
> within the tile.
>
> **Character.** Restrained, precise, editorial. A measuring instrument, not a
> search box. It should sit comfortably beside native macOS developer tools —
> closer to a Things or Linear icon than to a consumer app. Flat vector, crisp
> geometry, no texture, no noise, no text or lettering anywhere.
>
> **Constraint.** It must stay legible at 32×32: few elements, thick strokes,
> generous spacing between the bars inside the lens.
>
> **Do not**: add a specular highlight, sheen, reflection or any lighting; use
> more than two colours; use a gradient, blur or texture; render it in 3D. Think
> of a crisp vector logo exported flat, like the Linear or Things icon.

## Why these constraints

- **`#C15F3C`** is the accent this app already uses throughout. The name no
  longer says Claude, but the tool is for Claude Code, and the colour is the
  cue that says so without borrowing the trademark.
- **Two colours, flat** matches how the rest of the interface is drawn.
- **Legible at 32×32** is the constraint most generated icons fail. The first
  version of the hand-drawn icon had three bars inside the lens and they merged
  into a smudge at that size; two thicker bars survive.
- **No lettering** because an icon with a word in it stops working the moment
  it is small, and cannot be localised.
