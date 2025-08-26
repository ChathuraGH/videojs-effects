'use strict';
(function(){
  function fsHeader(){
    return "\nprecision mediump float;\nvarying vec2 vTexCoord;\nuniform sampler2D uTexture;\nuniform vec2 uResolution;\nuniform float uIntensity;\nuniform float uTime;\n";
  }
  function fsMain(body){ return fsHeader() + '\nvoid main(){\n' + body + '\n}\n'; }
  function fsWithPrelude(prelude, body){ return fsHeader() + (prelude || '') + '\nvoid main(){\n' + body + '\n}\n'; }

  var HUE_UTIL = "\nvec3 rgb2hsv(vec3 c){\n  vec4 K = vec4(0., -1./3., 2./3., -1.);\n  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b,c.g));\n  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));\n  float d = q.x - min(q.w, q.y);\n  float e = 1.0e-10;\n  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d/(q.x+e), q.x);\n}\nvec3 hsv2rgb(vec3 c){\n  vec3 p = abs(fract(c.xxx + vec3(0.,1./3.,2./3.))*6. - 3.);\n  vec3 a = clamp(p - 1., 0., 1.);\n  return c.z * mix(vec3(1.), a, c.y);\n}\n";

  var effects = [
    { index: 0, name: 'None', code: 'none', description: 'No effect', fragment: fsMain("gl_FragColor = texture2D(uTexture, vTexCoord);") },

    { index: 1, name: 'Rainbow Warp', code: 'rainbow', description: 'Hue overlay with time warp', fragment: fsWithPrelude(HUE_UTIL,
      "vec3 base = texture2D(uTexture, vTexCoord).rgb;\n"+
      "vec2 uv = vTexCoord;\n"+
      "float h = fract(uTime*0.07 + uv.x*0.8 + uv.y*0.6);\n"+
      "vec3 overlay = hsv2rgb(vec3(h, 1.0, 1.0));\n"+
      "vec3 outc = mix(base, overlay, uIntensity*0.6);\n"+
      "gl_FragColor = vec4(outc,1.0);"
    ) },

    { index: 2, name: 'Kaleidoscope', code: 'kaleido', description: '6-segment kaleidoscope', fragment: fsMain(
      "vec2 st = vTexCoord - 0.5;\n"+
      "float r = length(st);\n"+
      "float a = atan(st.y, st.x);\n"+
      "float seg = 3.14159/3.0;\n"+
      "a = mod(a, seg);\n"+
      "a = abs(a - seg*0.5);\n"+
      "vec2 p = vec2(cos(a), sin(a)) * r;\n"+
      "vec3 c = texture2D(uTexture, p + 0.5).rgb;\n"+
      "c = mix(c, vec3(0.8,0.9,1.2), 0.12*uIntensity);\n"+
      "gl_FragColor = vec4(c,1.0);"
    ) },

    { index: 3, name: 'RGB Glitch', code: 'glitch', description: 'RGB offset bands', fragment: fsMain(
      "vec2 uv = vTexCoord;\n"+
      "float band = step(0.5, fract(uv.y*10.0 + uTime*0.7));\n"+
      "float off = (band*2.0-1.0) * 0.005 * uIntensity;\n"+
      "vec3 col;\n"+
      "col.r = texture2D(uTexture, uv + vec2(off, 0.0)).r;\n"+
      "col.g = texture2D(uTexture, uv).g;\n"+
      "col.b = texture2D(uTexture, uv - vec2(off, 0.0)).b;\n"+
      "col = mix(texture2D(uTexture, uv).rgb, col, 0.9*uIntensity);\n"+
      "gl_FragColor = vec4(col,1.0);"
    ) },

    { index: 4, name: 'Heatmap', code: 'heatmap', description: 'Luminance to warm palette', fragment: fsMain(
      "vec3 base = texture2D(uTexture, vTexCoord).rgb;\n"+
      "float l = dot(base, vec3(0.299,0.587,0.114));\n"+
      "vec3 heat = vec3(\n"+
      "  smoothstep(0.0,1.0,l),\n"+
      "  smoothstep(0.2,1.0,l),\n"+
      "  smoothstep(0.5,1.0,l)\n"+
      ");\n"+
      "vec3 outc = mix(base, heat, uIntensity);\n"+
      "gl_FragColor = vec4(outc,1.0);"
    ) },

    { index: 5, name: 'Neon Edge', code: 'neonedge', description: 'Colorized edges', fragment: fsWithPrelude(HUE_UTIL,
      "vec2 texel = 1.0/uResolution;\n"+
      "float tl = dot(texture2D(uTexture, vTexCoord+texel*vec2(-1.0,-1.0)).rgb, vec3(0.299,0.587,0.114));\n"+
      "float  t = dot(texture2D(uTexture, vTexCoord+texel*vec2( 0.0,-1.0)).rgb, vec3(0.299,0.587,0.114));\n"+
      "float tr = dot(texture2D(uTexture, vTexCoord+texel*vec2( 1.0,-1.0)).rgb, vec3(0.299,0.587,0.114));\n"+
      "float  l = dot(texture2D(uTexture, vTexCoord+texel*vec2(-1.0, 0.0)).rgb, vec3(0.299,0.587,0.114));\n"+
      "float  r = dot(texture2D(uTexture, vTexCoord+texel*vec2( 1.0, 0.0)).rgb, vec3(0.299,0.587,0.114));\n"+
      "float bl = dot(texture2D(uTexture, vTexCoord+texel*vec2(-1.0, 1.0)).rgb, vec3(0.299,0.587,0.114));\n"+
      "float  b = dot(texture2D(uTexture, vTexCoord+texel*vec2( 0.0, 1.0)).rgb, vec3(0.299,0.587,0.114));\n"+
      "float br = dot(texture2D(uTexture, vTexCoord+texel*vec2( 1.0, 1.0)).rgb, vec3(0.299,0.587,0.114));\n"+
      "float gx = -tl + tr + -2.0*l + 2.0*r + -bl + br;\n"+
      "float gy = -tl - 2.0*t - tr + bl + 2.0*b + br;\n"+
      "float e = clamp(sqrt(gx*gx+gy*gy),0.0,1.0);\n"+
      "float hue = fract(atan(gy,gx)/6.28318 + 0.5 + 0.2*uTime);\n"+
      "vec3 edgeColor = hsv2rgb(vec3(hue, 1.0, 1.0));\n"+
      "vec3 base = texture2D(uTexture, vTexCoord).rgb;\n"+
      "vec3 outc = mix(base, edgeColor*e*1.5, uIntensity);\n"+
      "gl_FragColor = vec4(outc,1.0);"
    ) },

    { index: 6, name: 'Solarize', code: 'solar', description: 'Colorful solarization', fragment: fsWithPrelude(HUE_UTIL,
      "vec3 col = texture2D(uTexture, vTexCoord).rgb;\n"+
      "float th = mix(0.3, 0.8, uIntensity);\n"+
      "vec3 inv = 1.0 - col;\n"+
      "vec3 mixc = mix(col, inv, step(th, col));\n"+
      "vec3 hsv = rgb2hsv(mixc);\n"+
      "hsv.x = fract(hsv.x + 0.15*uIntensity);\n"+
      "mixc = hsv2rgb(hsv);\n"+
      "gl_FragColor = vec4(mixc,1.0);"
    ) },

    { index: 7, name: 'Duotone', code: 'duotone', description: 'Vivid two-tone map', fragment: fsMain(
      "vec3 col = texture2D(uTexture, vTexCoord).rgb;\n"+
      "float l = dot(col, vec3(0.2126,0.7152,0.0722));\n"+
      "vec3 c1 = vec3(0.05,0.95,0.85);\n"+
      "vec3 c2 = vec3(0.95,0.15,0.65);\n"+
      "vec3 outc = mix(c1, c2, l);\n"+
      "outc = mix(col, outc, uIntensity);\n"+
      "gl_FragColor = vec4(outc,1.0);"
    ) },

    { index: 8, name: 'Scanlines', code: 'scanlines', description: 'CRT scanline vibe', fragment: fsMain(
      "vec2 uv = vTexCoord;\n"+
      "vec3 col = texture2D(uTexture, uv).rgb;\n"+
      "float line = 0.85 + 0.15*sin(uv.y*uResolution.y*3.14159 + uTime*6.0);\n"+
      "col *= line;\n"+
      "col.gb += 0.02*uIntensity;\n"+
      "col = clamp(col, 0.0, 1.0);\n"+
      "gl_FragColor = vec4(col,1.0);"
    ) },

    { index: 9, name: 'Pixel Glow', code: 'pixelglow', description: 'Blocky with glow tint', fragment: fsMain(
      "vec2 res = uResolution;\n"+
      "float size = mix(2.0, 20.0, uIntensity);\n"+
      "vec2 p = floor(vTexCoord * res / size) * size / res;\n"+
      "vec3 c = texture2D(uTexture, p).rgb;\n"+
      "c *= 1.0 + 0.3*uIntensity;\n"+
      "vec3 tint = vec3(0.6,0.8,1.0);\n"+
      "c = mix(c, c*tint, 0.25*uIntensity);\n"+
      "gl_FragColor = vec4(c,1.0);"
    ) },

    { index: 10, name: 'Swirl Color', code: 'swirlcolor', description: 'Swirl with hue twist', fragment: fsWithPrelude(HUE_UTIL,
      "vec2 uv = vTexCoord - 0.5;\n"+
      "float radius = length(uv);\n"+
      "float angle = (1.0 - smoothstep(0.0, 0.7, radius)) * 3.14159 * uIntensity;\n"+
      "float s = sin(angle); float c = cos(angle);\n"+
      "mat2 rot = mat2(c, -s, s, c);\n"+
      "uv = rot * uv;\n"+
      "vec3 col = texture2D(uTexture, uv + 0.5).rgb;\n"+
      "vec3 hsv = rgb2hsv(col);\n"+
      "hsv.x = fract(hsv.x + 0.15*uIntensity + 0.05*uTime);\n"+
      "col = hsv2rgb(hsv);\n"+
      "gl_FragColor = vec4(col,1.0);"
    ) }
  ];

  window.videojsEffectsList = { effects: effects };
})();