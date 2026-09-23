/* Deterministic, DOM-free temporal recognition. All times are milliseconds. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NF_engine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const copy = x => JSON.parse(JSON.stringify(x));
  const DEFAULTS = {
    blink: { minMs: 65, maxMs: 1400, confirmMs: 30, reopenMs: 25, refractoryMs: 150, deliberateMinMs: 260, confidence: .58 },
    head: { holdMs: 130, centerMs: 140, maxMs: 7000, refractoryMs: 200 },
    nod: { holdMs: 100, centerMs: 130, maxMs: 4000, refractoryMs: 250 },
    smile: { enter: .34, exit: .20, startMs: 140, heldMs: 450, returnMs: 150 },
    pucker: { enter: .4, exit: .2, holdMs: 180 },
    tracking: { minQuality: .65, resetMs: 300, maxGapMs: 220 },
    commands: { blinkWindowMs: 5000, turnWindowMs: 8000, cooldownMs: 3000, fusionMs: 1000, minConfidence: .58, facingYaw: 14, facingPitch: 24 },
    smoothing: { blink: 16, smile: 65, pose: 75, geometry: 65 },
    quality: { minFaceSize: .13, maxFaceSize: .85, minLight: 28, maxLight: 245, minFps: 8 },
    recording: { sampleMs: 0, maxFrames: 54000 },
    developer: false
  };
  function config(overrides = {}) {
    const c = copy(DEFAULTS);
    for (const k of Object.keys(c)) if (overrides[k] !== undefined) {
      if (typeof c[k] === 'object') {
        for (const key of Object.keys(c[k])) if (overrides[k][key] !== undefined) {
          const n = overrides[k][key];
          if (!Number.isFinite(n) || n < 0) throw new Error('Invalid setting: ' + k + '.' + key);
          c[k][key] = n;
        }
      } else c[k] = !!overrides[k];
    }
    if (c.blink.minMs >= c.blink.maxMs || c.smile.exit >= c.smile.enter || c.pucker.exit >= c.pucker.enter || c.recording.maxFrames < 1) throw new Error('Invalid timing/hysteresis configuration');
    return c;
  }
  function baseline() {
    return { neutralEARLeft: .27, neutralEARRight: .27, blinkClosedEAR: .16, blinkOpenEAR: .215,
      blinkClosedRatio: .60, blinkOpenRatio: .80, intentionalBlinkDurationMedian: 400, intentionalBlinkDurationMAD: 70,
      intentionalBlinkAmplitude: .65, deliberateCalibrated: false,
      neutralSmileLeft: .02, neutralSmileRight: .02, maxSmileLeft: .7, maxSmileRight: .7,
      closedSmileThresholdLeft: .22, closedSmileThresholdRight: .22,
      neutralYaw: 0, neutralPitch: 0, neutralRoll: 0,
      comfortableLeftYaw: -22, comfortableRightYaw: 22, leftTurnEnterThreshold: 13, leftTurnExitThreshold: 7,
      rightTurnEnterThreshold: 13, rightTurnExitThreshold: 7, centerYawTolerance: 5,
      nodRange: 12, nodDirection: 1, centerPitchTolerance: 4, puckerBaseline: 0, puckerRange: .7,
      symmetryBaseline: 100, cornerLeftX: .2, cornerLeftY: 0, cornerRightX: -.2, cornerRightY: 0, calibrated: false };
  }
  function validateBaseline(value){
    const b={...baseline(),...value};
    for(const [k,v] of Object.entries(baseline()))if(typeof v==='number'&&!Number.isFinite(b[k]))throw new Error('Invalid baseline: '+k);
    if(b.neutralEARLeft<=0||b.neutralEARRight<=0||b.blinkClosedRatio<=0||b.blinkClosedRatio>=b.blinkOpenRatio||b.blinkOpenRatio>1||b.maxSmileLeft<=b.neutralSmileLeft||b.maxSmileRight<=b.neutralSmileRight||b.puckerRange<=0||b.nodRange<=0||b.centerPitchTolerance<=0||b.centerPitchTolerance>=b.nodRange||![1,-1].includes(b.nodDirection))throw new Error('Invalid baseline ranges or hysteresis');
    if(b.centerYawTolerance<=0||b.centerYawTolerance>=Math.min(b.leftTurnExitThreshold,b.rightTurnExitThreshold)||b.leftTurnExitThreshold>=b.leftTurnEnterThreshold||b.rightTurnExitThreshold>=b.rightTurnEnterThreshold)throw new Error('Invalid head thresholds: center < exit < enter required');
    return b;
  }
  function stats(values) {
    const s = values.filter(Number.isFinite).sort((a,b)=>a-b);
    if (!s.length) return null;
    const q = p => { const i = (s.length-1)*p, l = Math.floor(i); return s[l]+(s[Math.ceil(i)]-s[l])*(i-l); };
    const mean = s.reduce((a,b)=>a+b,0)/s.length, median = q(.5);
    const deviations = s.map(x=>Math.abs(x-median)).sort((a,b)=>a-b);
    return { n:s.length, mean, median, std:Math.sqrt(s.reduce((a,b)=>a+(b-mean)**2,0)/s.length),
      mad:deviations[Math.floor(deviations.length/2)], min:s[0], max:s[s.length-1], p5:q(.05), p25:q(.25), p75:q(.75), p95:q(.95) };
  }
  class SignalFilter {
    constructor(c) { this.c=c; this.last=null; }
    reset() { this.last=null; }
    update(f) {
      if (!this.last) { this.last={...f}; return {...f,earMean:(f.earLeft+f.earRight)/2,outliers:[]}; }
      const dt=f.timestamp-this.last.timestamp, out={...f}, rejected=[];
      for (const k of ['earLeft','earRight','eyeBlinkLeft','eyeBlinkRight','mouthSmileLeft','mouthSmileRight','cheekSquintLeft','cheekSquintRight','mouthClose','jawOpen','mouthPucker','mouthCornerLeftX','mouthCornerLeftY','mouthCornerRightX','mouthCornerRightY','yaw','pitch','roll']) {
        const a=this.last[k], b=f[k];
        if (!Number.isFinite(a)||!Number.isFinite(b)) continue;
        const pose=/^(yaw|pitch|roll)$/.test(k), eye=/ear|eyeBlink/.test(k), corner=/Corner/.test(k);
        const speed=pose?750:corner?7:/^ear/.test(k)?20:80;
        if (Math.abs(b-a)>speed*dt/1000+(pose?6:corner?.025:.04)) { rejected.push(k); continue; }
        const tau=pose?this.c.pose:eye?this.c.blink:corner?this.c.geometry:this.c.smile;
        const adaptive=1+Math.min(3,Math.abs(b-a)/(pose?10:.2));
        const alpha=1-Math.exp(-dt/Math.max(1,tau/adaptive));
        out[k]=a+(b-a)*alpha;
      }
      out.earMean=(out.earLeft+out.earRight)/2;
      out.outliers=rejected;
      if (!rejected.length) this.last={...out};
      return out;
    }
  }
  class FSM {
    constructor(name, initial, log) { this.name=name; this.state=initial; this.log=log; this.since=0; }
    move(state,t,reason='') {
      if (state!==this.state) this.log({ timestamp:t, detector:this.name, from:this.state, to:state, reason });
      this.state=state; this.since=t;
    }
  }
  class BlinkFSM extends FSM {
    constructor(c,b,log) { super('BLINK','UNARMED',log); this.c=c;this.b=b;this.cooldown=-Infinity;this.previous=null;this.refLeft=b.neutralEARLeft;this.refRight=b.neutralEARRight; }
    reset(t,reason) { this.previous=null;this.shallow=false;this.move('UNARMED',t,reason); }
    update(f) {
      const t=f.timestamp, b=this.b, c=this.c;
      // The uncalibrated population default must not override a visibly
      // higher personal open-eye EAR (e.g. .45 versus .27).
      if(!b.calibrated&&['UNARMED','OPEN'].includes(this.state)&&f.eyeBlinkLeft<.2&&f.eyeBlinkRight<.2){
        this.refLeft=Math.max(this.refLeft,f.earLeft);this.refRight=Math.max(this.refRight,f.earRight);
      }
      const leftRatio=f.earLeft/this.refLeft,rightRatio=f.earRight/this.refRight;
      const ratio=(leftRatio+rightRatio)/2;
      const closure=clamp((1-ratio)/Math.max(.15,1-b.blinkClosedRatio));
      const blend=(f.eyeBlinkLeft+f.eyeBlinkRight)/2;
      const velocity=this.previous?Math.abs(ratio-this.previous.ratio)/Math.max(.001,(t-this.previous.t)/1000):0;
      const evidence=clamp(velocity/4);
      const conf=(.4*closure+.4*blend+.2*evidence)*f.faceQuality;
      this.previous={ratio,t}; this.confidence=conf;
      const shallow=ratio<.93&&ratio>.72&&leftRatio<.95&&rightRatio<.95;
      const closed=(ratio<b.blinkClosedRatio&&blend>.30)||shallow;
      const open=ratio>(this.shallow?.97:b.blinkOpenRatio)&&blend<.48;
      if (this.state==='UNARMED') { if(open){this.move('OPEN',t);this.openAt=t;} return []; }
      if(this.state==='OPEN') {
        if(closed && t>=this.cooldown && t-this.openAt>=c.reopenMs) {
          this.start=t;this.shallow=shallow;this.peak=shallow?Math.max(conf,.72*f.faceQuality):conf;this.amplitude=clamp(1-ratio);this.minQuality=f.faceQuality;this.facing=f.facing;
          this.move('CLOSING',t);
        }
        return [];
      }
      this.peak=Math.max(this.peak,conf);this.amplitude=Math.max(this.amplitude,clamp(1-ratio));
      this.minQuality=Math.min(this.minQuality,f.faceQuality);
      this.facing=this.facing && f.facing;
      if(t-this.start>c.maxMs) { this.reset(t,'closure too long');return []; }
      if(this.state==='CLOSING') {
        if(open){this.move('OPEN',t,'single/short closure rejected');this.openAt=t;}
        else if(closed && t-this.start>=c.confirmMs) this.move('CLOSED',t);
      } else if(this.state==='CLOSED' && open) { this.opening=t;this.move('OPENING',t); }
      else if(this.state==='OPENING') {
        if(closed) this.move('CLOSED',t,'reopening interrupted');
        else if(open && t-this.opening>=c.reopenMs) {
          const duration=this.opening-this.start;
          this.move('OPEN',t);this.openAt=t;this.cooldown=t+c.refractoryMs;
          const confidence=clamp(.8*this.peak+.2*this.minQuality);
          if(duration<c.minMs || confidence<c.confidence) {this.log({timestamp:t,detector:'BLINK',reason:'duration/confidence rejected',duration,confidence});return [];}
          const spread=Math.max(100,3*b.intentionalBlinkDurationMAD);
          const deliberate=duration>=(b.deliberateCalibrated?Math.max(c.minMs,b.intentionalBlinkDurationMedian-spread):c.deliberateMinMs)
            && duration<=(b.deliberateCalibrated?Math.min(c.maxMs,b.intentionalBlinkDurationMedian+spread):c.maxMs)
            && this.amplitude>=Math.min(.85,b.intentionalBlinkAmplitude*.7);
          this.shallow=false;
          return [{type:'BLINK_COMPLETED',timestamp:t,duration,confidence,deliberate,facing:this.facing,amplitude:this.amplitude,
            symmetry:clamp(1-Math.abs(f.earLeft/b.neutralEARLeft-f.earRight/b.neutralEARRight))}];
        }
      }
      return [];
    }
  }
  class ExcursionFSM extends FSM {
    constructor(name,c,thresholds,log) {super(name,'UNARMED',log);this.c=c;this.thresholds=thresholds;this.cooldown=-Infinity;}
    reset(t,reason){this.move('UNARMED',t,reason);this.centerAt=null;}
    update(value,t,quality) {
      const {negative,positive,exitNegative,exitPositive,center,direction}=this.thresholds, c=this.c;
      const centered=Math.abs(value)<=center;
      if(this.state==='UNARMED') {
        if(centered){if(this.centerAt===null||this.centerAt===undefined)this.centerAt=t;if(t-this.centerAt>=c.centerMs)this.move('CENTER',t);}
        else this.centerAt=null;
        return [];
      }
      const side=value<=-negative?'LEFT':value>=positive?'RIGHT':null;
      if(this.state==='CENTER') {
        if(side && t>=this.cooldown && (!direction || (direction<0?side==='LEFT':side==='RIGHT'))) {
          this.side=side;this.start=t;this.peak=Math.abs(value);this.confidence=quality;this.move('MOVING_'+side,t);
        }
        return [];
      }
      this.peak=Math.max(this.peak,Math.abs(value));this.confidence=Math.min(this.confidence,quality);
      if(t-this.start>c.maxMs){this.reset(t,'excursion timed out');return [];}
      const beyond=this.side==='LEFT'?value<=-negative:value>=positive;
      const exited=this.side==='LEFT'?value>-exitNegative:value<exitPositive;
      if(this.state.startsWith('MOVING_')) {
        if(!beyond)this.reset(t,'excursion too short');
        else if(t-this.since>=c.holdMs)this.move(this.side+'_CONFIRMED',t);
      } else if(this.state.endsWith('_CONFIRMED')) {
        if(exited){this.centerAt=centered?t:null;this.move('RETURNING_CENTER',t);}
      } else if(this.state==='RETURNING_CENTER') {
        if((this.side==='LEFT' && value>=positive)||(this.side==='RIGHT' && value<=-negative)) {this.reset(t,'crossed to opposite side without stable center');return [];}
        if(!centered){this.centerAt=null;return [];}
        if(this.centerAt===null)this.centerAt=t;
        if(t-this.centerAt>=c.centerMs) {
          const e={type:this.name==='NOD'?'NOD_COMPLETED':this.side+'_TURN_COMPLETED',timestamp:t,duration:t-this.start,confidence:this.confidence,amplitude:this.peak};
          this.move('CENTER',t,'completed excursion and stable return');this.cooldown=t+c.refractoryMs;return [e];
        }
      }
      return [];
    }
  }
  function smileFeatures(f,b) {
    function side(s) {
      const suffix=s==='Left'?'L':'R';
      const neutral=b['neutralSmile'+s], max=b['maxSmile'+s];
      const raw=f['mouthSmile'+s], cheek=f['cheekSquint'+s];
      const normalized=clamp((raw-neutral)/Math.max(.035,max-neutral));
      const outward=Math.max(0,(Math.abs(f['mouthCorner'+s+'X'])-Math.abs(b['corner'+s+'X']))*5);
      const up=Math.max(0,(b['corner'+s+'Y']-f['mouthCorner'+s+'Y'])*6);
      const geo=clamp(outward+up);
      const active=raw>=b['closedSmileThreshold'+s];
      return {intensity:clamp(.72*normalized+.18*cheek+.10*geo),active,suffix};
    }
    const l=side('Left'),r=side('Right');
    const intensity=Math.max(l.intensity,r.intensity)*.7+Math.min(l.intensity,r.intensity)*.3;
    return {leftIntensity:l.intensity,rightIntensity:r.intensity,smileIntensity:intensity,
      evidence:l.active||r.active,symmetryScore:100*clamp(1-Math.max(0,Math.abs(l.intensity-r.intensity)-.10)/Math.max(.28,l.intensity+r.intensity)),
      confidence:f.faceQuality*clamp(.5+intensity*.5),closedMouthSmile:f.jawOpen<.18,openMouthSmile:f.jawOpen>=.18};
  }
  class SmileFSM extends FSM {
    constructor(c,log){super('SMILE','NEUTRAL',log);this.c=c;}
    reset(t,reason){this.move('NEUTRAL',t,reason);}
    update(s,t){
      const c=this.c,active=s.evidence&&s.smileIntensity>=c.enter, low=s.smileIntensity<c.exit;
      const event=type=>({type,timestamp:t,duration:t-this.start,confidence:s.confidence,closedMouthSmile:s.closedMouthSmile,leftIntensity:s.leftIntensity,rightIntensity:s.rightIntensity});
      if(this.state==='NEUTRAL'&&active){this.start=t;this.hasHeld=false;this.move('SMILE_STARTING',t);}
      else if(this.state==='SMILE_STARTING'){
        if(!active)this.reset(t,'smile too short');
        else if(t-this.start>=c.startMs){this.move('SMILING',t);return[event('SMILE_STARTED')];}
      }else if(this.state==='SMILING'||this.state==='SMILE_HELD'){
        if(low)this.move('RETURNING',t);
        else if(this.state==='SMILING'&&t-this.start>=c.heldMs){this.hasHeld=true;this.move('SMILE_HELD',t);return[event('SMILE_HELD')];}
      }else if(this.state==='RETURNING'){
        if(!low)this.move(this.hasHeld?'SMILE_HELD':'SMILING',t);
        else if(t-this.since>=c.returnMs){this.move('NEUTRAL',t);return[event('SMILE_COMPLETED')];}
      }
      return [];
    }
  }
  class CommandEngine {
    constructor(c){this.c=c;this.enabled=true;this.reset();}
    reset(){this.buffers={water:[],food:[],toilet:[]};this.cooldowns={};this.held=null;this.nod=null;this.lastCommand=null;}
    tick(t){for(const k of Object.keys(this.buffers)){const win=k==='water'?this.c.blinkWindowMs:this.c.turnWindowMs;this.buffers[k]=this.buffers[k].filter(e=>t-e.timestamp<=win);}}
    update(events,t){
      this.tick(t);const out=[];
      if(!this.enabled){this.reset();return out;}
      const fire=(command,ev)=>{
        if(t<(this.cooldowns[command]||0))return;
        const e={type:command==='okay'?'NOD_SMILE_COMBINATION':'COMMAND_COMPLETED',command,timestamp:t,confidence:Math.min(...ev.map(x=>x.confidence)),triggeringEvents:ev.map(x=>({...x}))};
        this.cooldowns[command]=t+this.c.cooldownMs;this.lastCommand=e;out.push(e);
        if(this.buffers[command])this.buffers[command]=[];
      };
      for(const e of events){
        if(e.confidence<this.c.minConfidence)continue;
        if(e.type==='SMILE_HELD')this.held={...e,active:true};
        if(e.type==='SMILE_COMPLETED'&&this.held)this.held={...this.held,active:false,end:e.timestamp};
        if(e.type==='NOD_COMPLETED')this.nod=e;
        let key=e.type==='BLINK_COMPLETED'&&e.deliberate&&e.facing?'water':e.type==='LEFT_TURN_COMPLETED'?'food':e.type==='RIGHT_TURN_COMPLETED'?'toilet':null;
        if(key&&t>=(this.cooldowns[key]||0)){
          this.buffers[key].push(e);
          if(this.buffers[key].length>=3)fire(key,this.buffers[key].slice(-3));
        }
        if(this.nod&&this.held){
          const gap=this.held.active?(this.nod.timestamp>=this.held.timestamp?0:this.held.timestamp-this.nod.timestamp):Math.abs(this.nod.timestamp-this.held.end);
          if(gap<=this.c.fusionMs && t-this.nod.timestamp<=this.c.fusionMs){fire('okay',[this.nod,this.held]);this.nod=null;}
        }
      }
      return out;
    }
    progress(t){this.tick(t);const o={};for(const k of Object.keys(this.buffers)){const a=this.buffers[k],win=k==='water'?this.c.blinkWindowMs:this.c.turnWindowMs;
      o[k]={count:a.length,remainingMs:a.length?Math.max(0,win-(t-a[0].timestamp)):0,cooldownMs:Math.max(0,(this.cooldowns[k]||0)-t),completed:!!(this.lastCommand&&this.lastCommand.command===k&&t-this.lastCommand.timestamp<1000)};}return o;}
  }
  class Engine {
    constructor(options={}) {
      this.config=config(options.config);this.original=validateBaseline(options.baseline);this.baseline=copy(this.original);
      this.trace=[];this.events=[];this.lastTimestamp=null;this.lastGood=null;this.lostAt=null;this.neutralSince=null;this.adapt=options.adapt!==false;
      this.filter=new SignalFilter(this.config.smoothing);this.commands=new CommandEngine(this.config.commands);
      const log=e=>{this.trace.push(e);if(this.trace.length>400)this.trace.shift();if(this.config.developer)console.debug('['+e.detector+']',e);};
      this.blink=new BlinkFSM(this.config.blink,this.baseline,log);
      const b=this.baseline;
      this.head=new ExcursionFSM('HEAD',this.config.head,{negative:b.leftTurnEnterThreshold,positive:b.rightTurnEnterThreshold,exitNegative:b.leftTurnExitThreshold,exitPositive:b.rightTurnExitThreshold,center:b.centerYawTolerance},log);
      this.nod=new ExcursionFSM('NOD',this.config.nod,{negative:b.nodRange,positive:b.nodRange,exitNegative:b.centerPitchTolerance*1.5,exitPositive:b.centerPitchTolerance*1.5,center:b.centerPitchTolerance,direction:b.nodDirection},log);
      this.smile=new SmileFSM(this.config.smile,log);this.pucker=null;this.scoreState={eye:100,lip:100,smile:100,head:100,motor:100};
    }
    resetIncomplete(t,reason){this.blink.reset(t,reason);this.head.reset(t,reason);this.nod.reset(t,reason);this.smile.reset(t,reason);this.pucker=null;this.commands.held=null;this.commands.nod=null;this.filter.reset();this.neutralSince=null;}
    resetAdaptation(){Object.assign(this.baseline,copy(this.original));}
    restoreAdaptation(saved){if(!saved)return;for(const [k,bound] of [['neutralEARLeft',.015],['neutralEARRight',.015],['neutralYaw',2],['neutralPitch',2],['neutralRoll',2]])if(Number.isFinite(saved[k]))this.baseline[k]=clamp(saved[k],this.original[k]-bound,this.original[k]+bound);}
    process(raw){
      const t=raw.timestamp;
      if(typeof raw.commandsEnabled==='boolean')this.commands.enabled=raw.commandsEnabled;
      if(!this.commands.enabled)this.commands.reset();
      if(!Number.isFinite(t)||this.lastTimestamp!==null&&t<=this.lastTimestamp)return {accepted:false,reason:'non-monotonic timestamp',events:[],commands:[]};
      const dt=this.lastTimestamp===null?0:t-this.lastTimestamp;this.lastTimestamp=t;this.commands.tick(t);
      if(dt>this.config.tracking.maxGapMs)this.resetIncomplete(t,'frame gap');
      const required=['earLeft','earRight','eyeBlinkLeft','eyeBlinkRight','mouthSmileLeft','mouthSmileRight','cheekSquintLeft','cheekSquintRight','jawOpen','mouthClose','mouthPucker','mouthCornerLeftX','mouthCornerLeftY','mouthCornerRightX','mouthCornerRightY','yaw','pitch','roll'];
      let reason=!raw.facePresent?'face absent':required.some(k=>!Number.isFinite(raw[k]))||!Number.isFinite(raw.faceQuality)?'invalid features':!raw.poseValid?'pose unavailable':Math.abs(raw.yaw)>80||Math.abs(raw.pitch)>70||Math.abs(raw.roll)>75?'pose outside reliable range':raw.faceQuality<this.config.tracking.minQuality?'poor tracking/quality':null;
      const f=reason?null:this.filter.update(raw);
      if(f&&f.outliers.length)reason='outlier: '+f.outliers.join(', ');
      if(reason){
        if(this.lostAt===null)this.lostAt=t;
        // Invalidate incomplete cycles immediately: reopening after an unseen closure cannot be a blink.
        this.resetIncomplete(t,reason);
        return {accepted:false,reason,raw,events:[],commands:[],progress:this.commands.progress(t),states:this.states()};
      }
      this.lostAt=null;this.lastGood=t;
      const b=this.baseline;f.relativeYaw=f.yaw-b.neutralYaw;f.relativePitch=f.pitch-b.neutralPitch;f.relativeRoll=f.roll-b.neutralRoll;
      f.facing=Math.abs(f.relativeYaw)<this.config.commands.facingYaw&&Math.abs(f.relativePitch)<this.config.commands.facingPitch;
      const smile=smileFeatures(f,b);
      const ev=[...this.blink.update(f),...this.head.update(f.relativeYaw,t,f.faceQuality),...this.nod.update(f.relativePitch,t,f.faceQuality),...this.smile.update(smile,t)];
      smile.smileDetected=['SMILING','SMILE_HELD','RETURNING'].includes(this.smile.state);
      const pucker=clamp((f.mouthPucker-b.puckerBaseline)/Math.max(.05,b.puckerRange));
      if(pucker>this.config.pucker.enter&&!this.pucker)this.pucker={start:t,confirmed:false};
      if(this.pucker){if(pucker>this.config.pucker.enter&&t-this.pucker.start>=this.config.pucker.holdMs)this.pucker.confirmed=true;
        if(pucker<this.config.pucker.exit){if(this.pucker.confirmed)ev.push({type:'PUCKER_COMPLETED',timestamp:t,duration:t-this.pucker.start,confidence:f.faceQuality});this.pucker=null;}}
      const commands=this.commands.update(ev,t);this.events.push(...ev);if(this.events.length>500)this.events.splice(0,this.events.length-500);
      // Slow bounded neutral-only adaptation; preserve original calibration unchanged.
      const neutral=f.faceQuality>.85&&this.blink.state==='OPEN'&&this.head.state==='CENTER'&&this.nod.state==='CENTER'&&this.smile.state==='NEUTRAL'&&pucker<.1&&Math.abs(f.relativeYaw)<2&&Math.abs(f.relativePitch)<2&&f.eyeBlinkLeft<.15&&f.eyeBlinkRight<.15&&f.mouthSmileLeft<b.closedSmileThresholdLeft*.5&&f.mouthSmileRight<b.closedSmileThresholdRight*.5;
      if(!neutral)this.neutralSince=null;else if(this.neutralSince===null)this.neutralSince=t;
      if(this.adapt&&b.calibrated&&neutral&&t-this.neutralSince>2000){const a=1-Math.exp(-dt/120000);
        for(const [key,value,bound] of [['neutralEARLeft',f.earLeft,.015],['neutralEARRight',f.earRight,.015],['neutralYaw',f.yaw,2],['neutralPitch',f.pitch,2],['neutralRoll',f.roll,2]])b[key]=clamp(b[key]+a*(value-b[key]),this.original[key]-bound,this.original[key]+bound);}
      // Consistency of observed signals, not a clinical motor-ability score.
      // A neutral face is not a failed smile, pucker or head-turn exercise.
      const targets={eye:100*clamp(1-Math.max(0,Math.abs(f.earLeft-f.earRight)-.025)*4),
        lip:100,smile:smile.smileDetected?smile.symmetryScore:100,head:100};
      const a=1-Math.exp(-Math.min(dt,220)/1500);for(const k of Object.keys(targets))this.scoreState[k]+=a*(targets[k]-this.scoreState[k]);
      this.scoreState.motor=(this.scoreState.eye+this.scoreState.lip+this.scoreState.smile+this.scoreState.head)/4;
      return {accepted:true,raw,features:f,smile,pucker,events:ev,commands,states:this.states(),progress:this.commands.progress(t),scores:{...this.scoreState},scoreConfidence:f.faceQuality*(b.calibrated?1:.5)};
    }
    states(){return {blink:this.blink.state,head:this.head.state,nod:this.nod.state,smile:this.smile.state};}
  }
  const FEATURE_VECTOR=['earLeft','earRight','eyeBlinkLeft','eyeBlinkRight','mouthSmileLeft','mouthSmileRight','cheekSquintLeft','cheekSquintRight','jawOpen','mouthClose','mouthPucker','relativeYaw','relativePitch','relativeRoll','mouthCornerLeftX','mouthCornerLeftY','mouthCornerRightX','mouthCornerRightY'];
  function featureVector(frame){return FEATURE_VECTOR.map(k=>{if(!Number.isFinite(frame[k]))throw new Error('Missing classifier feature: '+k);return frame[k];});}
  function replay(frames,options={}){const engine=new Engine({...options,adapt:false}),events=[],commands=[],timeline=[];
    for(const f of frames){const r=engine.process(f);events.push(...r.events);commands.push(...r.commands);timeline.push({timestamp:f.timestamp,accepted:r.accepted,reason:r.reason,states:r.states});}return {events,commands,timeline,transitions:engine.trace};}
  return {DEFAULTS,config,baseline,validateBaseline,stats,clamp,SignalFilter,BlinkFSM,ExcursionFSM,SmileFSM,CommandEngine,Engine,smileFeatures,replay,FEATURE_VECTOR,featureVector};
});
