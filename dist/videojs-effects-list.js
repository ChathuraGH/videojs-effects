'use strict';
(function(){
  function fsHeader(){
    return "\nprecision mediump float;\nvarying vec2 vTexCoord;\nuniform sampler2D uTexture;\nuniform vec2 uResolution;\nuniform float uIntensity;\nuniform float uTime;\n";
  }
  function fsMain(body){ return fsHeader() + '\nvoid main(){\n' + body + '\n}\n'; }
  var HUE_UTIL = "\nvec3 rgb2hsv(vec3 c){\n  vec4 K = vec4(0., -1./3., 2./3., -1.);\n  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b,c.g));\n  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));\n  float d = q.x - min(q.w, q.y);\n  float e = 1.0e-10;\n  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d/(q.x+e), q.x);\n}\nvec3 hsv2rgb(vec3 c){\n  vec3 p = abs(fract(c.xxx + vec3(0.,1./3.,2./3.))*6. - 3.);\n  vec3 a = clamp(p - 1., 0., 1.);\n  return c.z * mix(vec3(1.), a, c.y);\n}\n";

  var effects = [
    { index: 0, name: 'None', code: 'none', description: 'No effect', fragment: fsMain("gl_FragColor = texture2D(uTexture, vTexCoord);") },
    { index: 1, name: 'Cartoon', code: 'cartoon', description: 'Edges + posterize', fragment: fsMain(
      "vec2 texel = 1.0 / uResolution;\nvec3 base = texture2D(uTexture, vTexCoord).rgb;\n// 3x3 luminance taps\nfloat tl = dot(texture2D(uTexture, vTexCoord + texel*vec2(-1.0,-1.0)).rgb, vec3(0.299,0.587,0.114));\nfloat  t = dot(texture2D(uTexture, vTexCoord + texel*vec2( 0.0,-1.0)).rgb, vec3(0.299,0.587,0.114));\nfloat tr = dot(texture2D(uTexture, vTexCoord + texel*vec2( 1.0,-1.0)).rgb, vec3(0.299,0.587,0.114));\nfloat  l = dot(texture2D(uTexture, vTexCoord + texel*vec2(-1.0, 0.0)).rgb, vec3(0.299,0.587,0.114));\nfloat  r = dot(texture2D(uTexture, vTexCoord + texel*vec2( 1.0, 0.0)).rgb, vec3(0.299,0.587,0.114));\nfloat bl = dot(texture2D(uTexture, vTexCoord + texel*vec2(-1.0, 1.0)).rgb, vec3(0.299,0.587,0.114));\nfloat  b = dot(texture2D(uTexture, vTexCoord + texel*vec2( 0.0, 1.0)).rgb, vec3(0.299,0.587,0.114));\nfloat br = dot(texture2D(uTexture, vTexCoord + texel*vec2( 1.0, 1.0)).rgb, vec3(0.299,0.587,0.114));\nfloat gx = -tl + tr + -2.0*l + 2.0*r + -bl + br;\nfloat gy = -tl - 2.0*t - tr + bl + 2.0*b + br;\nfloat edge = clamp(sqrt(gx*gx + gy*gy), 0.0, 1.0);\n// Posterize\nfloat steps = mix(4.0, 16.0, 1.0-uIntensity);\nvec3 c = floor(base*steps)/steps;\nfloat ink = smoothstep(0.1, 0.5, edge);\nvec3 outc = c * (1.0 - ink*1.2);\ngl_FragColor = vec4(outc, 1.0);"
    ) },
    { index: 2, name: 'Dot Halftone', code: 'dots', description: 'Dot screen halftone', fragment: fsMain(
      "vec2 st = vTexCoord;\nvec2 res = uResolution;\nfloat angle = 1.0472;\nfloat scale = mix(40.0, 8.0, uIntensity);\nmat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));\nvec2 p = (st*res)/scale; p = rot * p;\nvec3 col = texture2D(uTexture, st).rgb;\nfloat lum = dot(col, vec3(0.299,0.587,0.114));\nfloat grid = abs(sin(3.14159*p.x) * sin(3.14159*p.y));\nfloat dotv = smoothstep(0.0, 0.8, grid);\nfloat k = mix(lum, 1.0 - dotv, uIntensity);\nvec3 outc = mix(col, vec3(k), uIntensity);\ngl_FragColor = vec4(outc, 1.0);"
    ) },
    { index: 3, name: 'Edge Detect', code: 'edge', description: 'Sobel edge magnitude', fragment: fsMain(
      "vec2 texel = 1.0/uResolution;\nfloat tl = dot(texture2D(uTexture, vTexCoord + texel*vec2(-1.0,-1.0)).rgb, vec3(0.299,0.587,0.114));\nfloat  t = dot(texture2D(uTexture, vTexCoord + texel*vec2( 0.0,-1.0)).rgb, vec3(0.299,0.587,0.114));\nfloat tr = dot(texture2D(uTexture, vTexCoord + texel*vec2( 1.0,-1.0)).rgb, vec3(0.299,0.587,0.114));\nfloat  l = dot(texture2D(uTexture, vTexCoord + texel*vec2(-1.0, 0.0)).rgb, vec3(0.299,0.587,0.114));\nfloat  r = dot(texture2D(uTexture, vTexCoord + texel*vec2( 1.0, 0.0)).rgb, vec3(0.299,0.587,0.114));\nfloat bl = dot(texture2D(uTexture, vTexCoord + texel*vec2(-1.0, 1.0)).rgb, vec3(0.299,0.587,0.114));\nfloat  b = dot(texture2D(uTexture, vTexCoord + texel*vec2( 0.0, 1.0)).rgb, vec3(0.299,0.587,0.114));\nfloat br = dot(texture2D(uTexture, vTexCoord + texel*vec2( 1.0, 1.0)).rgb, vec3(0.299,0.587,0.114));\nfloat gx = -tl + tr + -2.0*l + 2.0*r + -bl + br;\nfloat gy = -tl - 2.0*t - tr + bl + 2.0*b + br;\nfloat e = smoothstep(0.1, 0.6, sqrt(gx*gx + gy*gy));\nvec3 base = texture2D(uTexture, vTexCoord).rgb;\nvec3 outc = mix(base, vec3(e), uIntensity);\ngl_FragColor = vec4(outc,1.0);"
    ) },
    { index: 4, name: 'Pixelate', code: 'pixelate', description: 'Coarse pixel blocks', fragment: fsMain(
      "vec2 res = uResolution;\nfloat size = mix(2.0, 40.0, uIntensity);\nvec2 p = floor(vTexCoord * res / size) * size / res;\nvec3 c = texture2D(uTexture, p).rgb;\ngl_FragColor = vec4(c,1.0);"
    ) },
    { index: 5, name: 'Swirl', code: 'swirl', description: 'Twist around center', fragment: fsMain(
      "vec2 uv = vTexCoord - 0.5;\nfloat radius = length(uv);\nfloat angle = (1.0 - smoothstep(0.0, 0.7, radius)) * 3.14159 * uIntensity;\nfloat s = sin(angle); float c = cos(angle);\nmat2 rot = mat2(c, -s, s, c);\nuv = rot * uv;\nvec3 col = texture2D(uTexture, uv + 0.5).rgb;\ngl_FragColor = vec4(col,1.0);"
    ) },
    { index: 6, name: 'Vignette', code: 'vignette', description: 'Darken edges', fragment: fsMain(
      "vec2 uv = vTexCoord - 0.5;\nfloat d = dot(uv,uv);\nvec3 col = texture2D(uTexture, vTexCoord).rgb;\nfloat vig = smoothstep(0.8, mix(0.2, 1.0, uIntensity), 1.0 - d);\ncol *= vig;\ngl_FragColor = vec4(col,1.0);"
    ) },
    { index: 7, name: 'Hue Shift', code: 'hue', description: 'Rotate hue', fragment: fsMain(
      HUE_UTIL +
      "vec3 col = texture2D(uTexture, vTexCoord).rgb;\nvec3 hsv = rgb2hsv(col);\nhsv.x = fract(hsv.x + uIntensity);\ncol = hsv2rgb(hsv);\ngl_FragColor = vec4(col,1.0);"
    ) },
    { index: 8, name: 'Emboss', code: 'emboss', description: 'Relief shading', fragment: fsMain(
      "vec2 texel = 1.0/uResolution;\nvec3 tl = texture2D(uTexture, vTexCoord + texel*vec2(-1.0,-1.0)).rgb;\nvec3 br = texture2D(uTexture, vTexCoord + texel*vec2(1.0,1.0)).rgb;\nvec3 diff = br - tl;\nfloat g = (diff.r + diff.g + diff.b)/3.0;\nvec3 base = texture2D(uTexture, vTexCoord).rgb;\nvec3 outc = base + g * mix(1.0, 3.0, uIntensity);\ngl_FragColor = vec4(outc,1.0);"
    ) },
    { index: 9, name: 'Posterize', code: 'poster', description: 'Reduce color depth', fragment: fsMain(
      "vec3 col = texture2D(uTexture, vTexCoord).rgb;\nfloat steps = mix(4.0, 32.0, 1.0-uIntensity);\ncol = floor(col*steps)/steps;\ngl_FragColor = vec4(col,1.0);"
    ) },
    { index: 10, name: 'Chromatic Shift', code: 'chromatic', description: 'RGB channel separation', fragment: fsMain(
      "vec2 texel = 1.0/uResolution;\nfloat r = uIntensity*3.0;\nvec2 o = vec2(r*texel.x, r*texel.y);\nvec3 col;\ncol.r = texture2D(uTexture, vTexCoord + o).r;\ncol.g = texture2D(uTexture, vTexCoord).g;\ncol.b = texture2D(uTexture, vTexCoord - o).b;\ngl_FragColor = vec4(col,1.0);"
    ) }
  ];

  window.videojsEffectsList = { effects: effects };
})();