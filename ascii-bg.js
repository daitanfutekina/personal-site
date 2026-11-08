/*
 * ascii-bg.js - animated ASCII crystal background (WebGL2, no dependencies).
 *
 * Pass 1 renders a faceted, ebbing Voronoi height field into a tiny framebuffer
 * (one texel per character cell). Pass 2 draws glyphs from a canvas-generated
 * atlas, with edge-aware glyphs (/ \ | - _) and colour fringing on edges only.
 *
 * Import createAsciiBackground from this dependency-free ES module.
 */
  var RAMP = " .'`,:;-~+=?Ik!I/|HX$#@8";
  var EDGE_GLYPHS = '-\\|/_'; // atlas indices RAMP.length + 0..4

  var VERT = '#version 300 es\n' +
    'void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));' +
    'gl_Position=vec4(p*2.-1.,0.,1.);}';

  // ---- Pass 1: the field. Output RGBA8 per cell: R=brightness, G=edge strength,
  // B=gradient angle, A=brightness for edge glyphs. Coordinates are device px, y down.
  var FIELD_FRAG = '#version 300 es\nprecision highp float;\n' +
  'uniform vec2 uCell;uniform float uT,uDpr,uMouseAmt,uRectAmt,uRectPush;\n' +
  'uniform vec2 uMouse;uniform vec4 uRect;out vec4 o;float gDots=1.;\n' +
  'float h11(float p){p=fract(p*.1031);p*=p+33.33;p*=p+p;return fract(p);}\n' +
  'float h21(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}\n' +
  'vec2 h22(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(.1031,.103,.0973));q+=dot(q,q.yzx+33.33);return fract((q.xx+q.yz)*q.zy);}\n' +
  'float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);\n' +
  ' return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+1.),f.x),f.y);}\n' +
  // One depth layer: Voronoi crystals that swell, sharpen and dissolve.
  'float layer(vec2 P,float size,float seed,float speed,float gain){\n' +
  ' vec2 q=P/(size*uDpr)+vec2(.021,.013)*uT*speed+seed*3.7;\n' +
  ' vec2 ip=floor(q),fp=fract(q);float f1=9.,f2=9.;vec2 id1=vec2(0),pt1=vec2(0);\n' +
  ' for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){\n' +
  '  vec2 g=vec2(i,j),id=ip+g,h=h22(id+seed);\n' +
  '  vec2 w=vec2(sin(uT*.23*speed*(.6+h.x)+6.283*h.y),cos(uT*.19*speed*(.6+h.y)+6.283*h.x));\n' +
  '  vec2 pt=g+.5+(h-.5)*.7+w*.12;float d=length(pt-fp);\n' +
  '  if(d<f1){f2=f1;f1=d;id1=id;pt1=pt;}else if(d<f2){f2=d;}\n' +
  ' }\n' +
  ' float b=f2-f1;\n' + // distance-to-border proxy: its contours are shrinking polygons
  ' vec2 hc=h22(id1+seed+31.7);\n' +
  ' float u=uT/(mix(6.,12.,hc.x)/speed)+hc.y;float cyc=mod(floor(u),64.),x=fract(u);\n' +
  ' vec2 hn=h22(id1+seed+cyc*vec2(5.3,2.9)+57.1);\n' +
  ' float act=step(hn.x,.7);\n' +
  ' float e=smoothstep(0.,.32,x)*(1.-smoothstep(.62,1.,x))*act;\n' +
  ' float th=.012+(1.-e)*.9+(vn(q*2.1+seed)-.5)*.14;\n' +
  ' float m=smoothstep(th,th+.03,b)*smoothstep(0.,.06,e);\n' +
  // Pyramid facets: six sectors around the crystal centre, each with its own normal.
  ' vec2 rel=fp-pt1;float rot=hn.y*6.2832;\n' +
  ' float a2=mod(atan(rel.y,rel.x)+rot,6.2832),sec=floor(a2/6.2832*6.);\n' +
  ' float mid=(sec+.5)/6.*6.2832-rot,slope=.55+.9*h11(sec*3.17+hn.x*91.);\n' +
  ' vec3 n=vec3(vec2(cos(mid),sin(mid))*slope+(vec2(vn(q*4.+seed),vn(q*4.+seed+9.))-.5)*.5,1.);\n' +
  ' n=normalize(n);vec3 L=normalize(vec3(-.5,-.55,.7));\n' +
  ' float df=max(dot(n,L),0.);\n' +
  ' float sp=pow(max(dot(n,normalize(L+vec3(0,0,1))),0.),28.)*.5;\n' +
  ' float lit=(.1+.78*pow(df,1.2)+sp*.8)*(.72+.4*smoothstep(0.,.3,b));\n' +
  // Dissolve: sparse dim dots that fade in and out slowly (no hard per-frame flicker).
  ' float da=smoothstep(.5,.7,x)*(1.-smoothstep(.86,1.,x))*act*(1.-smoothstep(.6,.9,f1));\n' +
  ' vec2 tid=floor(P/uCell);float tk=uT*.25,fk=smoothstep(0.,1.,fract(tk));\n' +
  ' float dn=mix(h21(tid+floor(tk)*7.3),h21(tid+(floor(tk)+1.)*7.3),fk);\n' +
  ' float dots=(1.-smoothstep(da*.3,da*.3+.06,dn))*(.2+.2*lit)*step(.001,da)*gDots;\n' +
  ' return max(clamp(lit,0.,1.)*m*gain,dots*gain);\n' +
  '}\n' +
  // Warps (mouse + repel rect) plus clearing of the repel rect, then both layers.
  'float field(vec2 P){\n' +
  ' vec2 Pf=P,Pb=P;float clr=1.;\n' +
  ' vec2 d=P-uMouse;float f=1.-smoothstep(0.,150.*uDpr,length(d));\n' +
  ' vec2 wm=d*(.9*f*f*uMouseAmt);Pf-=wm;Pb-=wm*.6;\n' +
  ' if(uRectAmt>.001){\n' +
  '  vec2 c=(uRect.xy+uRect.zw)*.5,hs=(uRect.zw-uRect.xy)*.5,dq=P-c,qq=abs(dq)-hs,qo=max(qq,0.);\n' +
  '  float sd=length(qo)+min(max(qq.x,qq.y),0.);\n' +
  '  vec2 nr=sign(dq)*qo;float nl=length(nr);nr=nl>1e-3?nr/nl:normalize(dq+1e-3);\n' +
  '  float pu=uRectPush*uRectAmt*pow(1.-smoothstep(0.,180.*uDpr,sd),2.);\n' +
  '  Pf-=nr*pu;Pb-=nr*pu*.6;\n' +
  '  clr=1.-uRectAmt*(1.-smoothstep(0.,36.*uDpr,sd));\n' +
  ' }\n' +
  ' float fr=layer(Pf,320.,1.,1.,1.),bk=layer(Pb,520.,7.,.55,.34);\n' +
  ' return (fr+bk*(1.-fr))*clr;\n' +
  '}\n' +
  'void main(){\n' +
  ' vec2 cell=floor(gl_FragCoord.xy),P=(cell+.5)*uCell;\n' +
  ' gDots=0.;float f0=field(P),fx=field(P+vec2(uCell.x,0)),fy=field(P+vec2(0,uCell.y));\n' +
  ' gDots=1.;float fd=field(P);\n' +
  ' vec2 gp=vec2((fx-f0)/uCell.x,(fy-f0)/uCell.y);\n' +
  ' float e=smoothstep(.09,.24,length(gp)*uCell.y);\n' +
  ' o=vec4(clamp(fd,0.,1.),e,atan(gp.y,gp.x)/6.2832+.5,clamp(max(fd,max(fx,fy))*1.15,0.,1.));\n' +
  '}';

  // ---- Pass 2: glyphs.
  var GLYPH_FRAG = '#version 300 es\nprecision highp float;\n' +
  'uniform sampler2D uField,uAtlas;uniform vec2 uCell,uRes;uniform vec2 uGrid;\n' +
  'uniform float uT,uDpr,uN,uNR;out vec4 o;\n' +
  'const vec3 PAL[4]=vec3[4](vec3(1.,.42,.42),vec3(.482,.894,.584),vec3(.365,.678,.925),vec3(1.,.902,.427));\n' +
  'float gm(vec2 l,float i){\n' +
  ' if(l.x<0.||l.y<0.||l.x>1.||l.y>1.)return 0.;\n' +
  ' return texture(uAtlas,vec2((i+l.x)/uN,l.y)).r;}\n' +
  'void main(){\n' +
  ' vec2 pd=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y),cf=pd/uCell,cell=floor(cf),l=cf-cell;\n' +
  ' vec4 t=texelFetch(uField,ivec2(clamp(cell,vec2(0),uGrid-1.)),0);\n' +
  ' float e=t.g,ang=(t.b-.5)*6.2832;vec2 gd=vec2(cos(ang),sin(ang));\n' +
  ' float idx,grey;\n' +
  ' if(e>.45){\n' + // edge glyph from the edge tangent (perpendicular to the gradient)
  '  float a=mod(atan(gd.x,-gd.y),3.14159),s=floor(a/.7854+.5);\n' + // atan(tan.y,tan.x), tan=(-gd.y,gd.x)
  '  float k=s==1.?1.:(s==2.?2.:(s==3.?3.:(gd.y<0.?4.:0.)));\n' +
  '  idx=uNR+k;grey=.4+.6*t.a;\n' +
  ' }else{\n' +
  '  idx=t.r<.02?0.:floor(clamp(t.r,0.,1.)*(uNR-1.)+.5);grey=.55+.45*t.r;\n' +
  ' }\n' +
  ' vec2 off=gd*1.7*uDpr/uCell;\n' +
  ' float ph=uT*.05+cell.x/uGrid.x*.35,sf=smoothstep(0.,1.,fract(ph));int i=int(mod(floor(ph),4.));\n' +
  ' vec3 ca=mix(PAL[i],PAL[(i+1)%4],sf),cb=mix(PAL[(i+2)%4],PAL[(i+3)%4],sf);\n' +
  ' vec3 col=vec3(.93,.95,.97)*grey*gm(l,idx)*(1.-.5*e);\n' +
  ' col+=e*grey*(ca*gm(l-off,idx)*1.6+cb*gm(l+off,idx)*1.1);\n' +
  ' o=vec4(min(col,1.),1.);\n' +
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
    var cellW = opts.cellWidth || 8, cellH = opts.cellHeight || 14, maxDpr = opts.maxDpr || 2;

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
    var W = 0, H = 0, dpr = 1, cw = 0, ch = 0, cols = 0, rows = 0, atlasKey = '';
    var chars = RAMP + EDGE_GLYPHS;

    function buildAtlas() {
      var c = document.createElement('canvas');
      c.width = chars.length * cw;
      c.height = ch;
      var g = c.getContext('2d');
      g.fillStyle = '#000';
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = Math.floor(Math.min(ch * 0.92, cw / 0.6)) + 'px Consolas, "Courier New", ui-monospace, Menlo, monospace';
      for (var i = 0; i < chars.length; i++) g.fillText(chars[i], (i + 0.5) * cw, ch * 0.52);
      gl.bindTexture(gl.TEXTURE_2D, atlasTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
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
      cw = Math.max(4, Math.round(cellW * dpr));
      ch = Math.max(6, Math.round(cellH * dpr));
      if (w !== W || h !== H) {
        W = w; H = h;
        canvas.width = W; canvas.height = H;
        cols = Math.ceil(W / cw); rows = Math.ceil(H / ch);
        if (fieldTex) gl.deleteTexture(fieldTex);
        fieldTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, fieldTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fieldTex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      var key = cw + 'x' + ch;
      if (key !== atlasKey) { atlasKey = key; buildAtlas(); }
    }

    // ---- Interaction state (device px, y down, relative to the canvas).
    var t = 20, last = 0, raf = 0, paused = false, destroyed = false;
    var mouse = { x: 0, y: 0, tx: 0, ty: 0, amt: 0, target: 0, seen: false };
    var rect = { x0: 0, y0: 0, x1: 0, y1: 0, tx0: 0, ty0: 0, tx1: 0, ty1: 0, amt: 0, target: 0, push: 80 };

    function onMove(ev) {
      var r = canvas.getBoundingClientRect();
      mouse.tx = (ev.clientX - r.left) * dpr;
      mouse.ty = (ev.clientY - r.top) * dpr;
      if (!mouse.seen) { mouse.x = mouse.tx; mouse.y = mouse.ty; mouse.seen = true; }
      mouse.target = 1;
    }
    function onLeave() { mouse.target = 0; }
    function onResize() { resize(); }
    window.addEventListener('pointermove', onMove);
    document.documentElement.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);
    window.addEventListener('resize', onResize);
    var ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    if (ro) ro.observe(canvas);

    function ease(dt, tau) { return 1 - Math.exp(-dt / tau); }

    function frame(now) {
      raf = 0;
      if (destroyed || paused) return;
      var dt = Math.min(Math.max((now - last) / 1000, 0), 0.1);
      last = now;
      t += dt;
      var k = ease(dt, 0.13); // ~400 ms to settle
      mouse.x += (mouse.tx - mouse.x) * ease(dt, 0.09);
      mouse.y += (mouse.ty - mouse.y) * ease(dt, 0.09);
      mouse.amt += (mouse.target - mouse.amt) * ease(dt, 0.25);
      rect.amt += (rect.target - rect.amt) * k;
      rect.x0 += (rect.tx0 - rect.x0) * k; rect.y0 += (rect.ty0 - rect.y0) * k;
      rect.x1 += (rect.tx1 - rect.x1) * k; rect.y1 += (rect.ty1 - rect.y1) * k;
      draw();
      raf = requestAnimationFrame(frame);
    }

    function draw() {
      gl.bindVertexArray(vao);
      // Pass 1: field -> low-res framebuffer.
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, cols, rows);
      var u = pField.u;
      gl.useProgram(pField.prog);
      gl.uniform2f(u.uCell, cw, ch);
      gl.uniform1f(u.uT, t);
      gl.uniform1f(u.uDpr, dpr);
      gl.uniform2f(u.uMouse, mouse.x, mouse.y);
      gl.uniform1f(u.uMouseAmt, mouse.amt);
      gl.uniform4f(u.uRect, rect.x0, rect.y0, rect.x1, rect.y1);
      gl.uniform1f(u.uRectAmt, rect.amt);
      gl.uniform1f(u.uRectPush, rect.push * dpr);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!canvas.dataset.fieldMax) {
        var diagnosticPixels = new Uint8Array(cols * rows * 4);
        gl.readPixels(0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, diagnosticPixels);
        var diagnosticMax = 0;
        for (var diagnosticIndex = 0; diagnosticIndex < diagnosticPixels.length; diagnosticIndex += 4) {
          diagnosticMax = Math.max(diagnosticMax, diagnosticPixels[diagnosticIndex]);
        }
        canvas.dataset.fieldMax = String(diagnosticMax);
        canvas.dataset.glError = String(gl.getError());
      }
      // Pass 2: glyphs -> screen.
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
      gl.uniform1f(u.uDpr, dpr);
      gl.uniform1f(u.uN, chars.length);
      gl.uniform1f(u.uNR, RAMP.length);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function start() {
      if (!raf && !destroyed && !paused) { last = performance.now(); raf = requestAnimationFrame(frame); }
    }

    resize();
    start();

    return {
      // Coordinates are CSS px relative to the canvas top-left (viewport, for a fixed full-screen canvas).
      setRepelRect: function (x, y, w, h, strength) {
        var s = strength == null ? 1 : strength;
        rect.tx0 = x * dpr; rect.ty0 = y * dpr; rect.tx1 = (x + w) * dpr; rect.ty1 = (y + h) * dpr;
        if (rect.amt < 0.01) { rect.x0 = rect.tx0; rect.y0 = rect.ty0; rect.x1 = rect.tx1; rect.y1 = rect.ty1; }
        rect.push = 80 * s;
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
        window.removeEventListener('resize', onResize);
        if (ro) ro.disconnect();
        var lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      }
    };
  }

export { createAsciiBackground };
