(function(root,factory){const E=typeof module==='object'&&module.exports?require('./engine.js'):root.NF_engine;const api=factory(E);if(typeof module==='object'&&module.exports)module.exports=api;else root.NF_calibration=api;})(globalThis,function(E){
  'use strict';
  const STEPS=[
    {id:'quality',label:'Camera / face quality: face the camera',ms:2000},
    {id:'neutral',label:'Relax your face and look at the camera',ms:3500,still:true},
    {id:'eyes',label:'Keep your eyes comfortably open',ms:3000,still:true},
    {id:'blink',label:'Blink deliberately three times; fully reopen each time',ms:3000,event:'BLINK_COMPLETED'},
    {id:'closedSmile',label:'Smile with closed lips, then relax — three times',ms:3000,event:'SMILE_COMPLETED'},
    {id:'smile',label:'Smile as much as is comfortable, then relax — three times',ms:3000,event:'SMILE_COMPLETED'},
    {id:'pucker',label:'Pucker your lips, then relax — three times',ms:3000,event:'PUCKER_COMPLETED'},
    {id:'left',label:'Turn gently to your LEFT, then return to center — three times',ms:3000,event:'LEFT_TURN_COMPLETED'},
    {id:'right',label:'Turn gently to your RIGHT, then return to center — three times',ms:3000,event:'RIGHT_TURN_COMPLETED'},
    {id:'pitch',label:'Move your head gently up and down, returning to center',ms:4000},
    {id:'nod',label:'Nod gently, then return to center — three times',ms:3000,event:'NOD_COMPLETED'},
    {id:'neutralEnd',label:'Relax and face the camera again',ms:3000,still:true},
    {id:'validation',label:'Validate: one blink, closed smile, left-return, right-return and nod',ms:0}
  ];
  const REQUIRED=['BLINK_COMPLETED','SMILE_HELD','LEFT_TURN_COMPLETED','RIGHT_TURN_COMPLETED','NOD_COMPLETED'];
  function quality(f,step,c=E.DEFAULTS.quality){
    const reasons=[];
    if(!f.facePresent)reasons.push('Face not visible');
    else {
      if(f.faceQuality<.65||!f.poseValid||!f.blendshapesValid)reasons.push('Tracking not stable / features unavailable');
      if(f.faceSize<c.minFaceSize)reasons.push('Move slightly closer');
      if(f.faceSize>c.maxFaceSize)reasons.push('Move slightly farther away');
      if(!f.inFrame||Math.abs(f.centerX-.5)>.25||Math.abs(f.centerY-.5)>.3)reasons.push('Center your face');
      if(!Number.isFinite(f.brightness))reasons.push('Lighting could not be measured');
      else if(f.brightness<c.minLight)reasons.push('Lighting too low');else if(f.brightness>c.maxLight)reasons.push('Lighting too bright');
      if(f.fps<c.minFps)reasons.push('Frame rate too low');
      if(step.still&&f.poseSpeed>12)reasons.push('Hold still');
      if(step.still&&(Math.abs(f.yaw)>30||Math.abs(f.pitch)>40))reasons.push('Face camera');
      if(step.id==='eyes'&&(f.eyeBlinkLeft>.3||f.eyeBlinkRight>.3))reasons.push('Keep eyes open');
      if(step.id==='closedSmile'&&f.jawOpen>.2)reasons.push('Keep lips closed');
    }
    return {ok:!reasons.length,reasons,indicators:{position:f.inFrame?'in frame':'adjust',lighting:f.brightness===null?'unknown':Math.round(f.brightness||0),tracking:f.faceQuality||0,frameRate:Math.round(f.fps||0),blur:'proxy only; no calibrated blur/occlusion classifier'}};
  }
  const KEYS=['earLeft','earRight','earMean','eyeBlinkLeft','eyeBlinkRight','mouthSmileLeft','mouthSmileRight','cheekSquintLeft','cheekSquintRight','mouthPucker','jawOpen','mouthClose','yaw','pitch','roll','mouthCornerLeftX','mouthCornerLeftY','mouthCornerRightX','mouthCornerRightY','mouthWidth','browGap','lipDeviation','faceQuality'];
  function summarize(frames){const o={};for(const k of KEYS)o[k]=E.stats(frames.map(f=>f[k]));return o;}
  function build(stages,previous){
    const b={...E.baseline(),...previous};
    const get=(s,k,q='median',fallback=0)=>stages[s]?.stats[k]?.[q]??fallback;
    if(stages.neutral){
      b.neutralYaw=get('neutral','yaw');b.neutralPitch=get('neutral','pitch');b.neutralRoll=get('neutral','roll');
      for(const s of ['Left','Right']){b['neutralEAR'+s]=get(stages.eyes?'eyes':'neutral','ear'+s,'median',.27);b['neutralSmile'+s]=get('neutral','mouthSmile'+s,'median',.02);b['corner'+s+'X']=get('neutral','mouthCorner'+s+'X');b['corner'+s+'Y']=get('neutral','mouthCorner'+s+'Y');}
      b.puckerBaseline=get('neutral','mouthPucker');b.symmetryBaseline=100;
    }
    if(stages.blink){
      const open=(b.neutralEARLeft+b.neutralEARRight)/2,closed=get('blink','earMean','p5',open*.45);
      b.blinkClosedEAR=closed+(open-closed)*.35;b.blinkOpenEAR=closed+(open-closed)*.75;
      b.blinkClosedRatio=E.clamp(b.blinkClosedEAR/open,.25,.92);b.blinkOpenRatio=E.clamp(Math.max(b.blinkClosedRatio+.06,b.blinkOpenEAR/open),.4,.98);
      const d=E.stats(stages.blink.events.map(e=>e.duration));if(d){b.intentionalBlinkDurationMedian=d.median;b.intentionalBlinkDurationMAD=d.mad;b.deliberateCalibrated=true;}
      b.intentionalBlinkAmplitude=E.stats(stages.blink.events.map(e=>e.amplitude))?.median??.65;
    }
    for(const s of ['Left','Right']){
      const neutral=b['neutralSmile'+s],noise=get('neutral','mouthSmile'+s,'mad',.005);
      b['maxSmile'+s]=Math.max(neutral+.035,get('smile','mouthSmile'+s,'p95',get('closedSmile','mouthSmile'+s,'p95',.7)));
      const closed=get('closedSmile','mouthSmile'+s,'p95',b['maxSmile'+s]);
      b['closedSmileThreshold'+s]=Math.max(neutral+noise*3,neutral+(closed-neutral)*.3);
    }
    for(const [stage,sign] of [['left',-1],['right',1]])if(stages[stage]){
      const amplitude=Math.abs(get(stage,'yaw',sign<0?'p5':'p95',b.neutralYaw)-b.neutralYaw);
      if(amplitude<2)throw new Error(stage+' movement not separable from neutral; retry this gesture');
      b[stage+'TurnEnterThreshold']=Math.max(1.5,amplitude*.55);b[stage+'TurnExitThreshold']=amplitude*.3;
      b['comfortable'+(sign<0?'Left':'Right')+'Yaw']=sign*amplitude;
    }
    b.centerYawTolerance=Math.min(b.leftTurnExitThreshold,b.rightTurnExitThreshold)*.65;
    if(stages.nod){const up=Math.abs(get('nod','pitch','p5')-b.neutralPitch),down=Math.abs(get('nod','pitch','p95')-b.neutralPitch);b.nodDirection=up>down?-1:1;b.nodRange=Math.max(1.5,Math.max(up,down)*.55);b.centerPitchTolerance=b.nodRange*.3;}
    if(stages.pucker)b.puckerRange=Math.max(.05,get('pucker','mouthPucker','p95')-b.puckerBaseline);
    b.calibrated=true;return b;
  }
  class Manager {
    constructor(previous){this.step=0;this.stages={};this.frames=[];this.events=[];this.collecting=false;this.validMs=0;this.lastT=null;this.validation={};this.previous=previous;this.candidate=null;this.retrying=false;}
    start(){this.frames=[];this.events=[];this.validMs=0;this.lastT=null;this.lastDiscovery=-Infinity;this.collecting=true;if(this.step===12)this.validation={};}
    pause(){this.collecting=false;this.lastT=null;}
    retry(id){const i=STEPS.findIndex(x=>x.id===id);if(i<0||i===12)throw new Error('Unknown calibration gesture');if(!this.previous?.calibrated&&!this.stages.neutralEnd)throw new Error('Finish the initial capture steps before recalibrating one gesture');this.step=i;this.retrying=true;this.start();}
    update(f,events){
      const step=STEPS[this.step];if(!step)return {done:true};
      const q=quality(f,step);this.feedback=q;
      if(!this.collecting)return {quality:q};
      if(!q.ok){this.lastT=null;return {quality:q,paused:true};}
      if(this.lastT!==null&&f.timestamp-this.lastT<250)this.validMs+=f.timestamp-this.lastT;
      this.lastT=f.timestamp;
      if(this.frames.length<12000)this.frames.push({...f});
      if(step.id==='validation'){
        for(const e of events)if(REQUIRED.includes(e.type)&&e.confidence>=.58&&(e.type!=='SMILE_HELD'||e.closedMouthSmile))this.validation[e.type]=e.confidence;
        if(REQUIRED.every(k=>this.validation[k])){this.collecting=false;this.step=13;return {validated:true,baseline:this.candidate,quality:q};}
      }else{
        // Enrollment must not require healthy-person amplitudes to learn reduced movement.
        // Replay this stage against its measured range, still requiring completed temporal cycles.
        if(step.event&&this.validMs>=1000&&f.timestamp-this.lastDiscovery>=500){
          this.lastDiscovery=f.timestamp;
          const observed=summarize(this.frames),draft={...this.stages,[step.id]:{stats:observed,events:[]}};
          try{
            const b=build(draft,this.candidate||this.previous),neutral=this.stages.neutral?.stats;
            let separable=true;
            if(step.id==='blink')separable=observed.earMean.p95-observed.earMean.p5>Math.max(.02,(neutral?.earMean?.mad||0)*4);
            if(step.id==='closedSmile'||step.id==='smile')separable=['Left','Right'].some(s=>observed['mouthSmile'+s].p95-b['neutralSmile'+s]>Math.max(.025,(neutral?.['mouthSmile'+s]?.mad||0)*4));
            if(step.id==='pucker')separable=observed.mouthPucker.p95-b.puckerBaseline>Math.max(.04,(neutral?.mouthPucker?.mad||0)*4);
            if(step.id==='left'||step.id==='right')separable=observed.yaw.p95-observed.yaw.p5>Math.max(2,(neutral?.yaw?.mad||0)*4);
            if(step.id==='nod')separable=observed.pitch.p95-observed.pitch.p5>Math.max(2,(neutral?.pitch?.mad||0)*4);
            if(separable){
              const r=E.replay(this.frames,{baseline:b,config:{smoothing:{blink:0,smile:0,pose:0,geometry:0}}});
              this.events=r.events.filter(e=>e.type===step.event);
            }else this.events=[];
          }catch(e){this.feedback={...q,ok:false,reasons:[e.message]};this.events=[];}
        }
        if(this.validMs>=step.ms&&(!step.event||this.events.length>=3)){
          this.stages[step.id]={stats:summarize(this.frames),events:this.events.slice(),validMs:this.validMs,capturedAt:new Date().toISOString()};
          this.collecting=false;const completed=step.id;this.frames=[];this.events=[];
          this.candidate=build(this.stages,this.previous);
          if(this.retrying){this.step=12;this.retrying=false;}else this.step++;
          return {stepCompleted:completed,baseline:this.candidate,quality:q};
        }
      }
      return {quality:q};
    }
  }
  return {STEPS,REQUIRED,KEYS,quality,summarize,build,Manager};
});
