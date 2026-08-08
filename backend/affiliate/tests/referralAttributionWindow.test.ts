import assert from "node:assert/strict";
import { captureReferral, readCurrentReferral, REFERRAL_WINDOW_MS } from "../../../lib/referralAttribution";
class MemoryStorage { data=new Map<string,string>(); getItem(k:string){return this.data.get(k)??null} setItem(k:string,v:string){this.data.set(k,v)} removeItem(k:string){this.data.delete(k)} }
let assertions=0; const equal=(a:unknown,b:unknown,m:string)=>{assert.equal(a,b,m);assertions++};
const storage=new MemoryStorage(); const day=24*60*60*1000;
equal(captureReferral(storage," code_1 ",0),"CODE_1","new referral normalized");
equal(readCurrentReferral(storage,0),"CODE_1","valid day zero");
equal(readCurrentReferral(storage,59*day),"CODE_1","valid day 59");
equal(readCurrentReferral(storage,REFERRAL_WINDOW_MS),null,"expired at day 60");
equal(storage.data.size,0,"expired referral removed");
equal(captureReferral(storage,"bad!",REFERRAL_WINDOW_MS),null,"malformed referral not persisted");
equal(storage.data.size,0,"malformed referral leaves storage empty");
equal(captureReferral(storage,"NEW_CODE",61*day),"NEW_CODE","replacement starts window");
equal(readCurrentReferral(storage,120*day),"NEW_CODE","replacement remains valid at its day 59");
console.log(`PFC-CORE-03D referral window passed (${assertions} assertions).`);
