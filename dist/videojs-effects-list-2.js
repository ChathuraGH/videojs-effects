'use strict';
(function(){
  function fsHeader(){
    return "\nprecision mediump float;\nvarying vec2 vTexCoord;\nuniform sampler2D uTexture;\nuniform vec2 uResolution;\nuniform float uIntensity;\nuniform float uTime;\n";
  }
  function fsMain(body){ return fsHeader() + '\nvoid main(){\n' + body + '\n}\n'; }
  function fsWithPrelude(prelude, body){ return fsHeader() + (prelude || '') + '\nvoid main(){\n' + body + '\n}\n'; }

  var HUE_UTIL = "\nvec3 rgb2hsv(vec3 c){\n  vec4 K = vec4(0., -1./3., 2./3., -1.);\n  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b,c.g));\n  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));\n  float d = q.x - min(q.w, q.y);\n  float e = 1.0e-10;\n  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d/(q.x+e), q.x);\n}\nvec3 hsv2rgb(vec3 c){\n  vec3 p = abs(fract(c.xxx + vec3(0.,1./3.,2./3.))*6. - 3.);\n  vec3 a = clamp(p - 1., 0., 1.);\n  return c.z * mix(vec3(1.), a, c.y);\n}\n";

  var PALETTE_UTIL = "\nvec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d){\n  return a + b*cos(6.28318*(c*t + d));\n}\n";

  var effects = [
    { index: 0, name: 'None', code: 'none', description: 'No effect', fragment: fsMain("gl_FragColor = texture2D(uTexture, vTexCoord);") },

    // 1) Rainbow Warp
    { index: 1, name: 'Rainbow Warp', code: 'rainbow', description: 'Hue overlay with time warp', fragment: fsWithPrelude(HUE_UTIL,
      "vec3 base = texture2D(uTexture, vTexCoord).rgb;\nvec2 uv = vTexCoord;\nfloat h = fract(uTime*0.07 + uv.x*0.8 + uv.y*0.6);\nvec3 overlay = hsv2rgb(vec3(h, 1.0, 1.0));\nvec3 outc = mix(base, overlay, uIntensity*0.6);\ngl_FragColor = vec4(outc,1.0);"
    ) },

    // 2) Kaleidoscope 6
    { index: 2, name: 'Kaleidoscope', code: 'kaleido', description: '6-segment kaleidoscope', fragment: fsMain(
      "vec2 st = vTexCoord - 0.5;\nfloat r = length(st);\nfloat a = atan(st.y, st.x);\nfloat seg = 3.14159/3.0;\na = mod(a, seg);\na = abs(a - seg*0.5);\nvec2 p = vec2(cos(a), sin(a)) * r;\nvec3 c = texture2D(uTexture, p + 0.5).rgb;\n// gentle hue tint based on angle
c = mix(c, vec3(0.8,0.9,1.2), 0.12*uIntensity);\ngl_FragColor = vec4(c,1.0);"
    ) },

    // 3) RGB Glitch Bands
    { index: 3, name: 'RGB Glitch', code: 'glitch', description: 'RGB offset bands', fragment: fsMain(
      "vec2 uv = vTexCoord;\nfloat band = step(0.5, fract(uv.y*10.0 + uTime*0.7));\nfloat off = (band*2.0-1.0) * 0.005 * uIntensity;\nvec3 col;\ncol.r = texture2D(uTexture, uv + vec2(off, 0.0)).r;\ncol.g = texture2D(uTexture, uv).g;\ncol.b = texture2D(uTexture, uv - vec2(off, 0.0)).b;\ncol = mix(texture2D(uTexture, uv).rgb, col, 0.9*uIntensity);\ngl_FragColor = vec4(col,1.0);"
    ) },

    // 4) Heatmap
    { index: 4, name: 'Heatmap', code: 'heatmap', description: 'Luminance to warm palette', fragment: fsWithPrelude(PALETTE_UTIL,
      "vec3 base = texture2D(uTexture, vTexCoord).rgb;\nfloat l = dot(base, vec3(0.299,0.587,0.114));\nvec3 heat = palette(l, vec3(0.2,0.1,0.0), vec3(0.8,0.9,0.6), vec3(1.0,1.0,1.0), vec3(0.0,0.1,0.2));\nvec3 outc = mix(base, heat, uIntensity);\ngl_FragColor = vec4(outc,1.0);"
    ) },

    // 5) Neon Edge
    { index: 5, name: 'Neon Edge', code: 'neonedge', description: 'Colorized edges', fragment: fsWithPrelude(HUE_UTIL,
      "vec2 texel = 1.0/uResolution;\nfloat tl = dot(texture2D(uTexture, vTexCoord+texel*vec2(-1.0,-1.0)).rgb, vec3(0.299,0.587,0.114));\nfloat  t = dot(texture2D(uTexture, vTexCoord+texel*vec2( 0.0,-1.0)).rgb, vec3(0.299,0.587,0.114));\nfloat tr = dot(texture2D(uTexture, vTexCoord+texel*vec2( 1.0,-1.0)).rgb, vec3(0.299,0.587,0.114));\nfloat  l = dot(texture2D(uTexture, vTexCoord+texel*vec2(-1.0, 0.0)).rgb, vec3(0.299,0.587,0.114));\nfloat  r = dot(texture2D(uTexture, vTexCoord+texel*vec2( 1.0, 0.0)).rgb, vec3(0.299,0.587,0.114));\nfloat bl = dot(texture2D(uTexture, vTexCoord+texel*vec2(-1.0, 1.0)).rgb, vec3(0.299,0.587,0.114));\nfloat  b = dot(texture2D(uTexture, vTexCoord+texel*vec2( 0.0, 1.0)).rgb, vec3(0.299,0.587,0.114));\nfloat br = dot(texture2D(uTexture, vTexCoord+texel*vec2( 1.0, 1.0)).rgb, vec3(0.299,0.587,0.114));\nfloat gx = -tl + tr + -2.0*l + 2.0*r + -bl + br;\nfloat gy = -tl - 2.0*t - tr + bl + 2.0*b + br;\nfloat e = clamp(sqrt(gx*gx+gy*gy),0.0,1.0);\nfloat hue = fract(atan(gy,gx)/6.28318 + 0.5 + 0.2*uTime);\nvec3 edgeColor = hsv2rgb(vec3(hue, 1.0, 1.0));\nvec3 base = texture2D(uTexture, vTexCoord).rgb;\nvec3 outc = mix(base, edgeColor*e*1.5, uIntensity);\ngl_FragColor = vec4(outc,1.0);"
    ) },

    // 6) Solarize
    { index: 6, name: 'Solarize', code: 'solar', description: 'Colorful solarization', fragment: fsWithPrelude(HUE_UTIL,
      "vec3 col = texture2D(uTexture, vTexCoord).rgb;\nfloat th = mix(0.3, 0.8, uIntensity);\nvec3 inv = 1.0 - col;\nvec3 mixc = mix(col, inv, step(th, col));\n// tint
vec3 hsv = rgb2hsv(mixc); hsv.x = fract(hsv.x + 0.15*uIntensity); mixc = hsv2rgb(hsv);\ngl_FragColor = vec4(mixc,1.0);"
    ) },

    // 7) Duotone
    { index: 7, name: 'Duotone', code: 'duotone', description: 'Vivid two-tone map', fragment: fsMain(
      "vec3 col = texture2D(uTexture, vTexCoord).rgb;\nfloat l = dot(col, vec3(0.2126,0.7152,0.0722));\nvec3 c1 = vec3(0.05,0.95,0.85);\nvec3 c2 = vec3(0.95,0.15,0.65);\nvec3 outc = mix(c1, c2, l);\noutc = mix(col, outc, uIntensity);\ngl_FragColor = vec4(outc,1.0);"
    ) },

    // 8) Scanlines
    { index: 8, name: 'Scanlines', code: 'scanlines', description: 'CRT scanline vibe', fragment: fsMain(
      "vec2 uv = vTexCoord;\nvec3 col = texture2D(uTexture, uv).rgb;\nfloat line = 0.85 + 0.15*sin(uv.y*uResolution.y*3.14159 + uTime*6.0);\ncol *= line;\ncol.gb += 0.02*uIntensity;\ncol = clamp(col, 0.0, 1.0);\ngl_FragColor = vec4(col,1.0);"
    ) },

    // 9) Pixel Glow
    { index: 9, name: 'Pixel Glow', code: 'pixelglow', description: 'Blocky with glow tint', fragment: fsMain(
      "vec2 res = uResolution;\nfloat size = mix(2.0, 20.0, uIntensity);\nvec2 p = floor(vTexCoord * res / size) * size / res;\nvec3 c = texture2D(uTexture, p).rgb;\nc *= 1.0 + 0.3*uIntensity;\nvec3 tint = vec3(0.6,0.8,1.0);\nc = mix(c, c*tint, 0.25*uIntensity);\ngl_FragColor = vec4(c,1.0);"
    ) },

    // 10) Swirl Color
    { index: 10, name: 'Swirl Color', code: 'swirlcolor', description: 'Swirl with hue twist', fragment: fsWithPrelude(HUE_UTIL,
      "vec2 uv = vTexCoord - 0.5;\nfloat radius = length(uv);\nfloat angle = (1.0 - smoothstep(0.0, 0.7, radius)) * 3.14159 * uIntensity;\nfloat s = sin(angle); float c = cos(angle);\nmat2 rot = mat2(c, -s, s, c);\nuv = rot * uv;\nvec3 col = texture2D(uTexture, uv + 0.5).rgb;\nvec3 hsv = rgb2hsv(col); hsv.x = fract(hsv.x + 0.15*uIntensity + 0.05*uTime); col = hsv2rgb(hsv);\ngl_FragColor = vec4(col,1.0);"
    ) }
  ];

  window.videojsEffectsList = { effects: effects };
})();