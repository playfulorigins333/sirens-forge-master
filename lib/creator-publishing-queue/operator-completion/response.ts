import type { CompletionResult } from "./types"
export function fail<T=never>(code: CompletionResult<T> extends infer _ ? any : never, message="Request rejected.", retryable=false): CompletionResult<T> { return { ok:false, code, message, retryable } as CompletionResult<T> }
export function ok<T>(data:T): CompletionResult<T> { return { ok:true, data } }
export const noStoreHeaders = { "Cache-Control":"private, no-store", Pragma:"no-cache", "Referrer-Policy":"no-referrer", "X-Content-Type-Options":"nosniff" }
export function jsonResponse(body: unknown, status=200) { return Response.json(body, { status, headers: noStoreHeaders }) }
