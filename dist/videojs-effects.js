'use strict';
(function(){
  if (typeof window === 'undefined' || typeof window.videojs === 'undefined') { return; }
  var videojs = window.videojs;
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function el(tag, className, attrs){ var e=document.createElement(tag); if(className) e.className=className; if(attrs){ Object.keys(attrs).forEach(function(k){ if(k==='text') e.textContent=attrs[k]; else if(k==='html') e.innerHTML=attrs[k]; else e.setAttribute(k, attrs[k]); }); } return e; }

  var DEFAULTS={
    defaultIntensity: 0.7,
    gridColumns: 4,
    previewSize: 120,
    livePreview: true,
    previewFps: 6,
    defaultEffectCode: 'none',
    hotkeysEnabled: true,
    effectsEnabled: true,
    showSettingsTab: true,
    showControlButton: true,
    controlIcon: 'vjs-icon-ef-magic',
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

  var STORAGE_KEY='videojs-effects-settings-v1';
  function loadSettings(){ try{ var raw=localStorage.getItem(STORAGE_KEY); return raw?JSON.parse(raw):null; }catch(e){ return null; } }
  function saveSettings(s){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }catch(e){} }

  var BASE_VERTEX_SHADER="\nattribute vec2 aPosition;\nattribute vec2 aTexCoord;\nvarying vec2 vTexCoord;\nvoid main(){ vTexCoord=aTexCoord; gl_Position=vec4(aPosition,0.0,1.0);}\n";

  function createGl(canvas){ var gl=canvas.getContext('webgl',{preserveDrawingBuffer:false,premultipliedAlpha:true,alpha:true}); if(!gl) throw new Error('WebGL not supported'); var vertices=new Float32Array([-1,-1,0,1, 1,-1,1,1, -1,1,0,0, 1,1,1,0]); var buffer=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW); var vao={ bind:function(program){ var aP=gl.getAttribLocation(program,'aPosition'); var aT=gl.getAttribLocation(program,'aTexCoord'); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP,2,gl.FLOAT,false,16,0); gl.enableVertexAttribArray(aT); gl.vertexAttribPointer(aT,2,gl.FLOAT,false,16,8); } }; var tex=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return {gl:gl, vao:vao, texture:tex}; }
  function compileShader(gl,type,src){ var s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){ var info=gl.getShaderInfoLog(s)||'Unknown shader error'; console.error('[videojs-effects] Shader compile error:', info); gl.deleteShader(s); throw new Error('Shader compile error: '+info);} return s; }
  function linkProgram(gl,vs,fs){ var v=compileShader(gl,gl.VERTEX_SHADER,vs); var f=compileShader(gl,gl.FRAGMENT_SHADER,fs); var p=gl.createProgram(); gl.attachShader(p,v); gl.attachShader(p,f); gl.linkProgram(p); if(!gl.getProgramParameter(p,gl.LINK_STATUS)){ var info=gl.getProgramInfoLog(p)||'Unknown link error'; gl.deleteProgram(p); throw new Error('Program link error: '+info);} return p; }
  function ensureSize(canvas,w,h){ var r=window.devicePixelRatio||1; var W=Math.max(2,Math.floor(w*r)); var H=Math.max(2,Math.floor(h*r)); if(canvas.width!==W||canvas.height!==H){ canvas.width=W; canvas.height=H; canvas.style.width=w+'px'; canvas.style.height=h+'px'; return true;} return false; }
  function findEffectIndexByCode(code,list){ for(var i=0;i<list.length;i++){ if(list[i].code===code) return i; } return 0; }

  function ShaderRenderer(canvas,source){ this.canvas=canvas; this.source=source; this.gl=null; this.texture=null; this.vao=null; this.programCache={}; this.currentProgram=null; this.uniforms=null; this.intensity=0.7; this.timeStart=performance.now(); this._init(); }
  ShaderRenderer.prototype._init=function(){ var out=createGl(this.canvas); this.gl=out.gl; this.vao=out.vao; this.texture=out.texture; };
  ShaderRenderer.prototype._programForFragment=function(fragment){ if(this.programCache[fragment]) return this.programCache[fragment]; var p=linkProgram(this.gl, BASE_VERTEX_SHADER, fragment); this.programCache[fragment]=p; return p; };
  ShaderRenderer.prototype.setEffect=function(effect){ var p=this._programForFragment(effect.fragment); this.currentProgram=p; this.uniforms={ uTexture:this.gl.getUniformLocation(p,'uTexture'), uResolution:this.gl.getUniformLocation(p,'uResolution'), uIntensity:this.gl.getUniformLocation(p,'uIntensity'), uTime:this.gl.getUniformLocation(p,'uTime') }; };
  ShaderRenderer.prototype.setIntensity=function(v){ this.intensity=clamp(v,0,1); };
  ShaderRenderer.prototype.setSource=function(src){ this.source = src; };
  ShaderRenderer.prototype.draw=function(){
    var gl=this.gl; if(!gl||!this.currentProgram||!this.source) return;
    var media=this.source;
    var parent=this.canvas.parentElement || this.canvas;
    var rect = parent.getBoundingClientRect ? parent.getBoundingClientRect() : null;
    var w = rect ? Math.max(2, Math.floor(rect.width)) : (parent.clientWidth||this.canvas.offsetWidth||media.videoWidth||640);
    var h = rect ? Math.max(2, Math.floor(rect.height)) : (parent.clientHeight||this.canvas.offsetHeight||media.videoHeight||360);
    ensureSize(this.canvas,w,h);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.currentProgram);
    this.vao.bind(this.currentProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    try{ gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,media); }catch(e){ return; }
    gl.uniform1i(this.uniforms.uTexture,0);
    gl.uniform2f(this.uniforms.uResolution,this.canvas.width,this.canvas.height);
    gl.uniform1f(this.uniforms.uIntensity,this.intensity);
    var t=(performance.now()-this.timeStart)/1000; gl.uniform1f(this.uniforms.uTime,t);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  };

  function plugin(options){
    var player=this;
    var saved = loadSettings() || {};
    var settings = Object.assign({}, DEFAULTS, options || {}, saved || {});

    var EFFECTS_SOURCE=(window.videojsEffectsList&&(window.videojsEffectsList.effects||window.videojsEffectsList))||[]; if(!Array.isArray(EFFECTS_SOURCE)||EFFECTS_SOURCE.length===0){ console.error('[videojs-effects] No effects found'); }
    var EFFECTS=EFFECTS_SOURCE;

    var effectIndex=findEffectIndexByCode(settings.defaultEffectCode, EFFECTS);
    var effectEnabled = settings.effectsEnabled && (settings.defaultEffectCode !== 'none');

    var playerEl=player.el(); var techEl=player.el().getElementsByClassName('vjs-tech')[0];
    var overlayCanvas=el('canvas','vjs-effects-canvas'); overlayCanvas.style.display='none'; var overlayRenderer=null;

    var overlay=el('div','vjs-effects-modal-overlay'); var modal=el('div','vjs-effects-modal'); var header=el('div','vjs-effects-modal-header'); var title=el('div','vjs-effects-modal-title',{text:'Video Effects'}); var closeBtn=el('button','vjs-effects-close',{'aria-label':'Close', text:'✕'}); header.appendChild(title); header.appendChild(closeBtn);

    var tabs=el('div','vjs-effects-tabs');
    var tab1Btn=el('button','vjs-effects-tab vjs-effects-active',{text:'Effects'});
    var tab2Btn=el('button','vjs-effects-tab',{text:'Settings'});
    tabs.appendChild(tab1Btn);
    if (settings.showSettingsTab) tabs.appendChild(tab2Btn);

    var panel1=el('div','vjs-effects-panel vjs-effects-active');
    var panel2=el('div','vjs-effects-panel');

    var controlsRow=el('div','vjs-effects-controls-row');
    var intensityLabel=el('label',null,{text:'Intensity'});
    var intensityRange=el('input'); intensityRange.type='range'; intensityRange.min='0'; intensityRange.max='1'; intensityRange.step='0.01'; intensityRange.value=String(settings.defaultIntensity);

    var livePreviewChip=el('label','vjs-effects-chip'); var livePreviewToggle=el('input','vjs-effects-toggle'); livePreviewToggle.type='checkbox'; livePreviewToggle.checked=!!settings.livePreview; livePreviewChip.appendChild(livePreviewToggle); livePreviewChip.appendChild(el('span',null,{text:'Live previews'}));

    controlsRow.appendChild(intensityLabel);
    controlsRow.appendChild(intensityRange);
    controlsRow.appendChild(livePreviewChip);

    var grid=el('div','vjs-effects-grid'); grid.style.gridTemplateColumns='repeat(' + settings.gridColumns + ', minmax(0, 1fr))';
    panel1.appendChild(controlsRow);
    panel1.appendChild(grid);

    var settingsGrid=el('div','vjs-effects-settings'); function makeSetting(labelText, inputEl){ var wrap=el('div','vjs-effects-setting'); wrap.appendChild(el('label',null,{text:labelText})); wrap.appendChild(inputEl); return wrap; }

    var sDefaultIntensity=el('input'); sDefaultIntensity.type='range'; sDefaultIntensity.min='0'; sDefaultIntensity.max='1'; sDefaultIntensity.step='0.01'; sDefaultIntensity.value=String(settings.defaultIntensity);
    var sGridCols=el('input'); sGridCols.type='number'; sGridCols.min='2'; sGridCols.max='8'; sGridCols.value=String(settings.gridColumns);
    var sPreviewSize=el('input'); sPreviewSize.type='number'; sPreviewSize.min='64'; sPreviewSize.max='240'; sPreviewSize.value=String(settings.previewSize);
    var sPreviewFps=el('input'); sPreviewFps.type='number'; sPreviewFps.min='1'; sPreviewFps.max='30'; sPreviewFps.value=String(settings.previewFps);

    var sDefaultEffect=el('select'); EFFECTS.forEach(function(eff){ var opt=el('option',null,{value:eff.code,text:eff.name+' ('+eff.code+')'}); if(eff.code===settings.defaultEffectCode) opt.selected=true; sDefaultEffect.appendChild(opt); });

    var sLivePreview=el('input','vjs-effects-toggle'); sLivePreview.type='checkbox'; sLivePreview.checked = !!settings.livePreview;

    var sThumbUrl=el('input'); sThumbUrl.type='url'; sThumbUrl.value = settings.thumbnailUrl || 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&w=512&q=60';

    var sEffectsEnabled=el('input','vjs-effects-toggle'); sEffectsEnabled.type='checkbox'; sEffectsEnabled.checked = !!settings.effectsEnabled;
    var sHotkeysEnabled=el('input','vjs-effects-toggle'); sHotkeysEnabled.type='checkbox'; sHotkeysEnabled.checked = !!settings.hotkeysEnabled;

    // Control button icon selection (10 friendly icons)
    var iconOptions = [
      {value:'vjs-icon-ef-magic', label:'Magic ✨'},
      {value:'vjs-icon-ef-spark', label:'Spark ⚡'},
      {value:'vjs-icon-ef-palette', label:'Palette 🎨'},
      {value:'vjs-icon-ef-gear', label:'Gear ⚙️'},
      {value:'vjs-icon-ef-wand', label:'Wand 🪄'},
      {value:'vjs-icon-ef-crystal', label:'Crystal 🔮'},
      {value:'vjs-icon-ef-camera', label:'Camera 📸'},
      {value:'vjs-icon-ef-wave', label:'Wave 🌊'},
      {value:'vjs-icon-ef-leaf', label:'Leaf 🌿'},
      {value:'vjs-icon-ef-star', label:'Star ⭐'}
    ];
    var sIconSelect = el('select');
    iconOptions.forEach(function(opt){ var o=el('option',null,{value:opt.value, text:opt.label}); if(opt.value===settings.controlIcon) o.selected=true; sIconSelect.appendChild(o); });

    settingsGrid.appendChild(makeSetting('Default intensity', sDefaultIntensity));
    settingsGrid.appendChild(makeSetting('Grid columns', sGridCols));
    settingsGrid.appendChild(makeSetting('Preview size (px)', sPreviewSize));
    settingsGrid.appendChild(makeSetting('Preview FPS', sPreviewFps));
    settingsGrid.appendChild(makeSetting('Default effect', sDefaultEffect));
    settingsGrid.appendChild(makeSetting('Grid live previews', sLivePreview));
    settingsGrid.appendChild(makeSetting('Thumbnail image URL (for non-live)', sThumbUrl));
    settingsGrid.appendChild(makeSetting('Effects enabled', sEffectsEnabled));
    settingsGrid.appendChild(makeSetting('Hotkeys enabled', sHotkeysEnabled));
    settingsGrid.appendChild(makeSetting('Control icon', sIconSelect));

    var hotkeyGroup = el('div', 'vjs-effects-settings-group'); hotkeyGroup.appendChild(el('div','vjs-effects-group-title',{text:'Hotkeys'}));
    function hotkeyInput(code){ var i=el('input','vjs-effects-hotkey-input'); i.type='text'; i.readOnly=true; i.value=code; i.addEventListener('keydown', function(ev){ ev.preventDefault(); i.value = ev.code || ev.key; i.dispatchEvent(new Event('change')); }); return i; }
    var sHotToggleModal=hotkeyInput(settings.hotkeys.toggleModal); var sHotToggleEffect=hotkeyInput(settings.hotkeys.toggleEffect); var sHotNext=hotkeyInput(settings.hotkeys.nextEffect); var sHotPrev=hotkeyInput(settings.hotkeys.prevEffect); var sHotIntUp=hotkeyInput(settings.hotkeys.intensityUp); var sHotIntDown=hotkeyInput(settings.hotkeys.intensityDown); var sHotTogglePreview=hotkeyInput(settings.hotkeys.toggleLivePreview);
    hotkeyGroup.appendChild(makeSetting('Toggle modal', sHotToggleModal));
    hotkeyGroup.appendChild(makeSetting('Toggle effect', sHotToggleEffect));
    hotkeyGroup.appendChild(makeSetting('Next effect', sHotNext));
    hotkeyGroup.appendChild(makeSetting('Previous effect', sHotPrev));
    hotkeyGroup.appendChild(makeSetting('Intensity up', sHotIntUp));
    hotkeyGroup.appendChild(makeSetting('Intensity down', sHotIntDown));
    hotkeyGroup.appendChild(makeSetting('Toggle live previews', sHotTogglePreview));
    if (settings.showSettingsTab) panel2.appendChild(settingsGrid), panel2.appendChild(hotkeyGroup);

    modal.appendChild(header); modal.appendChild(tabs); modal.appendChild(panel1); if (settings.showSettingsTab) modal.appendChild(panel2); overlay.appendChild(modal);

    var playerElPos=getComputedStyle(playerEl).position; if(playerElPos==='static'||!playerElPos) playerEl.style.position = 'relative'; playerEl.appendChild(overlay);
    var parentNode=techEl&&techEl.parentNode?techEl.parentNode:playerEl; var parentPos=getComputedStyle(parentNode).position; if(parentPos==='static'||!parentPos) parentNode.style.position='relative'; parentNode.appendChild(overlayCanvas);

    function ensureOverlayRenderer(){ if(!overlayRenderer){ overlayRenderer=new ShaderRenderer(overlayCanvas, techEl); overlayRenderer.setEffect(EFFECTS[effectIndex]||EFFECTS[0]); overlayRenderer.setIntensity(settings.defaultIntensity);} }
    function startOverlayLoop(){ ensureOverlayRenderer(); overlayCanvas.style.display = (settings.effectsEnabled && effectEnabled) ? 'block' : 'none'; if(!(settings.effectsEnabled && effectEnabled)) return; var running=true; function loop(){ if(!running) return; overlayRenderer.draw(); requestAnimationFrame(loop);} requestAnimationFrame(loop); return function stop(){ running=false; }; }
    var stopOverlay=null;
    function updateOverlayState(){ if(settings.effectsEnabled && effectEnabled){ if(!stopOverlay) stopOverlay=startOverlayLoop(); } else { if(stopOverlay){ stopOverlay(); stopOverlay=null; } overlayCanvas.style.display='none'; } }

    var previewSharedCanvas=document.createElement('canvas'); previewSharedCanvas.width=settings.previewSize; previewSharedCanvas.height=settings.previewSize; var previewRenderer=null; var previewImage=new Image(); previewImage.crossOrigin='anonymous'; previewImage.src=settings.thumbnailUrl || 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&w=512&q=60';
    var previewRenders=[]; var previewTimer=null; var tiles=[];
    function ensurePreviewRenderer(source){ if(!previewRenderer){ previewRenderer=new ShaderRenderer(previewSharedCanvas, source); } else { previewRenderer.setSource(source); } }
    function drawTilePreview(effect, tileCanvas){ var media = settings.livePreview ? techEl : (previewImage && previewImage.complete ? previewImage : null); if(!media) return; ensurePreviewRenderer(media); previewRenderer.setEffect(effect); previewRenderer.setIntensity(settings.defaultIntensity); previewRenderer.draw(); var ctx = tileCanvas.getContext('2d'); ctx.clearRect(0,0,tileCanvas.width,tileCanvas.height); ctx.drawImage(previewSharedCanvas, 0, 0, tileCanvas.width, tileCanvas.height); }
    function markSelected(){ tiles.forEach(function(t){ t.classList.toggle('vjs-effects-selected', t.dataset.code === (EFFECTS[effectIndex] && EFFECTS[effectIndex].code)); }); }
    function createTile(effect){ var tile=el('div','vjs-effects-tile'); tile.dataset.code = effect.code; var head=el('div','vjs-effects-tile-header'); head.appendChild(el('div','vjs-effects-tile-name',{text: effect.name})); head.appendChild(el('div','vjs-effects-tile-code',{text: effect.code})); var canvas=el('canvas','vjs-effects-tile-canvas'); canvas.width=settings.previewSize; canvas.height=settings.previewSize; tile.appendChild(head); tile.appendChild(canvas); tile.addEventListener('click', function(){ if(effect.code==='none'){ effectIndex = findEffectIndexByCode('none', EFFECTS); effectEnabled=false; } else { effectIndex= findEffectIndexByCode(effect.code, EFFECTS); ensureOverlayRenderer(); overlayRenderer.setEffect(EFFECTS[effectIndex]); overlayRenderer.setIntensity(parseFloat(intensityRange.value)); effectEnabled=true; } settings.defaultEffectCode = effect.code; saveSettings(settings); updateOverlayState(); markSelected(); }); previewRenders.push({ effect:effect, canvas:canvas }); tiles.push(tile); return tile; }
    function buildGrid(){ grid.innerHTML=''; grid.style.gridTemplateColumns='repeat(' + settings.gridColumns + ', minmax(0, 1fr))'; previewRenders=[]; tiles=[]; EFFECTS.forEach(function(eff){ grid.appendChild(createTile(eff)); }); markSelected(); restartPreviewTimer(); if(!settings.livePreview){ if (previewImage.complete) { drawThumbnailsOnce(); } else { previewImage.onload = drawThumbnailsOnce; } } }
    function restartPreviewTimer(){ if(previewTimer){ clearInterval(previewTimer); previewTimer=null; } if(!settings.livePreview) return; var interval=Math.max(1, Math.floor(1000/ clamp(settings.previewFps,1,30))); previewTimer=setInterval(function(){ previewRenders.forEach(function(item){ drawTilePreview(item.effect, item.canvas); }); }, interval); }
    function drawThumbnailsOnce(){ previewRenders.forEach(function(item){ drawTilePreview(item.effect, item.canvas); }); }

    function activateTab(idx){ if(!settings.showSettingsTab) return; if (idx===0){ tab1Btn.classList.add('vjs-effects-active'); tab2Btn.classList.remove('vjs-effects-active'); panel1.classList.add('vjs-effects-active'); panel2.classList.remove('vjs-effects-active'); } else { tab2Btn.classList.add('vjs-effects-active'); tab1Btn.classList.remove('vjs-effects-active'); panel2.classList.add('vjs-effects-active'); panel1.classList.remove('vjs-effects-active'); } }
    tab1Btn.addEventListener('click',function(){ activateTab(0); }); if (settings.showSettingsTab) tab2Btn.addEventListener('click',function(){ activateTab(1); });

    var Button=videojs.getComponent('Button');
    class EffectsButton extends Button { constructor(player, options){ super(player, options); this.controlText('Effects'); } handleClick(){ toggleModal(); } buildCSSClass(){ return 'vjs-effects-button vjs-control vjs-button ' + (settings.controlIcon || 'vjs-icon-placeholder'); } }
    if (settings.showControlButton) videojs.registerComponent('EffectsButton', EffectsButton);

    player.ready(function(){ if (settings.showControlButton) player.controlBar.addChild('EffectsButton', {}, player.controlBar.children().length - 1); });

    function openModal(){ overlay.classList.add('vjs-effects-open'); }
    function closeModal(){ overlay.classList.remove('vjs-effects-open'); }
    function toggleModal(){ overlay.classList.toggle('vjs-effects-open'); }

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', function(e){ if (e.target === overlay) closeModal(); });

    intensityRange.addEventListener('input', function(){ settings.defaultIntensity = parseFloat(intensityRange.value); saveSettings(settings); if (overlayRenderer) overlayRenderer.setIntensity(settings.defaultIntensity); if (!settings.livePreview) drawThumbnailsOnce(); });

    livePreviewToggle.addEventListener('change', function(){ settings.livePreview = !!livePreviewToggle.checked; sLivePreview.checked = settings.livePreview; saveSettings(settings); if (settings.livePreview) restartPreviewTimer(); else { if (previewTimer) { clearInterval(previewTimer); previewTimer=null; } drawThumbnailsOnce(); } });
    sLivePreview.addEventListener('change', function(){ livePreviewToggle.checked = sLivePreview.checked; livePreviewToggle.dispatchEvent(new Event('change')); });

    function applySettings(){
      settings.defaultIntensity = parseFloat(sDefaultIntensity.value);
      settings.gridColumns = clamp(parseInt(sGridCols.value,10)||4, 2, 8);
      settings.previewSize = clamp(parseInt(sPreviewSize.value,10)||120, 64, 240);
      settings.previewFps = clamp(parseInt(sPreviewFps.value,10)||6, 1, 30);
      settings.defaultEffectCode = sDefaultEffect.value || settings.defaultEffectCode;
      settings.thumbnailUrl = sThumbUrl.value;
      settings.livePreview = !!sLivePreview.checked;
      settings.effectsEnabled = !!sEffectsEnabled.checked;
      settings.hotkeysEnabled = !!sHotkeysEnabled.checked;
      settings.controlIcon = sIconSelect.value || settings.controlIcon;
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
      // update icon on button
      var btn = player.controlBar && player.controlBar.getChild && player.controlBar.getChild('EffectsButton');
      if (btn && btn.el) {
        var elBtn = btn.el(); elBtn.className = elBtn.className.replace(/vjs-icon-ef-[^\s]+/g, '').trim(); elBtn.classList.add(settings.controlIcon);
      }
      buildGrid();
      effectIndex = findEffectIndexByCode(settings.defaultEffectCode, EFFECTS);
      markSelected();
      ensureOverlayRenderer(); overlayRenderer.setEffect(EFFECTS[effectIndex]); overlayRenderer.setIntensity(settings.defaultIntensity);
      effectEnabled = settings.effectsEnabled && (settings.defaultEffectCode !== 'none');
      updateOverlayState();
    }

    [sDefaultIntensity, sGridCols, sPreviewSize, sPreviewFps, sDefaultEffect, sLivePreview, sEffectsEnabled, sHotkeysEnabled, sIconSelect,
     sHotToggleModal, sHotToggleEffect, sHotNext, sHotPrev, sHotIntUp, sHotIntDown, sHotTogglePreview, sThumbUrl
    ].forEach(function(inp){ inp.addEventListener('change', applySettings); });

    function onKeyDown(ev){ if (!settings.hotkeysEnabled) return; var tag=(ev.target&&ev.target.tagName)?ev.target.tagName.toLowerCase():''; if(tag==='input'||tag==='textarea'||ev.target.isContentEditable) return; var code=ev.code||ev.key; if (code===settings.hotkeys.toggleModal){ ev.preventDefault(); toggleModal(); return; } if (code===settings.hotkeys.toggleEffect){ ev.preventDefault(); effectEnabled=!effectEnabled; updateOverlayState(); return; } if (code===settings.hotkeys.nextEffect){ ev.preventDefault(); effectIndex=(effectIndex+1)%EFFECTS.length; ensureOverlayRenderer(); overlayRenderer.setEffect(EFFECTS[effectIndex]); effectEnabled=true; updateOverlayState(); markSelected(); return; } if (code===settings.hotkeys.prevEffect){ ev.preventDefault(); effectIndex=(effectIndex-1+EFFECTS.length)%EFFECTS.length; ensureOverlayRenderer(); overlayRenderer.setEffect(EFFECTS[effectIndex]); effectEnabled=true; updateOverlayState(); markSelected(); return; } if (code===settings.hotkeys.intensityUp){ ev.preventDefault(); var v=clamp(parseFloat(intensityRange.value)+0.05,0,1); intensityRange.value=String(v); settings.defaultIntensity=v; saveSettings(settings); if (overlayRenderer) overlayRenderer.setIntensity(v); if (!settings.livePreview) drawThumbnailsOnce(); return; } if (code===settings.hotkeys.intensityDown){ ev.preventDefault(); var v2=clamp(parseFloat(intensityRange.value)-0.05,0,1); intensityRange.value=String(v2); settings.defaultIntensity=v2; saveSettings(settings); if (overlayRenderer) overlayRenderer.setIntensity(v2); if (!settings.livePreview) drawThumbnailsOnce(); return; } if (code===settings.hotkeys.toggleLivePreview){ ev.preventDefault(); livePreviewToggle.checked=!livePreviewToggle.checked; livePreviewToggle.dispatchEvent(new Event('change')); return; } }
    document.addEventListener('keydown', onKeyDown);

    buildGrid(); effectIndex = findEffectIndexByCode(settings.defaultEffectCode, EFFECTS); markSelected(); if (settings.effectsEnabled && settings.defaultEffectCode!=='none'){ ensureOverlayRenderer(); overlayRenderer.setEffect(EFFECTS[effectIndex]); overlayRenderer.setIntensity(settings.defaultIntensity); effectEnabled=true; updateOverlayState(); }

    function whenReady(){ if(!techEl||!techEl.videoWidth) return; ensureOverlayRenderer(); updateOverlayState(); }
    player.on('playing', whenReady); player.on('loadedmetadata', whenReady); player.on('resize', whenReady); player.on('fullscreenchange', whenReady);

    player.on('dispose', function(){ document.removeEventListener('keydown', onKeyDown); if (previewTimer){ clearInterval(previewTimer); previewTimer=null; } if (stopOverlay){ stopOverlay(); stopOverlay=null; } });

    player.videojsEffectsApi={ setEffectByCode:function(code){ var idx=findEffectIndexByCode(code,EFFECTS); effectIndex=idx; ensureOverlayRenderer(); overlayRenderer.setEffect(EFFECTS[effectIndex]); effectEnabled=(code!=='none'); updateOverlayState(); markSelected(); }, setIntensity:function(v){ intensityRange.value=String(clamp(v,0,1)); settings.defaultIntensity=parseFloat(intensityRange.value); saveSettings(settings); if(overlayRenderer) overlayRenderer.setIntensity(parseFloat(intensityRange.value)); if(!settings.livePreview){ drawThumbnailsOnce(); } }, toggle:function(){ effectEnabled=!effectEnabled; updateOverlayState(); }, open:function(){ overlay.classList.add('vjs-effects-open'); }, close:function(){ overlay.classList.remove('vjs-effects-open'); } };
  }

  videojs.registerPlugin('videojs-effects', plugin);
})();