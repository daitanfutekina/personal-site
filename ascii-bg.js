/*
 * ascii-bg.js - animated ASCII Voronoi background (WebGL2, no dependencies).
 *
 * Model: a flat-shaded Voronoi field. Each cell gets one grey level, pushed hard toward
 * black so about half the cells vanish. Cell feature points swing on a slow sine, so
 * borders slide and cells brighten or dim (the "ebb"). A slight blur and a 30-step glyph
 * ramp turn that into character runs, with transition glyphs where cells meet.
 *
 * Pass 1 renders one texel per character cell: R = grey, G/B = grey sampled left/right
 * (chromatic offset). Pass 2 draws glyphs from a canvas-built atlas; the left/right
 * difference tints edge glyphs with the site palette.
 */
var RAMP = " .'\":;!|/\\?Iiclkxw*oXHG4$8#%@B"; // 30 glyphs, sparse -> dense

var VERT = '#version 300 es\n' +
  'void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));' +
  'gl_Position=vec4(p*2.-1.,0.,1.);}';

var FIELD_FRAG = '#version 300 es\nprecision highp float;\n' +
'uniform vec2 uCell,uRes,uGrid;uniform float uT,uDpr,uMouseAmt,uRectAmt,uRectPush,uCells;\n' +
'uniform vec2 uMouse;uniform vec4 uRect;out vec4 o;\n' +
'float h13(vec3 p){p=fract(p*.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}\n' +
'vec2 h23(vec3 p){p=fract(p*vec3(.1031,.103,.0973));p+=dot(p,p.yzx+33.33);return fract((p.xx+p.yz)*p.zy);}\n' +
'float tri(float a){a+=.25;return 4.*abs(a-floor(a+.5))-1.;}\n' +
// Flat-shaded Voronoi: grey level of the cell containing c.
'float vor(vec2 c){\n' +
' vec2 iu=floor(c),fu=fract(c);float md=9.;vec2 bp=vec2(0),bc=vec2(0);\n' +
' for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){\n' +
'  vec2 n=vec2(i,j),pos=iu+n;\n' +
'  vec2 p=sin(uT*.64+6.2832*h23(vec3(pos,0.)))*.5+.5;\n' +
'  float d=length(n+p-fu);\n' +
'  if(d<md){md=d;bp=p;bc=pos;}\n' +
' }\n' +
' float g=abs(tri(h13(vec3(bc,0.))+dot(bp,vec2(.25))));\n' +
' return pow(g,4.22);\n' +
'}\n' +
// Warp the sample point away from the mouse and the open-dropdown rectangle.
'float field(vec2 P){\n' +
' vec2 d=P-uMouse;float r=170.*uDpr,f=1.-smoothstep(0.,r,length(d));\n' +
' P-=normalize(d+1e-3)*f*f*60.*uDpr*uMouseAmt;\n' +
' float clr=1.;\n' +
' if(uRectAmt>.001){\n' +
'  vec2 c=(uRect.xy+uRect.zw)*.5,hs=(uRect.zw-uRect.xy)*.5,dq=P-c,qq=abs(dq)-hs,qo=max(qq,0.);\n' +
'  float sd=length(qo)+min(max(qq.x,qq.y),0.);\n' +
'  vec2 nr=sign(dq)*qo;float nl=length(nr);nr=nl>1e-3?nr/nl:normalize(dq+1e-3);\n' +
'  P-=nr*uRectPush*uRectAmt*pow(1.-smoothstep(0.,220.*uDpr,sd),2.);\n' +
'  clr=1.-uRectAmt*(1.-smoothstep(0.,40.*uDpr,sd));\n' +
' }\n' +
' return vor(P/uRes.x*uCells)*clr;\n' +
'}\n' +
'float blur(vec2 P,vec2 s){\n' +
' return field(P)*.25+(field(P+vec2(s.x,0))+field(P-vec2(s.x,0))+field(P+vec2(0,s.y))+field(P-vec2(0,s.y)))*.125\n' +
'  +(field(P+s)+field(P-s)+field(P+vec2(s.x,-s.y))+field(P-vec2(s.x,-s.y)))*.0625;\n' +
'}\n' +
'void main(){\n' +
' vec2 cell=floor(gl_FragCoord.xy);\n' +
' vec2 P=vec2(cell.x+.5,uGrid.y-cell.y-.5)*uCell;\n' + // y down, cell centre
' vec2 s=uCell/4.;\n' +
' vec2 ab=vec2(uCell.x*.45,uCell.y*.2);\n' + // small offset: only the edge glyph itself is tinted
' o=vec4(blur(P,s),blur(P-ab,s),blur(P+ab,s),1.);\n' +
'}';

