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

    // 1) Cyberpunk grade (teal/magenta)
    { index: 1, name: 'Cyberpunk', code: 'cyberpunk', description: 'Teal-magenta neon grade', fragment: fsMain(
      "vec3 col = texture2D(uTexture, vTexCoord).rgb;\nvec3 lift = vec3(0.02, -0.02, 0.06);\nvec3 gain = vec3(0.9, 1.1, 1.2);\ncol = clamp((col + lift) * gain, 0.0, 1.0);\ncol = mix(col, vec3(col.b, col.g*0.8, col.r), 0.25*uIntensity);\ngl_FragColor = vec4(col,1.0);"
    ) },

    // 2) Hype pulse (sat+contrast oscillation)
    { index: 2, name: 'Hype Pulse', code: 'hype', description: 'Pulsing saturation/contrast', fragment: fsWithPrelude(HUE_UTIL,
      "vec3 col = texture2D(uTexture, vTexCoord).rgb;\nfloat k = 0.5 + 0.5*sin(uTime*2.5);\nvec3 hsv = rgb2hsv(col); hsv.y = clamp(hsv.y * (1.0 + uIntensity*k), 0.0, 1.0); col = hsv2rgb(hsv);\ncol = (col - 0.5) * (1.0 + 0.5*uIntensity*k) + 0.5;\ngl_FragColor = vec4(col,1.0);"
    ) },

    // 3) Invert Pop
    { index: 3, name: 'Invert Pop', code: 'invertpop', description: 'Animated invert pop', fragment: fsMain(
      "vec3 col = texture2D(uTexture, vTexCoord).rgb;\nfloat t = 0.5 + 0.5*sin(uTime*1.7);\nvec3 inv = 1.0 - col;\nvec3 outc = mix(col, inv, uIntensity*t);\ngl_FragColor = vec4(outc,1.0);"
    ) },

    // 4) Colour Storm (cosine palette)
    { index: 4, name: 'Colour Storm', code: 'colourstorm', description: 'Cosine palette overlay', fragment: fsWithPrelude(PALETTE_UTIL,
      "vec3 base = texture2D(uTexture, vTexCoord).rgb;\nfloat t = fract(uTime*0.12 + vTexCoord.x*0.7 + vTexCoord.y*0.9);\nvec3 pal = palette(t, vec3(0.55,0.4,0.5), vec3(0.45,0.35,0.5), vec3(1.0,1.0,1.0), vec3(0.0,0.33,0.67));\nvec3 outc = mix(base, pal, 0.5*uIntensity);\ngl_FragColor = vec4(outc,1.0);"
    ) },

    // 5) High Contrast
    { index: 5, name: 'High Contrast', code: 'contrast', description: 'Punchy contrast/levels', fragment: fsMain(
      "vec3 col = texture2D(uTexture, vTexCoord).rgb;\ncol = (col - 0.5) * (1.0 + 1.5*uIntensity) + 0.5;\ncol = clamp(col, 0.0, 1.0);\ngl_FragColor = vec4(col,1.0);"
    ) },

    // 6) Hyperspace (Star Wars vibe)
    { index: 6, name: 'Hyperspace', code: 'starwars', description: 'Hyperspace streak vibes', fragment: fsMain(
      "vec2 uv = vTexCoord;\nvec3 base = texture2D(uTexture, uv).rgb;\nfloat streak = abs(sin((uv.y* uResolution.y*0.02) + uTime*10.0));\nvec3 glow = vec3(0.6,0.8,1.0) * pow(streak, 20.0);\nvec3 outc = mix(base, base + glow, uIntensity);\ngl_FragColor = vec4(outc,1.0);"
    ) },

    // 7) Forest Tint
    { index: 7, name: 'Forest', code: 'forest', description: 'Green lush grade', fragment: fsMain(
      "vec3 col = texture2D(uTexture, vTexCoord).rgb;\ncol.g = clamp(col.g * (1.0 + 0.5*uIntensity), 0.0, 1.0);\ncol.r *= 0.95; col.b *= 0.9;\ngl_FragColor = vec4(col,1.0);"
    ) },

    // 8) River Flow (distortion)
    { index: 8, name: 'River Flow', code: 'river', description: 'Sine wave distortion', fragment: fsMain(
      "vec2 uv = vTexCoord;\nfloat amp = 0.01 * uIntensity;\nuv.x += sin(uv.y*40.0 + uTime*3.0)*amp;\nuv.y += sin(uv.x*30.0 + uTime*2.0)*amp;\nvec3 col = texture2D(uTexture, uv).rgb;\ngl_FragColor = vec4(col,1.0);"
    ) },

    // 9) Metrix (Matrix greenish)
    { index: 9, name: 'Metrix', code: 'metrix', description: 'Green code vibe', fragment: fsMain(
      "vec2 uv = vTexCoord;\nvec3 col = texture2D(uTexture, uv).rgb;\nfloat scan = 0.7 + 0.3*sin(uv.y*uResolution.y*3.14159 + uTime*8.0);\ncol *= scan;\ncol = mix(col, vec3(0.1,1.0,0.2)*dot(col, vec3(0.299,0.587,0.114)), uIntensity);\ngl_FragColor = vec4(col,1.0);"
    ) },

    // 10) Alive Pulse (breathing brightness)
    { index: 10, name: 'Alive', code: 'alive', description: 'Breathing brightness', fragment: fsMain(
      "vec3 col = texture2D(uTexture, vTexCoord).rgb;\nfloat p = 0.15 + 0.85*(0.5+0.5*sin(uTime*2.0));\ncol *= mix(1.0, p, uIntensity);\ngl_FragColor = vec4(col,1.0);"
    ) },

    // 11) VHS (noise + chroma)
    { index: 11, name: 'VHS', code: 'vhs', description: 'Retro VHS vibe', fragment: fsMain(
      "vec2 uv = vTexCoord;\nfloat off = (sin(uv.y*120.0 + uTime*6.0))*0.002*uIntensity;\nvec3 col;\ncol.r = texture2D(uTexture, uv + vec2(off,0.0)).r;\ncol.g = texture2D(uTexture, uv).g;\ncol.b = texture2D(uTexture, uv - vec2(off,0.0)).b;\ncol *= 0.98 + 0.02*sin(uTime*50.0 + uv.x*100.0);\ngl_FragColor = vec4(col,1.0);"
    ) },

    // 12) Glitch Blocks
    { index: 12, name: 'Glitch Blocks', code: 'gblocks', description: 'Block shift glitch', fragment: fsMain(
      "vec2 res = uResolution;\nvec2 uv = vTexCoord;\nfloat size = mix(8.0, 40.0, uIntensity);\nvec2 block = floor(uv*res/size);\nfloat j = step(0.5, fract(sin(dot(block, vec2(12.9898,78.233)))*43758.5453 + uTime));\nuv.x += (j*2.0-1.0) * 0.01 * uIntensity;\nvec3 col = texture2D(uTexture, uv).rgb;\ngl_FragColor = vec4(col,1.0);"
    ) },

    // 13) Duochrome (blue/orange)
    { index: 13, name: 'Duochrome', code: 'duochrome', description: 'Blue-Orange duo', fragment: fsMain(
      "vec3 col = texture2D(uTexture, vTexCoord).rgb;\nfloat l = dot(col, vec3(0.2126,0.7152,0.0722));\nvec3 c1 = vec3(0.05,0.35,0.95);\nvec3 c2 = vec3(0.95,0.5,0.05);\nvec3 outc = mix(c1, c2, l);\noutc = mix(col, outc, uIntensity);\ngl_FragColor = vec4(outc,1.0);"
    ) },

    // 14) Sepia Film (sepia + vignette)
    { index: 14, name: 'Sepia Film', code: 'sepiafilm', description: 'Sepia with vignette', fragment: fsMain(
      "vec2 uv = vTexCoord - 0.5;\nvec3 col = texture2D(uTexture, uv+0.5).rgb;\nvec3 sep = vec3(dot(col, vec3(0.393,0.769,0.189)), dot(col, vec3(0.349,0.686,0.168)), dot(col, vec3(0.272,0.534,0.131)));\ncol = mix(col, sep, uIntensity);\nfloat v = smoothstep(0.85, mix(0.4, 1.0, uIntensity), 1.0 - dot(uv,uv));\ncol *= v;\ngl_FragColor = vec4(col,1.0);"
    ) },

    // 15) Anime Edge (bold lines)
    { index: 15, name: 'Anime Edge', code: 'anime', description: 'Bold ink edges', fragment: fsMain(
      "vec2 texel = 1.0/uResolution;\nvec3 base = texture2D(uTexture, vTexCoord).rgb;\nfloat tl = dot(texture2D(uTexture, vTexCoord+texel*vec2(-1.0,-1.0)).rgb, vec3(0.299,0.587,0.114));\nfloat  t = dot(texture2D(uTexture, vTexCoord+texel*vec2( 0.0,-1.0)).rgb, vec3(0.299,0.587,0.114));\nfloat tr = dot(texture2D(uTexture, vTexCoord+texel*vec2( 1.0,-1.0)).rgb, vec3(0.299,0.587,0.114));\nfloat  l = dot(texture2D(uTexture, vTexCoord+texel*vec2(-1.0, 0.0)).rgb, vec3(0.299,0.587,0.114));\nfloat  r = dot(texture2D(uTexture, vTexCoord+texel*vec2( 1.0, 0.0)).rgb, vec3(0.299,0.587,0.114));\nfloat bl = dot(texture2D(uTexture, vTexCoord+texel*vec2(-1.0, 1.0)).rgb, vec3(0.299,0.587,0.114));\nfloat  b = dot(texture2D(uTexture, vTexCoord+texel*vec2( 0.0, 1.0)).rgb, vec3(0.299,0.587,0.114));\nfloat br = dot(texture2D(uTexture, vTexCoord+texel*vec2( 1.0, 1.0)).rgb, vec3(0.299,0.587,0.114));\nfloat gx = -tl + tr + -2.0*l + 2.0*r + -bl + br;\nfloat gy = -tl - 2.0*t - tr + bl + 2.0*b + br;\nfloat e = smoothstep(0.12, 0.45, sqrt(gx*gx+gy*gy));\nvec3 ink = vec3(1.0 - e*1.4);\nvec3 col = base * ink;\ngl_FragColor = vec4(col,1.0);"
    ) },

    // 16) Neon Grid Overlay
    { index: 16, name: 'Neon Grid', code: 'neongrid', description: 'Glowing grid overlay', fragment: fsMain(
      "vec2 uv = vTexCoord;\nvec3 col = texture2D(uTexture, uv).rgb;\nvec2 grid = abs(fract(uv*vec2(12.0, 7.0)) - 0.5);\nfloat line = 1.0 - smoothstep(0.48, 0.5, max(grid.x, grid.y));\nvec3 glow = vec3(0.2,0.9,1.0)*pow(line, mix(3.0, 10.0, uIntensity));\ncol = mix(col, col + glow, 0.35*uIntensity);\ngl_FragColor = vec4(col,1.0);"
    ) },

    // 17) Prism Split (radial chroma)
    { index: 17, name: 'Prism Split', code: 'prism', description: 'Radial chromatic split', fragment: fsMain(
      "vec2 uv = vTexCoord - 0.5;\nfloat r = length(uv);\nfloat amt = 0.003 * uIntensity * r * 8.0;\nvec3 col;\ncol.r = texture2D(uTexture, uv + 0.5 + vec2( amt, 0.0)).r;\ncol.g = texture2D(uTexture, uv + 0.5).g;\ncol.b = texture2D(uTexture, uv + 0.5 - vec2( amt, 0.0)).b;\ngl_FragColor = vec4(col,1.0);"
    ) },

    // 18) Sunset Grade
    { index: 18, name: 'Sunset', code: 'sunset', description: 'Warm orange-purple grade', fragment: fsMain(
      "vec3 col = texture2D(uTexture, vTexCoord).rgb;\ncol = mix(col, vec3(1.1,0.5,0.3), 0.25*uIntensity);\ncol.b += 0.1*uIntensity;\ncol = clamp(col, 0.0, 1.0);\ngl_FragColor = vec4(col,1.0);"
    ) },

    // 19) Midnight Cool
    { index: 19, name: 'Midnight', code: 'midnight', description: 'Deep cool blue grade', fragment: fsMain(
      "vec3 col = texture2D(uTexture, vTexCoord).rgb;\ncol = mix(col, vec3(0.2,0.35,0.9), 0.3*uIntensity);\ncol.r *= 0.95; col.g *= 0.98;\ncol = clamp(col, 0.0, 1.0);\ngl_FragColor = vec4(col,1.0);"
    ) }
  ];

  window.videojsEffectsList = { effects: effects };
})();