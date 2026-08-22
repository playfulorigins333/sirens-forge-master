import { open, type FileHandle } from "node:fs/promises";
import type { TensorResult } from "./types";

// Floating-point formats are admitted only after reference-bit-pattern tests exist.
const DTYPE_BYTES: Record<string, number> = { BOOL:1,I8:1,U8:1,I16:2,U16:2,F16:2,I32:4,U32:4,F32:4,I64:8,U64:8 };
const MAX_HEADER_BYTES = 100 * 1024 * 1024;
type RecordValue = { dtype: string; shape: number[]; data_offsets: [number, number] };
export interface ParsedHeader { dataStart: number; tensors: Array<{ name: string } & RecordValue> }

async function readExact(handle: FileHandle, buffer: Buffer, position: number): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, position + offset);
    if (!bytesRead) throw new Error("MALFORMED_SAFETENSOR: unexpected end of file");
    offset += bytesRead;
  }
}

export async function parseHeader(handle: FileHandle, fileSize: number): Promise<ParsedHeader> {
  if (fileSize < 10) throw new Error("MALFORMED_SAFETENSOR: file is too short");
  const prefix = Buffer.alloc(8); await readExact(handle, prefix, 0);
  const lengthBig = prefix.readBigUInt64LE();
  if (lengthBig < 2n || lengthBig > BigInt(MAX_HEADER_BYTES) || lengthBig > BigInt(fileSize - 8)) throw new Error("MALFORMED_SAFETENSOR: invalid header length");
  const length = Number(lengthBig), bytes = Buffer.alloc(length); await readExact(handle, bytes, 8);
  let raw: unknown;
  try { raw = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("MALFORMED_SAFETENSOR: invalid JSON header"); }
  if (!raw || Array.isArray(raw) || typeof raw !== "object") throw new Error("MALFORMED_SAFETENSOR: header must be an object");
  const tensors: ParsedHeader["tensors"] = [];
  for (const [name, value] of Object.entries(raw)) {
    if (name === "__metadata__") continue;
    if (!value || typeof value !== "object") throw new Error(`MALFORMED_SAFETENSOR: invalid tensor ${name}`);
    const v = value as Partial<RecordValue>;
    if (typeof v.dtype === "string" && !DTYPE_BYTES[v.dtype]) throw new Error(`UNSUPPORTED_DTYPE: ${v.dtype} is not approved or reference-tested`);
    if (!v.dtype || !Array.isArray(v.shape) || !v.shape.every((n) => Number.isSafeInteger(n) && n >= 0) || !Array.isArray(v.data_offsets) || v.data_offsets.length !== 2 || !v.data_offsets.every((n) => Number.isSafeInteger(n) && n >= 0)) throw new Error(`MALFORMED_SAFETENSOR: invalid tensor record ${name}`);
    const [start,end] = v.data_offsets; const elements = v.shape.reduce((a,b) => a * b, 1);
    if (!Number.isSafeInteger(elements) || end < start || end - start !== elements * DTYPE_BYTES[v.dtype] || 8 + length + end > fileSize) throw new Error(`MALFORMED_SAFETENSOR: invalid tensor extent ${name}`);
    tensors.push({ name, dtype:v.dtype, shape:v.shape, data_offsets:[start,end] });
  }
  const byOffset=[...tensors].sort((a,b)=>a.data_offsets[0]-b.data_offsets[0]||a.data_offsets[1]-b.data_offsets[1]);
  let expectedOffset=0;
  for(const tensor of byOffset){if(tensor.data_offsets[0]!==expectedOffset)throw new Error(`MALFORMED_SAFETENSOR: non-contiguous tensor data at ${tensor.name}`);expectedOffset=tensor.data_offsets[1];}
  if(8+length+expectedOffset!==fileSize)throw new Error("MALFORMED_SAFETENSOR: trailing or missing tensor data");
  tensors.sort((a,b) => a.name.localeCompare(b.name));
  if (!tensors.length) throw new Error("MALFORMED_SAFETENSOR: no tensors");
  return { dataStart: 8 + length, tensors };
}

function half(bits: number): number { const s=(bits&0x8000)?-1:1,e=(bits>>10)&31,f=bits&1023; return e===31?(f?NaN:s*Infinity):e===0?s*2**-14*(f/1024):s*2**(e-15)*(1+f/1024); }
function valueAt(b:Buffer,o:number,d:string):number|null { switch(d){case"F32":return b.readFloatLE(o);case"F16":return half(b.readUInt16LE(o));default:return null;} }

export async function scanSafeTensor(filePath: string): Promise<TensorResult[]> {
  const handle = await open(filePath, "r");
  try {
    const stat = await handle.stat(); const parsed = await parseHeader(handle, stat.size); const results: TensorResult[]=[];
    for (const tensor of parsed.tensors) {
      const width=DTYPE_BYTES[tensor.dtype], chunkSize=Math.max(width, Math.floor((4*1024*1024)/width)*width);
      let nanCount=0,positiveInfinityCount=0,negativeInfinityCount=0;
      for(let relative=tensor.data_offsets[0];relative<tensor.data_offsets[1];relative+=chunkSize){const size=Math.min(chunkSize,tensor.data_offsets[1]-relative),buffer=Buffer.allocUnsafe(size);await readExact(handle,buffer,parsed.dataStart+relative);for(let o=0;o<size;o+=width){const n=valueAt(buffer,o,tensor.dtype);if(n!==null){if(Number.isNaN(n))nanCount++;else if(n===Infinity)positiveInfinityCount++;else if(n===-Infinity)negativeInfinityCount++;}}}
      results.push({name:tensor.name,dtype:tensor.dtype,shape:tensor.shape,nanCount,positiveInfinityCount,negativeInfinityCount});
    }
    return results;
  } finally { await handle.close(); }
}