var GLYPH_FRAG = '#version 300 es\nprecision highp float;\n' +
'uniform sampler2D uField,uAtlas;uniform vec2 uCell,uRes,uGrid;uniform float uT,uN;out vec4 o;\n' +
'const vec3 PAL[4]=vec3[4](vec3(1.,.42,.42),vec3(.482,.894,.584),vec3(.365,.678,.925),vec3(1.,.902,.427));\n' +
'void main(){\n' +
' vec2 pd=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y),cf=pd/uCell,cell=floor(cf),l=cf-cell;\n' +
' vec4 t=texelFetch(uField,ivec2(cell.x,uGrid.y-1.-cell.y),0);\n' +
' float g=(t.r*2.+t.g+t.b)/4.;\n' +
' float idx=floor(clamp(g,0.,.9999)*uN);\n' +
' float m=texture(uAtlas,vec2((idx+l.x)/uN,l.y)).r;\n' +
// Oil-slick edges: hue runs continuously through the palette loop across the fringe
// (signed left/right difference), drifting along the screen and over time.
' float fr=clamp((t.g-t.b)*3.,-1.,1.);\n' +
// The hue sweeps across the glyph's own pixels (l = position inside the cell), so one
// edge character carries the whole sheen, like light on an oil film.
' float hu=fract(l.x*.55+l.y*.4+fr*.25+(cell.x*.011+cell.y*.019)+uT*.08)*4.;\n' +
' int i=int(hu);vec3 pc=mix(PAL[i],PAL[(i+1)%4],fract(hu));\n' +
' vec3 col=mix(vec3(.9)*(.55+.45*sqrt(g)),pc,smoothstep(.3,.6,abs(fr))*.9);\n' +
' o=vec4(col*m,1.);\n' +
'}';

