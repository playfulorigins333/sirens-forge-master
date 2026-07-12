const rfc3339=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/
const local=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
export type WallTimeResult={ok:true;rfc3339:string;offset:string;ambiguous:false}|{ok:false;code:"AMBIGUOUS_LOCAL_TIME";offsets:string[]}|{ok:false;code:"NONEXISTENT_LOCAL_TIME"|"INVALID_LOCAL_TIME"|"INVALID_IANA_TIMEZONE"|"INVALID_OFFSET"}
export function isValidIanaTimeZone(tz:unknown):tz is string{ if(typeof tz!=="string"||tz.trim()!==tz||tz.length<3||tz.length>128||/^UTC[+-]|^[+-]\d{2}:?\d{2}$|^Etc\/GMT[+-]/.test(tz)) return false; if(tz==="UTC") return true; try{ const zones=(Intl as any).supportedValuesOf?.("timeZone") as string[]|undefined; if(zones?.includes(tz)) return true; return Boolean(new Intl.DateTimeFormat("en-US",{timeZone:tz}).resolvedOptions().timeZone) }catch{return false}}
function offsetText(minutes:number){const sign=minutes<0?"-":"+"; const abs=Math.abs(minutes); return `${sign}${String(Math.floor(abs/60)).padStart(2,"0")}:${String(abs%60).padStart(2,"0")}`}
function partsInZone(d:Date,tz:string){return new Intl.DateTimeFormat("en-CA",{timeZone:tz,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}).formatToParts(d).reduce((a,p)=>({...a,[p.type]:p.value}),{} as Record<string,string>)}
function parseExplicitOffset(value:string){ if(!/^(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null; if(value==="Z") return 0; const hours=Number(value.slice(1,3)); const minutes=Number(value.slice(4,6)); if(!Number.isInteger(hours)||!Number.isInteger(minutes)||minutes>59||hours>14||(hours===14&&minutes!==0)) return null; return (hours*60+minutes)*(value[0]==="-"?-1:1) }
function compatibleOffsets(y:string,mo:string,da:string,h:string,mi:string,s:string,tz:string){const want={year:y,month:mo,day:da,hour:h,minute:mi,second:s}; const out:number[]=[]; for(let off=-14*60; off<=14*60; off+=15){const d=new Date(Date.UTC(+y,+mo-1,+da,+h,+mi,+s)-off*60000); const p=partsInZone(d,tz); if(p.year===want.year&&p.month===want.month&&p.day===want.day&&p.hour===want.hour&&p.minute===want.minute&&p.second===want.second) out.push(off)} return out}
function validCalendar(y:string,mo:string,da:string,h:string,mi:string,s:string){const d=new Date(Date.UTC(+y,+mo-1,+da,+h,+mi,+s)); return d.getUTCFullYear()===+y&&d.getUTCMonth()===+mo-1&&d.getUTCDate()===+da&&d.getUTCHours()===+h&&d.getUTCMinutes()===+mi&&d.getUTCSeconds()===+s}
export function localWallTimeToZonedRfc3339(value:string,timeZone:string,explicitOffset?:string):WallTimeResult{const m=local.exec(value); if(!m) return {ok:false,code:"INVALID_LOCAL_TIME"}; const [,y,mo,da,h,mi,ss]=m; const s=ss??"00"; if(+h>23||!validCalendar(y,mo,da,h,mi,s)) return {ok:false,code:"INVALID_LOCAL_TIME"}; if(!isValidIanaTimeZone(timeZone)) return {ok:false,code:"INVALID_IANA_TIMEZONE"}; const offsets=compatibleOffsets(y,mo,da,h,mi,s,timeZone); if(offsets.length===0) return {ok:false,code:"NONEXISTENT_LOCAL_TIME"}; const offsetTexts=offsets.map(offsetText); let chosen:string; if(explicitOffset){ const parsed=parseExplicitOffset(explicitOffset); if(parsed===null) return {ok:false,code:"INVALID_OFFSET"}; chosen=explicitOffset==="Z"?"+00:00":explicitOffset; if(!offsetTexts.includes(chosen)) return {ok:false,code:"INVALID_OFFSET"} } else { if(offsetTexts.length>1) return {ok:false,code:"AMBIGUOUS_LOCAL_TIME",offsets:offsetTexts}; chosen=offsetTexts[0] } return {ok:true,rfc3339:`${y}-${mo}-${da}T${h}:${mi}:${s}${chosen==="+00:00"&&timeZone==="UTC"?"Z":chosen}`,offset:chosen,ambiguous:false}}
export function validateScheduleInstant(instant:unknown, timeZone:unknown){
  if(typeof instant!=="string") throw Object.assign(new Error("INVALID_RFC3339_INSTANT"),{code:"INVALID_RFC3339_INSTANT"})
  const m=rfc3339.exec(instant)
  if(!m) throw Object.assign(new Error("INVALID_RFC3339_INSTANT"),{code:"INVALID_RFC3339_INSTANT"})
  const [,y,mo,da,h,mi,s,,off]=m
  if(!isValidIanaTimeZone(timeZone)) throw Object.assign(new Error("INVALID_IANA_TIMEZONE"),{code:"INVALID_IANA_TIMEZONE"})
  if(+h>23||!validCalendar(y,mo,da,h,mi,s)) throw Object.assign(new Error("INVALID_RFC3339_INSTANT"),{code:"INVALID_RFC3339_INSTANT"})
  if(off!=="Z"){
    const mins=parseExplicitOffset(off)
    if(mins===null) throw Object.assign(new Error("INVALID_RFC3339_OFFSET"),{code:"INVALID_RFC3339_OFFSET"})
  }
  const date=new Date(instant)
  if(!Number.isFinite(date.getTime())) throw Object.assign(new Error("INVALID_RFC3339_INSTANT"),{code:"INVALID_RFC3339_INSTANT"})
  const p=partsInZone(date,timeZone)
  if(p.year!==y||p.month!==mo||p.day!==da||p.hour!==h||p.minute!==mi||p.second!==s) throw Object.assign(new Error("OFFSET_TIMEZONE_INCOMPATIBLE"),{code:"OFFSET_TIMEZONE_INCOMPATIBLE"})
  return {iso:date.toISOString(),timeZone}
}
