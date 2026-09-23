(function(){
  'use strict';
  function download(data,name,type='application/json'){const blob=new Blob([typeof data==='string'?data:JSON.stringify(data,null,2)],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function install(api){
    const host=document.createElement('section');host.className='card glass span2';
    host.innerHTML='<details id="devPanel"><summary>Developer diagnostics / numeric session replay</summary><p class="hint">Quality and confidence are engineering indicators, not clinical probabilities. Recording saves selected numeric features at inference rate, capped at 54,000 frames (~30 minutes at 30 FPS). Full-rate replay is deterministic; optional downsampling can miss brief gestures.</p><pre id="devReadout"></pre><div class="row"><button class="btn small" id="recordStart">Record numeric session</button><button class="btn small" id="recordStop">Stop recording</button><button class="btn small" id="sessionRefresh">Refresh sessions</button></div><select id="sessionSelect" aria-label="Recorded session"></select><div class="row"><button class="btn small" id="sessionJson">Export JSON</button><button class="btn small" id="sessionCsv">Export CSV</button><button class="btn small" id="sessionReplay">Replay saved session</button><button class="btn small danger" id="sessionDelete">Delete selected session</button></div><label class="hint">Import numeric JSON replay <input type="file" id="replayFile" accept="application/json,.json"></label><pre id="replayTimeline"></pre><label class="hint">Runtime detector configuration (JSON)</label><textarea id="detectorConfig" rows="10" aria-label="Detector configuration"></textarea><div class="row"><button class="btn small" id="configApply">Apply configuration</button><button class="btn small" id="configReset">Reset defaults</button><button class="btn small" id="adaptReset">Reset adaptive baseline</button></div><p id="devStatus" role="status"></p></details>';
    document.querySelector('main').append(host);const $=id=>document.getElementById(id),status=t=>{$('devStatus').textContent=t;};
    const safe=fn=>async()=>{try{await fn();}catch(e){status(e.message);}};
    const editor=document.createElement('div');
    editor.innerHTML='<p class="hint">Patient thresholds (temporary developer overrides; validated calibration stays unchanged)</p><textarea id="baselineConfig" rows="7" aria-label="Patient thresholds"></textarea><div class="row"><button class="btn small" id="baselineLoad">Load current thresholds</button><button class="btn small" id="baselineApply">Apply temporary thresholds</button><button class="btn small" id="baselineRestore">Restore saved calibration</button></div>';
    $('devStatus').before(editor);
    $('baselineLoad').onclick=()=>{$('baselineConfig').value=JSON.stringify(api.engine().baseline,null,2);};
    $('baselineApply').onclick=safe(async()=>{await api.thresholds(JSON.parse($('baselineConfig').value));status('Temporary thresholds applied. Revalidate before relying on communication.');});
    $('baselineRestore').onclick=safe(async()=>{await api.restoreThresholds();$('baselineConfig').value=JSON.stringify(api.engine().baseline,null,2);status('Saved calibration restored.');});
    const refresh=async()=>{const rows=await NF_storage.all('sessions'),sel=$('sessionSelect');sel.replaceChildren();for(const r of rows.reverse()){const o=document.createElement('option');o.value=r.id;o.textContent=new Date(r.startedAt).toLocaleString()+' · '+r.kind+' · '+r.status;sel.append(o);}};
    $('detectorConfig').value=JSON.stringify(api.engine().config,null,2);
    $('recordStart').onclick=safe(async()=>{await api.record();status('Recording selected numeric features locally.');await refresh();});
    $('recordStop').onclick=safe(async()=>{await api.stopRecord();status('Recording saved.');await refresh();});
    $('sessionRefresh').onclick=safe(refresh);
    const selected=async()=>{await api.flush();return NF_storage.exportSession($('sessionSelect').value);};
    $('sessionJson').onclick=safe(async()=>download(await selected(),'neuroface-session.json'));
    $('sessionCsv').onclick=safe(async()=>download(NF_storage.csv(await selected()),'neuroface-features.csv','text/csv'));
    function replay(data){const rows=Array.isArray(data)?data:data.frameFeatures?.map(x=>x.features);if(!rows||rows.length>100000)throw new Error('Expected at most 100,000 numeric frames');
      const r=NF_engine.replay(rows,{baseline:data.session?.baseline,config:data.session?.config});
      const timeline=[...r.transitions,...r.events,...r.commands].sort((a,b)=>a.timestamp-b.timestamp);
      $('replayTimeline').textContent=timeline.map(e=>(e.timestamp/1000).toFixed(3)+' '+(e.type||e.detector+' '+e.from+' → '+e.to)+(e.command?' → '+e.command:'')+(e.reason?' · '+e.reason:'')).join('\n')||'No completed events.';
      status('Replay: '+r.events.length+' gesture events, '+r.commands.length+' commands. Replay never speaks or changes the live engine.');}
    $('sessionReplay').onclick=safe(async()=>replay(await selected()));
    $('sessionDelete').onclick=safe(async()=>{const id=$('sessionSelect').value;if(id&&confirm('Delete this numeric recording? This cannot be undone.')){await NF_storage.deleteSession(id);await refresh();status('Selected recording deleted.');}});
    $('replayFile').onchange=safe(async()=>{const file=$('replayFile').files[0];if(!file)return;if(file.size>50*1024*1024)throw new Error('Replay file too large (50 MB limit)');replay(JSON.parse(await file.text()));});
    $('configApply').onclick=safe(async()=>{const c=NF_engine.config(JSON.parse($('detectorConfig').value));await api.configure(c);status('Applied; incomplete gestures and command buffers reset.');});
    $('configReset').onclick=safe(async()=>{await api.configure(NF_engine.config());$('detectorConfig').value=JSON.stringify(api.engine().config,null,2);status('Defaults restored.');});
    $('adaptReset').onclick=()=>{api.engine().resetAdaptation();status('Original calibrated baseline restored.');};
    let last=0;return {status,render(result){if(!$('devPanel').open||performance.now()-last<200)return;last=performance.now();const e=api.engine(),f=result.features||{},raw=result.raw||{};
      $('devReadout').textContent=JSON.stringify({accepted:result.accepted,reason:result.reason,quality:raw.faceQuality,confidenceSource:raw.confidenceSource,rawEAR:[raw.earLeft,raw.earRight],filteredEAR:[f.earLeft,f.earRight],rawYaw:raw.yaw,filteredYaw:f.yaw,relativeYaw:f.relativeYaw,states:result.states,blinkConfidence:e.blink.confidence,smile:result.smile,commandBuffers:result.progress,thresholds:e.baseline,recentTransitions:e.trace.slice(-12)},null,2);}};
  }
  window.NF_diagnostics={install,download};
})();