function compile(gl, type, src) {
  var s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function makeProgram(gl, frag) {
  var p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (var i = 0; i < n; i++) {
    var name = gl.getActiveUniform(p, i).name;
    u[name] = gl.getUniformLocation(p, name);
  }
  return { prog: p, u: u };
}

function createAsciiBackground(canvas, options) {
  var noop = { setRepelRect: function () {}, clearRepelRect: function () {}, setPaused: function () {}, destroy: function () {} };
  var opts = options || {};
  var cellW = opts.cellWidth || 9, cellH = opts.cellHeight || 18, maxDpr = opts.maxDpr || 2;
  var cellsAcross = opts.cellsAcross || 10; // recomputed in resize() unless set

  var gl = null, pField, pGlyph;
  try {
    gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance' });
    if (!gl) return noop;
    pField = makeProgram(gl, FIELD_FRAG);
    pGlyph = makeProgram(gl, GLYPH_FRAG);
  } catch (err) {
    canvas.dataset.asciiError = err && err.message ? err.message : 'WebGL initialization failed';
    return noop; // no WebGL2 / shader failure: stay plain black
  }

  var vao = gl.createVertexArray();
  var fieldTex = null, fbo = gl.createFramebuffer(), atlasTex = gl.createTexture();
  var lastCw = 0, W = 0, H = 0, dpr = 1, cw = 0, ch = 0, cols = 0, rows = 0, atlasKey = '';

  function buildAtlas() {
    var c = document.createElement('canvas');
    c.width = RAMP.length * cw;
    c.height = ch;
    var g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    var fp = Math.round(ch * 0.62);
    g.font = '600 ' + fp + 'px Consolas, "Courier New", ui-monospace, Menlo, monospace';
    var sx = Math.min(1, cw / (g.measureText('W').width * 1.05));
    g.setTransform(sx, 0, 0, 1.25, 0, 0); // narrow, tall glyphs like the reference
    for (var i = 0; i < RAMP.length; i++) g.fillText(RAMP[i], (i + 0.5) * cw / sx, ch * 0.5 / 1.25);
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  function resize() {
    var r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    var w = Math.max(1, Math.round((r.width || window.innerWidth) * dpr));
    var h = Math.max(1, Math.round((r.height || window.innerHeight) * dpr));
    // Small screens: smaller glyphs and fewer, relatively larger shapes.
    var cssW = w / dpr, small = cssW < 760;
    if (!opts.cellsAcross) cellsAcross = Math.max(3.5, Math.min(10, cssW / 150));
    cw = Math.max(4, Math.round((small && !opts.cellWidth ? 7 : cellW) * dpr));
    ch = Math.max(6, Math.round((small && !opts.cellHeight ? 14 : cellH) * dpr));
    var gridChanged = w !== W || h !== H || cw !== lastCw;
    lastCw = cw;
    if (gridChanged) {
      W = w; H = h;
      canvas.width = W; canvas.height = H;
      cols = Math.ceil(W / cw); rows = Math.ceil(H / ch);
      if (fieldTex) gl.deleteTexture(fieldTex);
      fieldTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, fieldTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fieldTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    var key = cw + 'x' + ch;
    if (key !== atlasKey) { atlasKey = key; buildAtlas(); }
  }

  // Interaction state (device px, y down, relative to the canvas).
  var t = 40, last = 0, raf = 0, paused = false, destroyed = false;
  var mouse = { x: -1e4, y: -1e4, tx: -1e4, ty: -1e4, amt: 0, target: 0, seen: false };
  var rect = { x0: 0, y0: 0, x1: 0, y1: 0, tx0: 0, ty0: 0, tx1: 0, ty1: 0, amt: 0, target: 0, push: 120 };

  function onMove(ev) {
    var r = canvas.getBoundingClientRect();
    mouse.tx = (ev.clientX - r.left) * dpr;
    mouse.ty = (ev.clientY - r.top) * dpr;
    if (!mouse.seen) { mouse.x = mouse.tx; mouse.y = mouse.ty; mouse.seen = true; }
    mouse.target = 1;
  }
  function onLeave() { mouse.target = 0; }
  function onUp(ev) { if (ev.pointerType !== 'mouse') onLeave(); } // a finger lifting ends the warp
  function onResize() { resize(); }
  window.addEventListener('pointermove', onMove);
  document.documentElement.addEventListener('pointerleave', onLeave);
  window.addEventListener('blur', onLeave);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('resize', onResize);

  function ease(dt, tau) { return 1 - Math.exp(-dt / tau); }

  function frame(now) {
    raf = 0;
    if (destroyed || paused) return;
    var dt = Math.min(Math.max((now - last) / 1000, 0), 0.1);
    last = now;
    t += dt;
    var k = ease(dt, 0.13);
    mouse.x += (mouse.tx - mouse.x) * ease(dt, 0.12);
    mouse.y += (mouse.ty - mouse.y) * ease(dt, 0.12);
    mouse.amt += (mouse.target - mouse.amt) * ease(dt, 0.3);
    rect.amt += (rect.target - rect.amt) * k;
    rect.x0 += (rect.tx0 - rect.x0) * k; rect.y0 += (rect.ty0 - rect.y0) * k;
    rect.x1 += (rect.tx1 - rect.x1) * k; rect.y1 += (rect.ty1 - rect.y1) * k;
    draw();
    raf = requestAnimationFrame(frame);
  }

  function draw() {
    gl.bindVertexArray(vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, cols, rows);
    var u = pField.u;
    gl.useProgram(pField.prog);
    gl.uniform2f(u.uCell, cw, ch);
    gl.uniform2f(u.uRes, W, H);
    gl.uniform2f(u.uGrid, cols, rows);
    gl.uniform1f(u.uT, t);
    gl.uniform1f(u.uDpr, dpr);
    gl.uniform1f(u.uCells, cellsAcross);
    gl.uniform2f(u.uMouse, mouse.x, mouse.y);
    gl.uniform1f(u.uMouseAmt, mouse.amt);
    gl.uniform4f(u.uRect, rect.x0, rect.y0, rect.x1, rect.y1);
    gl.uniform1f(u.uRectAmt, rect.amt);
    gl.uniform1f(u.uRectPush, rect.push * dpr);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    u = pGlyph.u;
    gl.useProgram(pGlyph.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fieldTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.uniform1i(u.uField, 0);
    gl.uniform1i(u.uAtlas, 1);
    gl.uniform2f(u.uCell, cw, ch);
    gl.uniform2f(u.uRes, W, H);
    gl.uniform2f(u.uGrid, cols, rows);
    gl.uniform1f(u.uT, t);
    gl.uniform1f(u.uN, RAMP.length);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function start() {
    if (!raf && !destroyed && !paused) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  resize();
  start();

  return {
    // CSS px relative to the canvas top-left (the viewport, for a fixed full-screen canvas).
    setRepelRect: function (x, y, w, h, strength) {
      var s = strength == null ? 1 : strength;
      rect.tx0 = x * dpr; rect.ty0 = y * dpr; rect.tx1 = (x + w) * dpr; rect.ty1 = (y + h) * dpr;
      if (rect.amt < 0.01) { rect.x0 = rect.tx0; rect.y0 = rect.ty0; rect.x1 = rect.tx1; rect.y1 = rect.ty1; }
      rect.push = 120 * s;
      rect.target = 1;
    },
    clearRepelRect: function () { rect.target = 0; },
    setPaused: function (p) { paused = !!p; if (!paused) start(); },
    destroy: function () {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', onResize);
      var lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  };
}

export { createAsciiBackground };
