'use strict';
(function(){
  if (typeof window === 'undefined' || typeof window.videojs === 'undefined') {
    return;
  }

  var videojs = window.videojs;

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
  function loadSettings(){ try { var raw = localStorage.getItem(STORAGE_KEY); return raw?JSON.parse(raw):null; } catch(e){ return null; } }
  function saveSettings(settings){ try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch(e){} }

  var BASE_VERTEX_SHADER = "\nattribute vec2 aPosition;\nattribute vec2 aTexCoord;\nvarying vec2 vTexCoord;\nvoid main(){\n  vTexCoord = aTexCoord;\n  gl_Position = vec4(aPosition, 0.0, 1.0);\n}\n";

  function createGl(canvas){
    var gl = canvas.getContext('webgl', { preserveDrawingBuffer: false, premultipliedAlpha: true, alpha: true });
    if (!gl) throw new Error('WebGL not supported');
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
        gl.enableVertexAttribArray(aPosition);
        gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(aTexCoord);
        gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, 16, 8);
      }
    };
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
      canvas.width = w; canvas.height = h;
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      return true;
    }
    return false;
  }

  function findEffectIndexByCode(code, list){
    for (var i=0;i<list.length;i++){ if (list[i].code === code) return i; }
    return 0;
  }

  function ShaderRenderer(canvas, video) {
    this.canvas = canvas;
    this.video = video;
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
    this.gl = out.gl; this.vao = out.vao; this.texture = out.texture;
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
    } catch(e) { return; }
    gl.uniform1i(this.uniforms.uTexture, 0);
    gl.uniform2f(this.uniforms.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.uIntensity, this.intensity);
    var t = (performance.now() - this.timeStart) / 1000;
    gl.uniform1f(this.uniforms.uTime, t);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  function plugin(options) {
    var player = this;
    var settings = Object.assign({}, DEFAULTS, loadSettings() || {}, options || {});

    var EFFECTS_SOURCE = (window.videojsEffectsList && (window.videojsEffectsList.effects || window.videojsEffectsList)) || [];
    if (!Array.isArray(EFFECTS_SOURCE) || EFFECTS_SOURCE.length === 0) {
      console.error('[videojs-effects] No effects found in window.videojsEffectsList');
    }
    var EFFECTS = EFFECTS_SOURCE;

    var effectIndex = findEffectIndexByCode(settings.defaultEffectCode, EFFECTS);
    var effectEnabled = true;

    var playerEl = player.el();
    var techEl = player.el().getElementsByClassName('vjs-tech')[0];

    var overlayCanvas = el('canvas', 'vjs-effects-canvas');
    overlayCanvas.style.display = 'none';
    var overlayRenderer = null;

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

    var controlsRow = el('div', 'vjs-effects-controls-row');
    var intensityLabel = el('label', null, { text: 'Intensity' });
    var intensityRange = el('input');
    intensityRange.type = 'range'; intensityRange.min='0'; intensityRange.max='1'; intensityRange.step='0.01';
    intensityRange.value = String(settings.defaultIntensity);

    var livePreviewChip = el('label', 'vjs-effects-chip');
    var livePreviewToggle = el('input', 'vjs-effects-toggle');
    livePreviewToggle.type = 'checkbox'; livePreviewToggle.checked = !!settings.livePreview;
    livePreviewChip.appendChild(livePreviewToggle);
    livePreviewChip.appendChild(el('span', null, { text: 'Live previews' }));

    controlsRow.appendChild(intensityLabel);
    controlsRow.appendChild(intensityRange);
    controlsRow.appendChild(livePreviewChip);

    var grid = el('div', 'vjs-effects-grid');
    grid.style.gridTemplateColumns = 'repeat(' + settings.gridColumns + ', minmax(0, 1fr))';

    panel1.appendChild(controlsRow);
    panel1.appendChild(grid);

    var settingsGrid = el('div', 'vjs-effects-settings');
    function makeSetting(labelText, inputEl){ var wrap = el('div', 'vjs-effects-setting'); wrap.appendChild(el('label', null, { text: labelText })); wrap.appendChild(inputEl); return wrap; }

    var sDefaultIntensity = el('input'); sDefaultIntensity.type = 'range'; sDefaultIntensity.min='0'; sDefaultIntensity.max='1'; sDefaultIntensity.step='0.01'; sDefaultIntensity.value = String(settings.defaultIntensity);
    var sGridCols = el('input'); sGridCols.type='number'; sGridCols.min='2'; sGridCols.max='8'; sGridCols.value = String(settings.gridColumns);
    var sPreviewSize = el('input'); sPreviewSize.type='number'; sPreviewSize.min='64'; sPreviewSize.max='240'; sPreviewSize.value = String(settings.previewSize);
    var sPreviewFps = el('input'); sPreviewFps.type='number'; sPreviewFps.min='1'; sPreviewFps.max='30'; sPreviewFps.value = String(settings.previewFps);

    var sDefaultEffect = el('select');
    EFFECTS.forEach(function(eff){ var opt = el('option', null, { value: eff.code, text: eff.name + ' (' + eff.code + ')' }); if (eff.code === settings.defaultEffectCode) opt.selected = true; sDefaultEffect.appendChild(opt); });

    var sLivePreview = el('input', 'vjs-effects-toggle'); sLivePreview.type='checkbox'; sLivePreview.checked = !!settings.livePreview;

    function hotkeyInput(code){ var input = el('input', 'vjs-effects-hotkey-input'); input.type='text'; input.readOnly=true; input.value=code; input.addEventListener('keydown', function(ev){ ev.preventDefault(); input.value = ev.code || ev.key; input.dispatchEvent(new Event('change')); }); return input; }

    var sHotToggleModal = hotkeyInput(settings.hotkeys.toggleModal);
    var sHotToggleEffect = hotkeyInput(settings.hotkeys.toggleEffect);
    var sHotNext = hotkeyInput(settings.hotkeys.nextEffect);
    var sHotPrev = hotkeyInput(settings.hotkeys.prevEffect);
    var sHotIntUp = hotkeyInput(settings.hotkeys.intensityUp);
    var sHotIntDown = hotkeyInput(settings.hotkeys.intensityDown);
    var sHotTogglePreview = hotkeyInput(settings.hotkeys.toggleLivePreview);

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

    modal.appendChild(header);
    modal.appendChild(tabs);
    modal.appendChild(panel1);
    modal.appendChild(panel2);
    overlay.appendChild(modal);

    var playerElPos = getComputedStyle(playerEl).position;
    if (playerElPos === 'static' || !playerElPos) playerEl.style.position = 'relative';
    playerEl.appendChild(overlay);
    var parentNode = techEl && techEl.parentNode ? techEl.parentNode : playerEl;
    var parentPos = getComputedStyle(parentNode).position;
    if (parentPos === 'static' || !parentPos) parentNode.style.position = 'relative';
    parentNode.appendChild(overlayCanvas);

    function ensureOverlayRenderer(){
      if (!overlayRenderer) {
        overlayRenderer = new ShaderRenderer(overlayCanvas, techEl);
        overlayRenderer.setEffect(EFFECTS[effectIndex] || EFFECTS[0]);
        overlayRenderer.setIntensity(settings.defaultIntensity);
      }
    }

    function startOverlayLoop(){
      ensureOverlayRenderer();
      overlayCanvas.style.display = effectEnabled ? 'block' : 'none';
      if (!effectEnabled) return;
      var running = true;
      function loop(){ if (!running) return; overlayRenderer.draw(); requestAnimationFrame(loop); }
      requestAnimationFrame(loop);
      return function stop(){ running = false; };
    }
    var stopOverlay = null;
    function updateOverlayState(){
      if (effectEnabled) { if (!stopOverlay) stopOverlay = startOverlayLoop(); }
      else { if (stopOverlay) { stopOverlay(); stopOverlay = null; } overlayCanvas.style.display = 'none'; }
    }

    var previewRenders = []; var previewTimer = null;
    function createTile(effect){
      var tile = el('div', 'vjs-effects-tile');
      var head = el('div', 'vjs-effects-tile-header');
      head.appendChild(el('div', 'vjs-effects-tile-name', { text: effect.name }));
      head.appendChild(el('div', 'vjs-effects-tile-code', { text: effect.code }));
      var canvas = el('canvas', 'vjs-effects-tile-canvas'); canvas.width = settings.previewSize; canvas.height = settings.previewSize;
      tile.appendChild(head); tile.appendChild(canvas);
      var renderer = null; function ensure(){ if (!renderer) { renderer = new ShaderRenderer(canvas, techEl); renderer.setEffect(effect); renderer.setIntensity(settings.defaultIntensity); } }
      tile.addEventListener('click', function(){ effectIndex = effect.index; ensureOverlayRenderer(); overlayRenderer.setEffect(EFFECTS[effectIndex]); overlayRenderer.setIntensity(parseFloat(intensityRange.value)); effectEnabled = true; updateOverlayState(); });
      previewRenders.push({ effect: effect, canvas: canvas, ensure: ensure, rendererRef: function(){ return renderer; } });
      return tile;
    }
    function buildGrid(){
      grid.innerHTML=''; grid.style.gridTemplateColumns = 'repeat(' + settings.gridColumns + ', minmax(0, 1fr))';
      previewRenders = []; EFFECTS.forEach(function(eff){ grid.appendChild(createTile(eff)); }); restartPreviewTimer();
    }
    function restartPreviewTimer(){
      if (previewTimer) { clearInterval(previewTimer); previewTimer = null; }
      if (!settings.livePreview) return;
      var interval = Math.max(1, Math.floor(1000 / clamp(settings.previewFps, 1, 30)));
      previewTimer = setInterval(function(){ previewRenders.forEach(function(item){ if (!settings.livePreview) return; item.ensure(); var r = item.rendererRef(); if (r) r.draw(); }); }, interval);
    }
    function drawThumbnailsOnce(){ previewRenders.forEach(function(item){ item.ensure(); var r=item.rendererRef(); if (r) r.draw(); }); }

    function activateTab(idx){
      if (idx === 0){ tab1Btn.classList.add('vjs-effects-active'); tab2Btn.classList.remove('vjs-effects-active'); panel1.classList.add('vjs-effects-active'); panel2.classList.remove('vjs-effects-active'); }
      else { tab2Btn.classList.add('vjs-effects-active'); tab1Btn.classList.remove('vjs-effects-active'); panel2.classList.add('vjs-effects-active'); panel1.classList.remove('vjs-effects-active'); }
    }
    tab1Btn.addEventListener('click', function(){ activateTab(0); });
    tab2Btn.addEventListener('click', function(){ activateTab(1); });

    var Button = videojs.getComponent('Button');
    class EffectsButton extends Button {
      constructor(player, options){ super(player, options); this.controlText('Effects'); }
      handleClick(){ toggleModal(); }
      buildCSSClass(){ return 'vjs-effects-button vjs-control vjs-button vjs-icon-placeholder'; }
    }
    videojs.registerComponent('EffectsButton', EffectsButton);
    player.ready(function(){ player.controlBar.addChild('EffectsButton', {}, player.controlBar.children().length - 1); });

    function openModal(){ overlay.classList.add('vjs-effects-open'); }
    function closeModal(){ overlay.classList.remove('vjs-effects-open'); }
    function toggleModal(){ overlay.classList.toggle('vjs-effects-open'); }

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', function(e){ if (e.target === overlay) closeModal(); });

    intensityRange.addEventListener('input', function(){ if (overlayRenderer) overlayRenderer.setIntensity(parseFloat(intensityRange.value)); });

    livePreviewToggle.addEventListener('change', function(){
      settings.livePreview = !!livePreviewToggle.checked;
      if (settings.livePreview) restartPreviewTimer(); else if (previewTimer) { clearInterval(previewTimer); previewTimer = null; }
      saveSettings(settings);
      if (!settings.livePreview) drawThumbnailsOnce();
    });

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

    [sDefaultIntensity, sGridCols, sPreviewSize, sPreviewFps, sDefaultEffect, sLivePreview, sHotToggleModal, sHotToggleEffect, sHotNext, sHotPrev, sHotIntUp, sHotIntDown, sHotTogglePreview].forEach(function(inp){ inp.addEventListener('change', applySettings); });

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

    function whenReady(){ if (!techEl || !techEl.videoWidth) return; ensureOverlayRenderer(); updateOverlayState(); }
    player.on('playing', whenReady); player.on('loadedmetadata', whenReady); player.on('resize', whenReady);

    player.on('dispose', function(){ document.removeEventListener('keydown', onKeyDown); if (previewTimer) { clearInterval(previewTimer); previewTimer = null; } if (stopOverlay) { stopOverlay(); stopOverlay = null; } });

    player.videojsEffectsApi = {
      setEffectByCode: function(code){ var idx = findEffectIndexByCode(code, EFFECTS); effectIndex = idx; ensureOverlayRenderer(); overlayRenderer.setEffect(EFFECTS[effectIndex]); },
      setIntensity: function(v){ intensityRange.value = String(clamp(v,0,1)); if (overlayRenderer) overlayRenderer.setIntensity(parseFloat(intensityRange.value)); },
      toggle: function(){ effectEnabled = !effectEnabled; updateOverlayState(); },
      open: function(){ overlay.classList.add('vjs-effects-open'); },
      close: function(){ overlay.classList.remove('vjs-effects-open'); }
    };
  }

  videojs.registerPlugin('videojs-effects', plugin);
})();