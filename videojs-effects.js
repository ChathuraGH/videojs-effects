'use strict';
(function(){
  // Guard if videojs is not present
  if (typeof window === 'undefined' || typeof window.videojs === 'undefined') {
    return;
  }

  var videojs = window.videojs;

  // Utilities
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function el(tag, className, attrs) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (attrs) {
      Object.keys(attrs).forEach(function(k){
        if (k === 'text') e.textContent = attrs[k];
        else if (k === 'html') e.innerHTML = attrs[k];
        else e.setAttribute(k, attrs[k]);
      });
    }
    return e;
  }
  function uid(prefix){ return (prefix || 'id') + '-' + Math.random().toString(36).slice(2, 9); }

  // Default settings
  var DEFAULTS = {
    defaultIntensity: 0.7,
    gridColumns: 4,
    previewSize: 120,
    livePreview: true,
    previewFps: 6,
    defaultEffectCode: 'cartoon',
    hotkeys: {
      toggleModal: 'KeyE',
      toggleEffect: 'KeyT',
      nextEffect: 'BracketRight',
      prevEffect: 'BracketLeft',
      intensityUp: 'Equal',
      intensityDown: 'Minus',
      toggleLivePreview: 'KeyP'
    }
  };

  var STORAGE_KEY = 'videojs-effects-settings-v1';

  function loadSettings(){
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      return obj;
    } catch(e){ return null; }
  }
  function saveSettings(settings){
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch(e) {}
  }

  // WebGL helpers
  var BASE_VERTEX_SHADER = "\nattribute vec2 aPosition;\nattribute vec2 aTexCoord;\nvarying vec2 vTexCoord;\nvoid main(){\n  vTexCoord = aTexCoord;\n  gl_Position = vec4(aPosition, 0.0, 1.0);\n}\n";

  function createGl(canvas){
    var gl = canvas.getContext('webgl', { preserveDrawingBuffer: false, premultipliedAlpha: true, alpha: true });
    if (!gl) throw new Error('WebGL not supported');

    // Create full-screen quad
    var vertices = new Float32Array([
      -1, -1, 0, 1,
       1, -1, 1, 1,
      -1,  1, 0, 0,
       1,  1, 1, 0
    ]);
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    var vao = {
      bind: function(program){
        var aPosition = gl.getAttribLocation(program, 'aPosition');
        var aTexCoord = gl.getAttribLocation(program, 'aTexCoord');
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        // interleaved stride 16 bytes: pos(2)*4 + uv(2)*4
        gl.enableVertexAttribArray(aPosition);
        gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(aTexCoord);
        gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, 16, 8);
      }
    };

    // Texture for video
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return { gl: gl, vao: vao, texture: texture };
  }

  function compileShader(gl, type, source){
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      var info = gl.getShaderInfoLog(shader) || 'Unknown shader error';
      console.error(info, '\nSource:\n', source);
      gl.deleteShader(shader);
      throw new Error('Shader compile error: ' + info);
    }
    return shader;
  }
  function linkProgram(gl, vsSource, fsSource){
    var vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
    var fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      var info = gl.getProgramInfoLog(program) || 'Unknown link error';
      gl.deleteProgram(program);
      throw new Error('Program link error: ' + info);
    }
    return program;
  }

  function ensureSize(canvas, width, height){
    var ratio = window.devicePixelRatio || 1;
    var w = Math.max(2, Math.floor(width * ratio));
    var h = Math.max(2, Math.floor(height * ratio));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      return true;
    }
    return false;
  }

  // Effects definitions (10 WebGL shader effects)
  // Each effect has index, name, code, fragmentShader function(source uniforms), and optional uniforms setup
  function fsHeader(){
    return "\nprecision mediump float;\nvarying vec2 vTexCoord;\nuniform sampler2D uTexture;\nuniform vec2 uResolution;\nuniform float uIntensity;\nuniform float uTime;\n";
  }

  function fsMain(body){
    return fsHeader() + '\nvoid main(){\n' + body + '\n}\n';
  }

  function bodyPassThrough(){
    return 'gl_FragColor = texture2D(uTexture, vTexCoord);';
  }

  // Helper: RGB <-> HSV for hue shift
  var HUE_UTIL = "\nvec3 rgb2hsv(vec3 c){\n  vec4 K = vec4(0., -1./3., 2./3., -1.);\n  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b,c.g));\n  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));\n  float d = q.x - min(q.w, q.y);\n  float e = 1.0e-10;\n  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d/(q.x+e), q.x);\n}\nvec3 hsv2rgb(vec3 c){\n  vec3 p = abs(fract(c.xxx + vec3(0.,1./3.,2./3.))*6. - 3.);\n  vec3 a = clamp(p - 1., 0., 1.);\n  return c.z * mix(vec3(1.), a, c.y);\n}\n";

  var EFFECTS = [
    {
      index: 0,
      name: 'Cartoon',
      code: 'cartoon',
      description: 'Edge-detect + color quantization',
      fragment: fsMain(
        "vec2 texel = 1.0 / uResolution;\nvec3 c = texture2D(uTexture, vTexCoord).rgb;\n// Sobel edge\nfloat gx = 0.0;\nfloat gy = 0.0;\nmat3 sobelX = mat3(-1.,0.,1., -2.,0.,2., -1.,0.,1.);\nmat3 sobelY = mat3(-1.,-2.,-1., 0.,0.,0., 1.,2.,1.);\nfor(int i=-1;i<=1;i++){\n  for(int j=-1;j<=1;j++){\n    vec2 off = vec2(float(i), float(j))*texel;\n    float lum = dot(texture2D(uTexture, vTexCoord+off).rgb, vec3(0.299,0.587,0.114));\n    gx += lum * sobelX[j+1][i+1];\n    gy += lum * sobelY[j+1][i+1];\n  }\n}\nfloat edge = clamp(sqrt(gx*gx+gy*gy), 0.0, 1.0);\n// Posterize colors\nfloat steps = mix(4.0, 16.0, 1.0-uIntensity);\nc = floor(c*steps)/steps;\n// Combine\nfloat edgeFactor = smoothstep(0.1, 0.4, edge);\nvec3 ink = vec3(1.0-edgeFactor*1.5);\nvec3 outc = c * ink;\ngl_FragColor = vec4(outc, 1.0);"
      )
    },
    {
      index: 1,
      name: 'Dot Halftone',
      code: 'dots',
      description: 'Dot screen halftone',
      fragment: fsMain(
        "vec2 st = vTexCoord;\nvec2 res = uResolution;\nfloat angle = 1.0472; // 60deg\nfloat scale = mix(40.0, 8.0, uIntensity);\nvec2 texel = vec2(1.0)/res;\n// rotate\nmat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));\nvec2 p = (st*res)/scale;\np = rot * p;\nvec3 col = texture2D(uTexture, st).rgb;\nfloat lum = dot(col, vec3(0.299,0.587,0.114));\nfloat grid = abs(sin(3.14159*p.x) * sin(3.14159*p.y));\nfloat dotv = smoothstep(0.0, 0.8, grid);\nfloat k = mix(lum, 1.0 - dotv, uIntensity);\nvec3 outc = mix(col, vec3(k), uIntensity);\ngl_FragColor = vec4(outc, 1.0);"
      )
    },
    {
      index: 2,
      name: 'Edge Detect',
      code: 'edge',
      description: 'Sobel edge magnitude',
      fragment: fsMain(
        "vec2 texel = 1.0/uResolution;\nfloat gx = 0.0; float gy = 0.0;\nmat3 sx = mat3(-1.,0.,1., -2.,0.,2., -1.,0.,1.);\nmat3 sy = mat3(-1.,-2.,-1., 0.,0.,0., 1.,2.,1.);\nfor(int i=-1;i<=1;i++){for(int j=-1;j<=1;j++){\n vec2 off = vec2(float(i), float(j))*texel;\n float l = dot(texture2D(uTexture, vTexCoord+off).rgb, vec3(0.299,0.587,0.114));\n gx += l * sx[j+1][i+1]; gy += l * sy[j+1][i+1];}}\nfloat e = sqrt(gx*gx+gy*gy);\nfloat a = smoothstep(0.1, 0.6, e);\nvec3 c = vec3(a);\nvec3 base = texture2D(uTexture, vTexCoord).rgb;\nvec3 outc = mix(base, c, uIntensity);\ngl_FragColor = vec4(outc,1.0);"
      )
    },
    {
      index: 3,
      name: 'Pixelate',
      code: 'pixelate',
      description: 'Coarse pixel blocks',
      fragment: fsMain(
        "vec2 res = uResolution;\nfloat size = mix(2.0, 40.0, uIntensity);\nvec2 p = floor(vTexCoord * res / size) * size / res;\nvec3 c = texture2D(uTexture, p).rgb;\ngl_FragColor = vec4(c,1.0);"
      )
    },
    {
      index: 4,
      name: 'Swirl',
      code: 'swirl',
      description: 'Twist around center',
      fragment: fsMain(
        "vec2 uv = vTexCoord - 0.5;\nfloat radius = length(uv);\nfloat angle = (1.0 - smoothstep(0.0, 0.7, radius)) * 3.14159 * uIntensity;\nfloat s = sin(angle); float c = cos(angle);\nmat2 rot = mat2(c, -s, s, c);\nuv = rot * uv;\nvec3 col = texture2D(uTexture, uv + 0.5).rgb;\ngl_FragColor = vec4(col,1.0);"
      )
    },
    {
      index: 5,
      name: 'Vignette',
      code: 'vignette',
      description: 'Darken edges',
      fragment: fsMain(
        "vec2 uv = vTexCoord - 0.5;\nfloat d = dot(uv,uv);\nvec3 col = texture2D(uTexture, vTexCoord).rgb;\nfloat vig = smoothstep(0.8, mix(0.2, 1.0, uIntensity), 1.0 - d);\ncol *= vig;\ngl_FragColor = vec4(col,1.0);"
      )
    },
    {
      index: 6,
      name: 'Hue Shift',
      code: 'hue',
      description: 'Rotate hue',
      fragment: fsMain(
        HUE_UTIL +
        "vec3 col = texture2D(uTexture, vTexCoord).rgb;\nvec3 hsv = rgb2hsv(col);\nhsv.x = fract(hsv.x + uIntensity);\ncol = hsv2rgb(hsv);\ngl_FragColor = vec4(col,1.0);"
      )
    },
    {
      index: 7,
      name: 'Emboss',
      code: 'emboss',
      description: 'Relief shading',
      fragment: fsMain(
        "vec2 texel = 1.0/uResolution;\nvec3 c = vec3(0.0);\nvec3 tl = texture2D(uTexture, vTexCoord + texel*vec2(-1.0,-1.0)).rgb;\nvec3 br = texture2D(uTexture, vTexCoord + texel*vec2(1.0,1.0)).rgb;\nvec3 diff = br - tl;\nfloat g = (diff.r + diff.g + diff.b)/3.0;\nvec3 base = texture2D(uTexture, vTexCoord).rgb;\nvec3 outc = base + g * mix(1.0, 3.0, uIntensity);\ngl_FragColor = vec4(outc,1.0);"
      )
    },
    {
      index: 8,
      name: 'Posterize',
      code: 'poster',
      description: 'Reduce color depth',
      fragment: fsMain(
        "vec3 col = texture2D(uTexture, vTexCoord).rgb;\nfloat steps = mix(4.0, 32.0, 1.0-uIntensity);\ncol = floor(col*steps)/steps;\ngl_FragColor = vec4(col,1.0);"
      )
    },
    {
      index: 9,
      name: 'Chromatic Shift',
      code: 'chromatic',
      description: 'RGB channel separation',
      fragment: fsMain(
        "vec2 texel = 1.0/uResolution;\nfloat r = uIntensity*3.0;\nvec2 o = vec2(r*texel.x, r*texel.y);\nvec3 col;\ncol.r = texture2D(uTexture, vTexCoord + o).r;\ncol.g = texture2D(uTexture, vTexCoord).g;\ncol.b = texture2D(uTexture, vTexCoord - o).b;\ngl_FragColor = vec4(col,1.0);"
      )
    }
  ];

  function findEffectIndexByCode(code){
    for (var i=0;i<EFFECTS.length;i++){ if (EFFECTS[i].code === code) return i; }
    return 0;
  }

  // Renderer for a target canvas
  function ShaderRenderer(canvas, video) {
    this.canvas = canvas;
    this.video = video;
    this.ctx = null;
    this.gl = null;
    this.texture = null;
    this.vao = null;
    this.programCache = {};
    this.currentProgram = null;
    this.uniforms = null;
    this.intensity = 0.7;
    this.timeStart = performance.now();

    this._init();
  }
  ShaderRenderer.prototype._init = function(){
    var out = createGl(this.canvas);
    this.gl = out.gl;
    this.vao = out.vao;
    this.texture = out.texture;
  };
  ShaderRenderer.prototype._programForFragment = function(fragment){
    if (this.programCache[fragment]) return this.programCache[fragment];
    var program = linkProgram(this.gl, BASE_VERTEX_SHADER, fragment);
    this.programCache[fragment] = program;
    return program;
  };
  ShaderRenderer.prototype.setEffect = function(effect){
    var program = this._programForFragment(effect.fragment);
    this.currentProgram = program;
    this.uniforms = {
      uTexture: this.gl.getUniformLocation(program, 'uTexture'),
      uResolution: this.gl.getUniformLocation(program, 'uResolution'),
      uIntensity: this.gl.getUniformLocation(program, 'uIntensity'),
      uTime: this.gl.getUniformLocation(program, 'uTime')
    };
  };
  ShaderRenderer.prototype.setIntensity = function(value){ this.intensity = clamp(value, 0, 1); };
  ShaderRenderer.prototype.draw = function(){
    var gl = this.gl; if (!gl || !this.currentProgram) return;
    var video = this.video;
    var width = this.canvas.clientWidth || this.canvas.offsetWidth || video.videoWidth || 640;
    var height = this.canvas.clientHeight || this.canvas.offsetHeight || video.videoHeight || 360;
    ensureSize(this.canvas, width, height);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.currentProgram);
    this.vao.bind(this.currentProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    try {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    } catch(e) {
      // Likely cross-origin; do nothing to avoid taint errors
      return;
    }

    gl.uniform1i(this.uniforms.uTexture, 0);
    gl.uniform2f(this.uniforms.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.uIntensity, this.intensity);
    var t = (performance.now() - this.timeStart) / 1000;
    gl.uniform1f(this.uniforms.uTime, t);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  // Main plugin
  function plugin(options) {
    var player = this;
    var settings = Object.assign({}, DEFAULTS, loadSettings() || {}, options || {});

    var effectIndex = findEffectIndexByCode(settings.defaultEffectCode);
    var effectEnabled = true;

    // DOM elements
    var playerEl = player.el();
    var techEl = player.el().getElementsByClassName('vjs-tech')[0];

    // Overlay canvas for active effect
    var overlayCanvas = el('canvas', 'vjs-effects-canvas');
    overlayCanvas.style.display = 'none';
    var overlayRenderer = null;

    // Modal
    var overlay = el('div', 'vjs-effects-modal-overlay');
    var modal = el('div', 'vjs-effects-modal');
    var header = el('div', 'vjs-effects-modal-header');
    var title = el('div', 'vjs-effects-modal-title', { text: 'Video Effects' });
    var closeBtn = el('button', 'vjs-effects-close', { 'aria-label': 'Close', text: '✕' });
    header.appendChild(title);
    header.appendChild(closeBtn);

    var tabs = el('div', 'vjs-effects-tabs');
    var tab1Btn = el('button', 'vjs-effects-tab vjs-effects-active', { text: 'Effects' });
    var tab2Btn = el('button', 'vjs-effects-tab', { text: 'Settings' });
    tabs.appendChild(tab1Btn);
    tabs.appendChild(tab2Btn);

    var panel1 = el('div', 'vjs-effects-panel vjs-effects-active');
    var panel2 = el('div', 'vjs-effects-panel');

    // Panel 1: controls + grid
    var controlsRow = el('div', 'vjs-effects-controls-row');
    var intensityLabel = el('label', null, { text: 'Intensity' });
    var intensityRange = el('input');
    intensityRange.type = 'range';
    intensityRange.min = '0';
    intensityRange.max = '1';
    intensityRange.step = '0.01';
    intensityRange.value = String(settings.defaultIntensity);

    var livePreviewChip = el('label', 'vjs-effects-chip');
    var livePreviewToggle = el('input', 'vjs-effects-toggle');
    livePreviewToggle.type = 'checkbox';
    livePreviewToggle.checked = !!settings.livePreview;
    livePreviewChip.appendChild(livePreviewToggle);
    livePreviewChip.appendChild(el('span', null, { text: 'Live previews' }));

    controlsRow.appendChild(intensityLabel);
    controlsRow.appendChild(intensityRange);
    controlsRow.appendChild(livePreviewChip);

    var grid = el('div', 'vjs-effects-grid');
    grid.style.gridTemplateColumns = 'repeat(' + settings.gridColumns + ', minmax(0, 1fr))';

    panel1.appendChild(controlsRow);
    panel1.appendChild(grid);

    // Panel 2: Settings
    var settingsGrid = el('div', 'vjs-effects-settings');

    function makeSetting(labelText, inputEl){
      var wrap = el('div', 'vjs-effects-setting');
      var lab = el('label', null, { text: labelText });
      wrap.appendChild(lab);
      wrap.appendChild(inputEl);
      return wrap;
    }

    var sDefaultIntensity = el('input'); sDefaultIntensity.type = 'range'; sDefaultIntensity.min='0'; sDefaultIntensity.max='1'; sDefaultIntensity.step='0.01'; sDefaultIntensity.value = String(settings.defaultIntensity);
    var sGridCols = el('input'); sGridCols.type='number'; sGridCols.min='2'; sGridCols.max='8'; sGridCols.value = String(settings.gridColumns);
    var sPreviewSize = el('input'); sPreviewSize.type='number'; sPreviewSize.min='64'; sPreviewSize.max='240'; sPreviewSize.value = String(settings.previewSize);
    var sPreviewFps = el('input'); sPreviewFps.type='number'; sPreviewFps.min='1'; sPreviewFps.max='30'; sPreviewFps.value = String(settings.previewFps);

    var sDefaultEffect = el('select');
    EFFECTS.forEach(function(eff){
      var opt = el('option', null, { value: eff.code, text: eff.name + ' (' + eff.code + ')' });
      if (eff.code === settings.defaultEffectCode) opt.selected = true;
      sDefaultEffect.appendChild(opt);
    });

    var sLivePreview = el('input', 'vjs-effects-toggle'); sLivePreview.type='checkbox'; sLivePreview.checked = !!settings.livePreview;

    function hotkeyInput(label, code){
      var input = el('input', 'vjs-effects-hotkey-input');
      input.type = 'text';
      input.readOnly = true;
      input.value = code;
      input.addEventListener('keydown', function(ev){
        ev.preventDefault();
        var key = ev.code || ev.key;
        input.value = key;
        input.dispatchEvent(new Event('change'));
      });
      return input;
    }

    var sHotToggleModal = hotkeyInput('Toggle Modal', settings.hotkeys.toggleModal);
    var sHotToggleEffect = hotkeyInput('Toggle Effect', settings.hotkeys.toggleEffect);
    var sHotNext = hotkeyInput('Next Effect', settings.hotkeys.nextEffect);
    var sHotPrev = hotkeyInput('Previous Effect', settings.hotkeys.prevEffect);
    var sHotIntUp = hotkeyInput('Intensity Up', settings.hotkeys.intensityUp);
    var sHotIntDown = hotkeyInput('Intensity Down', settings.hotkeys.intensityDown);
    var sHotTogglePreview = hotkeyInput('Toggle Live Preview', settings.hotkeys.toggleLivePreview);

    settingsGrid.appendChild(makeSetting('Default intensity', sDefaultIntensity));
    settingsGrid.appendChild(makeSetting('Grid columns', sGridCols));
    settingsGrid.appendChild(makeSetting('Preview size (px)', sPreviewSize));
    settingsGrid.appendChild(makeSetting('Preview FPS', sPreviewFps));
    settingsGrid.appendChild(makeSetting('Default effect', sDefaultEffect));
    settingsGrid.appendChild(makeSetting('Grid live previews', sLivePreview));

    settingsGrid.appendChild(makeSetting('Hotkey: Toggle modal', sHotToggleModal));
    settingsGrid.appendChild(makeSetting('Hotkey: Toggle effect', sHotToggleEffect));
    settingsGrid.appendChild(makeSetting('Hotkey: Next effect', sHotNext));
    settingsGrid.appendChild(makeSetting('Hotkey: Previous effect', sHotPrev));
    settingsGrid.appendChild(makeSetting('Hotkey: Intensity up', sHotIntUp));
    settingsGrid.appendChild(makeSetting('Hotkey: Intensity down', sHotIntDown));
    settingsGrid.appendChild(makeSetting('Hotkey: Toggle live previews', sHotTogglePreview));

    panel2.appendChild(settingsGrid);

    // Assemble modal
    modal.appendChild(header);
    modal.appendChild(tabs);
    modal.appendChild(panel1);
    modal.appendChild(panel2);
    overlay.appendChild(modal);

    // Add to player
    var container = playerEl.querySelector('.vjs-control-bar') ? playerEl : playerEl; // append both overlay and canvas at root level
    playerEl.style.position = playerEl.style.position || 'relative';
    playerEl.appendChild(overlay);
    // Insert canvas above tech
    var parentNode = techEl && techEl.parentNode ? techEl.parentNode : playerEl;
    parentNode.style.position = parentNode.style.position || 'relative';
    parentNode.appendChild(overlayCanvas);

    // Create WebGL overlay renderer when video is ready
    function ensureOverlayRenderer(){
      if (!overlayRenderer) {
        overlayRenderer = new ShaderRenderer(overlayCanvas, techEl);
        overlayRenderer.setEffect(EFFECTS[effectIndex]);
        overlayRenderer.setIntensity(settings.defaultIntensity);
      }
    }

    function startOverlayLoop(){
      ensureOverlayRenderer();
      overlayCanvas.style.display = effectEnabled ? 'block' : 'none';
      if (!effectEnabled) return;
      var running = true;
      function loop(){
        if (!running) return;
        overlayRenderer.draw();
        requestAnimationFrame(loop);
      }
      requestAnimationFrame(loop);
      return function stop(){ running = false; };
    }
    var stopOverlay = null;

    function updateOverlayState(){
      if (effectEnabled) {
        if (!stopOverlay) stopOverlay = startOverlayLoop();
      } else {
        if (stopOverlay) { stopOverlay(); stopOverlay = null; }
        overlayCanvas.style.display = 'none';
      }
    }

    // Build grid of effect previews
    var previewRenders = [];
    var previewTimer = null;

    function createTile(effect){
      var tile = el('div', 'vjs-effects-tile');
      var head = el('div', 'vjs-effects-tile-header');
      var nameEl = el('div', 'vjs-effects-tile-name', { text: effect.name });
      var codeEl = el('div', 'vjs-effects-tile-code', { text: effect.code });
      head.appendChild(nameEl);
      head.appendChild(codeEl);
      var canvas = el('canvas', 'vjs-effects-tile-canvas');
      canvas.width = settings.previewSize;
      canvas.height = settings.previewSize;

      tile.appendChild(head);
      tile.appendChild(canvas);

      var renderer = null;
      function ensure(){ if (!renderer) { renderer = new ShaderRenderer(canvas, techEl); renderer.setEffect(effect); renderer.setIntensity(settings.defaultIntensity); } }

      tile.addEventListener('click', function(){
        effectIndex = effect.index;
        ensureOverlayRenderer();
        overlayRenderer.setEffect(EFFECTS[effectIndex]);
        overlayRenderer.setIntensity(parseFloat(intensityRange.value));
        effectEnabled = true;
        updateOverlayState();
      });

      previewRenders.push({ effect: effect, canvas: canvas, ensure: ensure, rendererRef: function(){ return renderer; } });
      return tile;
    }

    function buildGrid(){
      grid.innerHTML = '';
      grid.style.gridTemplateColumns = 'repeat(' + settings.gridColumns + ', minmax(0, 1fr))';
      previewRenders = [];
      EFFECTS.forEach(function(eff){ grid.appendChild(createTile(eff)); });
      restartPreviewTimer();
    }

    function restartPreviewTimer(){
      if (previewTimer) { clearInterval(previewTimer); previewTimer = null; }
      if (!settings.livePreview) return;
      var interval = Math.max(1, Math.floor(1000 / clamp(settings.previewFps, 1, 30)));
      previewTimer = setInterval(function(){
        previewRenders.forEach(function(item){
          if (!settings.livePreview) return;
          item.ensure();
          var r = item.rendererRef();
          if (r) r.draw();
        });
      }, interval);
    }

    function drawThumbnailsOnce(){
      previewRenders.forEach(function(item){
        item.ensure();
        var r = item.rendererRef();
        if (r) r.draw();
      });
    }

    // Tabs behavior
    function activateTab(idx){
      if (idx === 0){
        tab1Btn.classList.add('vjs-effects-active');
        tab2Btn.classList.remove('vjs-effects-active');
        panel1.classList.add('vjs-effects-active');
        panel2.classList.remove('vjs-effects-active');
      } else {
        tab2Btn.classList.add('vjs-effects-active');
        tab1Btn.classList.remove('vjs-effects-active');
        panel2.classList.add('vjs-effects-active');
        panel1.classList.remove('vjs-effects-active');
      }
    }

    tab1Btn.addEventListener('click', function(){ activateTab(0); });
    tab2Btn.addEventListener('click', function(){ activateTab(1); });

    // Button in control bar
    var Button = videojs.getComponent('Button');
    var EffectsButton = videojs.extend(Button, {
      constructor: function(){
        Button.apply(this, arguments);
        this.controlText('Effects');
      },
      handleClick: function(){ toggleModal(); }
    });
    EffectsButton.prototype.buildCSSClass = function(){
      return 'vjs-effects-button vjs-control vjs-button';
    };
    videojs.registerComponent('EffectsButton', EffectsButton);

    player.ready(function(){
      player.controlBar.addChild('EffectsButton', {}, player.controlBar.children().length - 1);
    });

    // Modal open/close
    function openModal(){ overlay.classList.add('vjs-effects-open'); }
    function closeModal(){ overlay.classList.remove('vjs-effects-open'); }
    function toggleModal(){ overlay.classList.toggle('vjs-effects-open'); }

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', function(e){ if (e.target === overlay) closeModal(); });

    // Intensity control
    intensityRange.addEventListener('input', function(){ if (overlayRenderer) overlayRenderer.setIntensity(parseFloat(intensityRange.value)); });

    // Live preview toggle
    livePreviewToggle.addEventListener('change', function(){
      settings.livePreview = !!livePreviewToggle.checked;
      if (settings.livePreview) {
        restartPreviewTimer();
      } else {
        if (previewTimer) { clearInterval(previewTimer); previewTimer = null; }
      }
      saveSettings(settings);
      if (!settings.livePreview) {
        drawThumbnailsOnce();
      }
    });

    // Settings events
    function applySettings(){
      settings.defaultIntensity = parseFloat(sDefaultIntensity.value);
      settings.gridColumns = clamp(parseInt(sGridCols.value,10)||4, 2, 8);
      settings.previewSize = clamp(parseInt(sPreviewSize.value,10)||120, 64, 240);
      settings.previewFps = clamp(parseInt(sPreviewFps.value,10)||6, 1, 30);
      settings.defaultEffectCode = sDefaultEffect.value || settings.defaultEffectCode;
      settings.livePreview = !!sLivePreview.checked;
      settings.hotkeys = {
        toggleModal: sHotToggleModal.value || settings.hotkeys.toggleModal,
        toggleEffect: sHotToggleEffect.value || settings.hotkeys.toggleEffect,
        nextEffect: sHotNext.value || settings.hotkeys.nextEffect,
        prevEffect: sHotPrev.value || settings.hotkeys.prevEffect,
        intensityUp: sHotIntUp.value || settings.hotkeys.intensityUp,
        intensityDown: sHotIntDown.value || settings.hotkeys.intensityDown,
        toggleLivePreview: sHotTogglePreview.value || settings.hotkeys.toggleLivePreview
      };
      saveSettings(settings);
      buildGrid();
      if (overlayRenderer) overlayRenderer.setIntensity(settings.defaultIntensity);
    }

    [sDefaultIntensity, sGridCols, sPreviewSize, sPreviewFps, sDefaultEffect, sLivePreview,
     sHotToggleModal, sHotToggleEffect, sHotNext, sHotPrev, sHotIntUp, sHotIntDown, sHotTogglePreview
    ].forEach(function(inp){ inp.addEventListener('change', applySettings); });

    // Keyboard shortcuts
    function onKeyDown(ev){
      var tag = (ev.target && ev.target.tagName) ? ev.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || ev.target.isContentEditable) return;
      var code = ev.code || ev.key;

      if (code === settings.hotkeys.toggleModal) { ev.preventDefault(); toggleModal(); return; }
      if (code === settings.hotkeys.toggleEffect) { ev.preventDefault(); effectEnabled = !effectEnabled; updateOverlayState(); return; }
      if (code === settings.hotkeys.nextEffect) { ev.preventDefault(); effectIndex = (effectIndex+1)%EFFECTS.length; ensureOverlayRenderer(); overlayRenderer.setEffect(EFFECTS[effectIndex]); return; }
      if (code === settings.hotkeys.prevEffect) { ev.preventDefault(); effectIndex = (effectIndex-1+EFFECTS.length)%EFFECTS.length; ensureOverlayRenderer(); overlayRenderer.setEffect(EFFECTS[effectIndex]); return; }
      if (code === settings.hotkeys.intensityUp) { ev.preventDefault(); var v = clamp(parseFloat(intensityRange.value)+0.05,0,1); intensityRange.value = String(v); if (overlayRenderer) overlayRenderer.setIntensity(v); return; }
      if (code === settings.hotkeys.intensityDown) { ev.preventDefault(); var v2 = clamp(parseFloat(intensityRange.value)-0.05,0,1); intensityRange.value = String(v2); if (overlayRenderer) overlayRenderer.setIntensity(v2); return; }
      if (code === settings.hotkeys.toggleLivePreview) { ev.preventDefault(); livePreviewToggle.checked = !livePreviewToggle.checked; livePreviewToggle.dispatchEvent(new Event('change')); return; }
    }

    document.addEventListener('keydown', onKeyDown);

    // Initialize
    buildGrid();

    // Activate overlay on play/ready
    function whenReady(){
      if (!techEl || !techEl.videoWidth) return;
      ensureOverlayRenderer();
      updateOverlayState();
    }

    player.on('playing', whenReady);
    player.on('loadedmetadata', whenReady);
    player.on('resize', whenReady);

    // Cleanup on dispose
    player.on('dispose', function(){
      document.removeEventListener('keydown', onKeyDown);
      if (previewTimer) { clearInterval(previewTimer); previewTimer = null; }
      if (stopOverlay) { stopOverlay(); stopOverlay = null; }
    });

    // Expose small API
    player.videojsEffectsApi = {
      setEffectByCode: function(code){ var idx = findEffectIndexByCode(code); effectIndex = idx; ensureOverlayRenderer(); overlayRenderer.setEffect(EFFECTS[effectIndex]); },
      setIntensity: function(v){ intensityRange.value = String(clamp(v,0,1)); if (overlayRenderer) overlayRenderer.setIntensity(parseFloat(intensityRange.value)); },
      toggle: function(){ effectEnabled = !effectEnabled; updateOverlayState(); },
      open: openModal,
      close: closeModal
    };
  }

  // Register plugin (hyphenated name)
  videojs.registerPlugin('videojs-effects', plugin);
})();