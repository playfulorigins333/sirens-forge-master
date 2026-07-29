import { createHmac } from "node:crypto";

export const PAY_FIRST_HOLD_SECONDS = 60 * 60;
export const RATE_LIMIT_RETENTION_HOURS = 25;
export const TRUSTED_NETWORK_HEADER = "x-vercel-forwarded-for";
const MIN_RATE_LIMIT_SECRET_LENGTH = 32;

export function payFirstCheckoutEnabled(value: unknown): boolean {
  return typeof value === "string" && value.trim() === "true";
}

type CanonicalAddress={family:4|6;bytes:Buffer};
function parseIpv4(value:string):Buffer|null {
  if(!/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(value))return null;
  const parts=value.split(".").map(Number);return parts.every(part=>part<=255)?Buffer.from(parts):null;
}
function parseIpv6(value:string):Buffer|null {
  if(!value||value.includes("%")||value.includes("."))return null;
  const halves=value.split("::");if(halves.length>2)return null;
  const parse=(part:string)=>part?part.split(":").map(word=>/^[0-9a-f]{1,4}$/i.test(word)?Number.parseInt(word,16):-1):[];
  const left=parse(halves[0]),right=parse(halves[1]||"");if([...left,...right].some(word=>word<0))return null;
  const missing=8-left.length-right.length;if((halves.length===1&&missing!==0)||(halves.length===2&&missing<1))return null;
  const words=[...left,...Array(missing).fill(0),...right];if(words.length!==8)return null;
  const bytes=Buffer.alloc(16);words.forEach((word,index)=>bytes.writeUInt16BE(word,index*2));return bytes;
}
function canonicalAddress(value:string):CanonicalAddress|null {const v4=parseIpv4(value);if(v4)return{family:4,bytes:v4};const v6=parseIpv6(value);return v6?{family:6,bytes:v6}:null}
const prefix=(bytes:Buffer,network:number[],bits:number)=>{for(let i=0;i<bits;i++)if(((bytes[i>>3]>>(7-(i&7)))&1)!==((network[i>>3]>>(7-(i&7)))&1))return false;return true};
function eligible(address:CanonicalAddress):boolean {
  const b=address.bytes;
  if(address.family===4){
    const [a,c,d,e]=b;
    if(a===0||a===10||a===127||a>=224||(a===100&&c>=64&&c<=127)||(a===169&&c===254)||(a===172&&c>=16&&c<=31)||(a===192&&c===168)||(a===192&&c===0&&d===2)||(a===198&&(c===18||c===19))||(a===198&&c===51&&d===100)||(a===203&&c===0&&d===113))return false;
    if(a===192&&c===0&&d===0&&![9,10].includes(e))return false;
    return true;
  }
  if(b.every(byte=>byte===0)||b.subarray(0,15).every(byte=>byte===0)&&b[15]===1)return false;
  if(prefix(b,[0,0,0,0,0,0,0,0,0,0,255,255],96)||prefix(b,[255],8)||prefix(b,[252],7)||prefix(b,[254,128],10))return false;
  if(prefix(b,[32,1,13,184],32)||prefix(b,[1,0,0,0,0,0,0,0],64)||prefix(b,[32,1,0,2],48)||prefix(b,[32,1,0,32],28))return false;
  return true;
}
export function isPublicIp(value: string): boolean {
  const address=canonicalAddress(value);return Boolean(address&&eligible(address));
}

export function trustedSourceNetwork(request: Request): string | null {
  const raw=request.headers.get(TRUSTED_NETWORK_HEADER);
  if (!raw || raw.includes(",")) return null;
  const value=raw.trim();
  return value && isPublicIp(value) ? value : null;
}

export function networkRateLimitHash(source: string, secret: string): string {
  const address=canonicalAddress(source);
  if (!address||!eligible(address)||typeof secret!=="string"||secret.length<MIN_RATE_LIMIT_SECRET_LENGTH) throw new Error("rate_limit_configuration");
  return createHmac("sha256",secret).update(Buffer.concat([Buffer.from([address.family]),address.bytes])).digest("hex");
}

export type CheckoutCreationConfiguration = { priceId:string; baseUrl:string; networkHash:string };
export function checkoutCreationConfiguration(input:{request:Request;rateLimitSecret?:string;supabaseUrl?:string;serviceRoleKey?:string;stripeSecret?:string;priceId?:string;canonicalUrl?:string}):CheckoutCreationConfiguration|null {
  const source=trustedSourceNetwork(input.request);
  if(!source||!input.rateLimitSecret||!input.supabaseUrl||!input.serviceRoleKey||!input.stripeSecret||!input.priceId||!input.canonicalUrl)return null;
  try{
    const canonical=new URL(input.canonicalUrl);
    if(canonical.protocol!=="https:"||canonical.username||canonical.password||canonical.search||canonical.hash)return null;
    return{priceId:input.priceId,baseUrl:canonical.origin+canonical.pathname.replace(/\/$/,""),networkHash:networkRateLimitHash(source,input.rateLimitSecret)};
  }catch{return null}
}
