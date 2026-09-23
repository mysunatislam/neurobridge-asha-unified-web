/* Native IndexedDB: no CDN dependency for patient data. */
(function(){
  'use strict';
  const TABLES=['patients','calibrations','calibrationGestures','sessions','frameFeatures','gestureEvents','commandEvents','modelSettings'];
  let opening;
  function open(){
    if(opening)return opening;
    opening=new Promise((resolve,reject)=>{
      const r=indexedDB.open('neuroface-sense',2);
      r.onupgradeneeded=()=>{const db=r.result;for(const name of TABLES){if(db.objectStoreNames.contains(name))continue;
        const s=db.createObjectStore(name,{keyPath:'id',autoIncrement:true});
        if(['frameFeatures','gestureEvents','commandEvents'].includes(name))s.createIndex('sessionId','sessionId');
        if(['calibrations','calibrationGestures','sessions'].includes(name))s.createIndex('patientId','patientId');
      }};
      r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(r.result);};
      r.onerror=()=>{opening=null;reject(r.error);};r.onblocked=()=>reject(new Error('Close another NeuroFace tab to upgrade storage'));
    });return opening;
  }
  async function transaction(tables,fn){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(tables,'readwrite');let value;
    try{value=fn(tx);}catch(e){tx.abort();reject(e);return;}tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Storage transaction aborted'));});}
  async function put(table,value){return transaction([table],tx=>tx.objectStore(table).put(value));}
  async function all(table,index,key){const db=await open();return new Promise((resolve,reject)=>{const s=db.transaction(table).objectStore(table),r=index?s.index(index).getAll(key):s.getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  async function get(table,id){const db=await open();return new Promise((resolve,reject)=>{const r=db.transaction(table).objectStore(table).get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  async function patient(){let p=await get('patients','default');if(!p){p={id:'default',patientId:'default',alias:'Local patient',createdAt:Date.now(),activeCalibrationId:null};await put('patients',p);}return p;}
  async function saveCalibration(twin){const p=await patient(),id='cal-'+Date.now();
    await transaction(['patients','calibrations','calibrationGestures'],tx=>{
      tx.objectStore('calibrations').put({id,calibrationId:id,patientId:p.id,version:2,createdAt:Date.now(),...twin});
      tx.objectStore('patients').put({...p,activeCalibrationId:id});
      for(const [gesture,data] of Object.entries(twin.stages||{}))tx.objectStore('calibrationGestures').put({id:id+'-'+gesture,calibrationId:id,patientId:p.id,gesture,...data});
    });return id;
  }
  async function loadCalibration(){const p=await patient();if(p.activeCalibrationId)return get('calibrations',p.activeCalibrationId);
    // Preserve legacy data, but never treat an instantaneous legacy twin as validated.
    let legacy;try{legacy=JSON.parse(localStorage.getItem('neuroface_twin_v1')||'null');}catch(e){}
    if(legacy){const id='legacy-import';if(!await get('calibrations',id))await put('calibrations',{id,patientId:p.id,version:1,requiresValidation:true,legacy,createdAt:Date.now()});}
    return null;
  }
  async function deactivateCalibration(){const p=await patient();await put('patients',{...p,activeCalibrationId:null});}
  class Recorder {
    constructor(onError){this.onError=onError;this.session=null;this.pending=[];this.chain=Promise.resolve();this.lastSample=-Infinity;this.count=0;this.full=false;this.timer=setInterval(()=>this.flush(),2000);}
    async start(engine,kind='live'){await this.stop();this.session={id:'session-'+Date.now(),patientId:'default',startedAt:Date.now(),kind,baseline:JSON.parse(JSON.stringify(engine.original)),config:JSON.parse(JSON.stringify(engine.config)),status:'recording'};
      this.lastSample=-Infinity;this.count=0;this.full=false;await put('sessions',this.session);}
    record(raw,result,engine){if(!this.session||this.full)return;
      // Default: retain the selected numeric signals at inference rate for deterministic replay.
      // A nonzero optional sampleMs trades temporal fidelity for smaller recordings.
      const meta={sessionId:this.session.id,patientId:this.session.patientId};
      if(raw.timestamp-this.lastSample>=engine.config.recording.sampleMs){this.lastSample=raw.timestamp;this.count++;
        this.pending.push(['frameFeatures',{...meta,timestamp:raw.timestamp,features:{...raw},states:result.states,accepted:result.accepted,reason:result.reason}]);}
      for(const e of result.events)this.pending.push(['gestureEvents',{...meta,...e}]);
      for(const e of result.commands)this.pending.push(['commandEvents',{...meta,...e}]);
      if(this.count>=engine.config.recording.maxFrames){this.full=true;this.onError(new Error('Recording limit reached; export or start a new session'));}
      if(this.pending.length>200)this.flush();
    }
    flush(){const batch=this.pending.splice(0);if(!batch.length)return this.chain;
      this.chain=this.chain.then(()=>transaction([...new Set(batch.map(x=>x[0]))],tx=>{for(const [table,value] of batch)tx.objectStore(table).add(value);})).catch(e=>{this.full=true;this.onError(e);});return this.chain;}
    async stop(){await this.flush();if(this.session){await put('sessions',{...this.session,status:this.full?'limited or storage interrupted':'complete',endedAt:Date.now(),sampledFrames:this.count});this.session=null;}}
  }
  async function exportSession(id){const session=await get('sessions',id);if(!session)throw new Error('Session not found');const data={schemaVersion:2,session};for(const table of ['frameFeatures','gestureEvents','commandEvents'])data[table]=await all(table,'sessionId',id);return data;}
  async function deleteSession(id){await transaction(['sessions','frameFeatures','gestureEvents','commandEvents'],tx=>{tx.objectStore('sessions').delete(id);for(const table of ['frameFeatures','gestureEvents','commandEvents']){const r=tx.objectStore(table).index('sessionId').openCursor(IDBKeyRange.only(id));r.onsuccess=()=>{const c=r.result;if(c){c.delete();c.continue();}};}});}
  function csv(data){const frames=data.frameFeatures||[];const keys=['timestamp',...window.NF_engine.FEATURE_VECTOR,'faceQuality','accepted','reason'];const cell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';return [keys.join(','),...frames.map(row=>keys.map(k=>cell(row[k]??row.features[k])).join(','))].join('\r\n');}
  window.NF_storage={open,put,get,all,patient,saveCalibration,loadCalibration,deactivateCalibration,Recorder,exportSession,deleteSession,csv};
})();
