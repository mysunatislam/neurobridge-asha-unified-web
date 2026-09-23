(function () {
  'use strict';
  const VERSION='0.10.22-rc.20250304';
  const CDN='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@'+VERSION;
  const MODEL='https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  // MediaPipe Matrix.data is column-major. Normalize columns to remove scale.
  function headPose(matrix){
    if(!matrix||matrix.rows!==4||matrix.columns!==4||matrix.data.length!==16)return null;
    const m=matrix.data;
    if(!Array.from(m).every(Number.isFinite))return null;
    const sx=Math.hypot(m[0],m[1],m[2]),sy=Math.hypot(m[4],m[5],m[6]),sz=Math.hypot(m[8],m[9],m[10]);
    if(Math.min(sx,sy,sz)<1e-6)return null;
    const r00=m[0]/sx,r10=m[1]/sx,r20=m[2]/sx,r21=m[6]/sy,r22=m[10]/sz;
    const d=180/Math.PI;
    // Patient-relative yaw: patient's left is negative (the preview alone is mirrored).
    return {yaw:Math.atan2(r20,Math.hypot(r00,r10))*d,pitch:Math.atan2(r21,r22)*d,roll:Math.atan2(r10,r00)*d};
  }
  async function create(){
    let base=CDN, model=MODEL;
    // Local assets are preferred and allow a first launch with no network.
    try {const r=await fetch('vendor/vision_bundle.mjs',{method:'HEAD'});if(r.ok){base='vendor';model='models/face_landmarker.task';}}catch(e){}
    base=new URL(base+'/',document.baseURI).href.replace(/\/$/,'');
    const {FaceLandmarker,FilesetResolver}=await import(base+'/vision_bundle.mjs');
    const files=await FilesetResolver.forVisionTasks(base+'/wasm');
    const options={baseOptions:{modelAssetPath:model,delegate:'GPU'},runningMode:'VIDEO',numFaces:1,
      outputFaceBlendshapes:true,outputFacialTransformationMatrixes:true,minFaceDetectionConfidence:.6,minFacePresenceConfidence:.6,minTrackingConfidence:.6};
    try{return await FaceLandmarker.createFromOptions(files,options);}
    catch(e){options.baseOptions.delegate='CPU';return FaceLandmarker.createFromOptions(files,options);}
  }
  class Extractor {
    constructor(){this.previous=null;this.canvas=document.createElement('canvas');this.canvas.width=48;this.canvas.height=48;this.ctx=this.canvas.getContext('2d',{willReadFrequently:true});this.lastLight=-Infinity;this.light={brightness:null,sharpness:null};}
    extract(result,video,t){
      const lm=result.faceLandmarks&&result.faceLandmarks[0],pose=headPose(result.facialTransformationMatrixes&&result.facialTransformationMatrixes[0]);
      if(!lm||lm.length<468)return {timestamp:t,facePresent:false,faceQuality:0,trackingConfidence:null};
      const M=window.NF_metrics, W=video.videoWidth||640,H=video.videoHeight||480;
      const bs={};for(const c of result.faceBlendshapes?.[0]?.categories||[])bs[c.categoryName]=c.score;
      const names=['eyeBlinkLeft','eyeBlinkRight','mouthSmileLeft','mouthSmileRight','cheekSquintLeft','cheekSquintRight','mouthClose','jawOpen','mouthPucker'];
      const f={timestamp:t,facePresent:true,poseValid:!!pose,...(pose||{yaw:0,pitch:0,roll:0}),trackingConfidence:null,confidenceSource:'quality proxy; task API does not expose per-frame tracking probability',blendshapesValid:names.every(k=>Number.isFinite(bs[k]))};
      for(const k of names)f[k]=bs[k];
      // Explicit anatomical left/right mapping (33/61 are the subject's right).
      f.earLeft=M.earPx(lm,window.NF_LM.eyeR,W,H);f.earRight=M.earPx(lm,window.NF_LM.eyeL,W,H);f.earMean=(f.earLeft+f.earRight)/2;
      const pixel=p=>({x:p.x*W,y:p.y*H}),a=pixel(lm[234]),b=pixel(lm[454]);
      const width=Math.hypot(b.x-a.x,b.y-a.y),ux=(b.x-a.x)/Math.max(1,width),uy=(b.y-a.y)/Math.max(1,width);
      const mid={x:(lm[13].x+lm[14].x)*W/2,y:(lm[13].y+lm[14].y)*H/2};
      for(const [s,i] of [['Left',291],['Right',61]]){const p=pixel(lm[i]),dx=p.x-mid.x,dy=p.y-mid.y;f['mouthCorner'+s+'X']=(dx*ux+dy*uy)/Math.max(1,width);f['mouthCorner'+s+'Y']=(-dx*uy+dy*ux)/Math.max(1,width);}
      const xs=lm.map(p=>p.x),ys=lm.map(p=>p.y),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
      f.faceSize=x1-x0;f.centerX=(x0+x1)/2;f.centerY=(y0+y1)/2;f.inFrame=x0>.015&&x1<.985&&y0>.015&&y1<.985;
      if(t-this.lastLight>300&&video.readyState>=2){
        try{this.ctx.drawImage(video,Math.max(0,x0*W),Math.max(0,y0*H),Math.max(1,(x1-x0)*W),Math.max(1,(y1-y0)*H),0,0,48,48);
          const px=this.ctx.getImageData(0,0,48,48).data;let sum=0,gradient=0;
          for(let i=0;i<px.length;i+=4){sum+=(px[i]+px[i+1]+px[i+2])/3;if(i>=192)gradient+=Math.abs(px[i]-px[i-192]);}
          this.light={brightness:sum/2304,sharpness:gradient/2256};this.lastLight=t;
        }catch(e){this.light={brightness:null,sharpness:null};}
      }
      Object.assign(f,this.light);
      f.fps=this.previous?1000/Math.max(1,t-this.previous.timestamp):0;
      f.poseSpeed=this.previous&&pose?Math.hypot(f.yaw-this.previous.yaw,f.pitch-this.previous.pitch)/Math.max(.001,(t-this.previous.timestamp)/1000):0;
      f.mar=M.mar(lm);f.mouthWidth=M.mouthWidth(lm);f.browGap=((lm[133].y-lm[105].y)+(lm[362].y-lm[334].y))/2;
      f.lipDeviation=M.lipDeviation(lm,0);f.cornerDepression=M.cornerDepression(lm);f.gaze=M.gaze(lm);
      f.faceQuality=(!f.blendshapesValid||!pose||!lm.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z)))?0:
        Math.max(0,1-(f.inFrame?0:.4)-(f.faceSize<.13||f.faceSize>.85?.4:0)-(f.brightness!==null&&(f.brightness<28||f.brightness>245)?.4:0)-(f.fps&&f.fps<8?.3:0));
      this.previous=f;return f;
    }
  }
  window.NF_vision={create,Extractor,headPose,VERSION,CDN,MODEL};
})();
