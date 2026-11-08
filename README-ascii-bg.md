# ascii-bg

Animated ASCII crystal background. Vanilla JS + WebGL2, no build step, no dependencies.

## Use

```html
<canvas id="bg" style="position:fixed;inset:0;width:100%;height:100%"></canvas>
<script type="module">
  import { createAsciiBackground } from './ascii-bg.js';

  const bg = createAsciiBackground(document.getElementById('bg'));
</script>
```

Give the canvas a CSS size; the backing store follows it and `devicePixelRatio` (capped at 2).

## API

`createAsciiBackground(canvas, options)` returns:

- `setRepelRect(x, y, w, h, strength = 1)` - push shapes out of a rectangle (CSS px, relative to
  the canvas top-left). Eases in over ~400 ms. Re-calling moves the rectangle smoothly.
- `clearRepelRect()` - ease the rectangle out.
- `setPaused(bool)` - stop or resume rendering.
- `destroy()` - remove listeners and release the GL context.

Options: `cellWidth` (8), `cellHeight` (14), `maxDpr` (2).

Without WebGL2 the call returns no-op methods and the canvas stays plain black. The mouse
warp needs no setup; the canvas may have `pointer-events: none` (the window is listened to).
