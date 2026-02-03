// app/api/generate/route.ts
// STAGE 4 — FULL GENERATION PATH (cookie-safe, serialization-safe)

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import {
  parseGenerationRequest,
  type GenerationRequest,
} from "@/lib/generation/contract";

import { resolveLoraStack } from "@/lib/generation/lora-resolver";
import { buildWorkflow } from "@/lib/comfy/buildWorkflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ------------------------------------------------------------
// ENV
// ------------------------------------------------------------
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const GATEWAY_BASE = process.env.RUNPOD_COMFY_WEBHOOK || "";

const IMAGE_MODES: GenerationRequest["mode"][] = ["txt2img", "img2img"];
const COMFY_TIMEOUT_MS = 120_000;

// ------------------------------------------------------------
// JSON helper (ALWAYS returns JSON, never throws)
// ------------------------------------------------------------
function json(
  payload: Record<string, any>,
  status = 200,
  cookieOps?: {
    set?: { name: string; value: string; options?: any }[];
    del?: string[];
  }
) {
  const res = NextResponse.json(payload, { status });

  if (cookieOps?.set) {
    for (const c of cookieOps.set) {
      res.cookies.set(c.name, c.value, c.options);
    }
  }
  if (cookieOps?.del) {
    for (const name of cookieOps.del) {
      res.cookies.delete(name);
    }
  }

  return res;
}

// ------------------------------------------------------------
// Supabase (cookie-safe for App Router)
// ------------------------------------------------------------
async function createSupabase() {
  const store = await cookies();

  const pendingSet: { name: string; value: string; options?: any }[] = [];
  const pendingDel: string[] = [];

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return store.getAll().map((c) => ({
          name: c.name,
          value: c.value,
        }));
      },
      setAll(list) {
        for (const c of list) {
          if (!c?.name) continue;

          pendingSet.push({
            name: c.name,
            value: c.value ?? "",
            options: c.options,
          });

          if (
            (typeof c.options?.maxAge === "number" &&
              c.options.maxAge <= 0) ||
            (c.options?.expires &&
              new Date(c.options.expires).getTime() <= Date.now())
          ) {
            pendingDel.push(c.name);
          }
        }
      },
    },
  });

  return { supabase, pendingSet, pendingDel };
}

// ------------------------------------------------------------
// POST /api/generate
// ------------------------------------------------------------
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();

  try {
    // ---------- ENV GUARD ----------
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(
        {
          success: false,
          error: "env_missing",
          detail:
            "Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY",
          requestId,
        },
        500
      );
    }

    if (!GATEWAY_BASE) {
      return json(
        {
          success: false,
          error: "env_missing",
          detail: "Missing RUNPOD_COMFY_WEBHOOK",
          requestId,
        },
        500
      );
    }

    // ---------- BODY ----------
    let raw: any;
    try {
      raw = await req.json();
    } catch {
      return json(
        {
          success: false,
          error: "bad_request",
          detail: "Invalid JSON body",
          requestId,
        },
        400
      );
    }

    // ---------- AUTH ----------
    const { supabase, pendingSet, pendingDel } = await createSupabase();

    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      return json(
        {
          success: false,
          error: "not_authenticated",
          requestId,
        },
        401,
        { set: pendingSet, del: pendingDel }
      );
    }

    // ---------- SUBSCRIPTION ----------
    const admin = createServerClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      { cookies: { getAll: () => [] } }
    );

    const { data: sub } = await admin
      .from("user_subscriptions")
      .select("status")
      .eq("user_id", user.id)
      .in("status", ["active", "trialing"])
      .maybeSingle();

    if (!sub) {
      return json(
        {
          success: false,
          error: "subscription_required",
          requestId,
        },
        402,
        { set: pendingSet, del: pendingDel }
      );
    }

    // ---------- CONTRACT ----------
    const request = parseGenerationRequest(raw);

    if (!IMAGE_MODES.includes(request.mode)) {
      return json(
        {
          success: false,
          error: "unsupported_mode",
          requestId,
        },
        400
      );
    }

    // ---------- LORA RESOLUTION ----------
    const loraStack = await resolveLoraStack(
      request.params.body_mode,
      request.params.user_lora
    );

    // ---------- WORKFLOW ----------
    const workflow = buildWorkflow({
      prompt: request.params.prompt,
      negative: request.params.negative_prompt || "",
      seed: request.params.seed ?? 0,
      steps: request.params.steps,
      cfg: request.params.cfg,
      width: request.params.width,
      height: request.params.height,
      loraStack,
      dnaImageNames: [],
      fluxLock: null,
    });

    // ---------- GATEWAY ----------
    const targetUrl = `${GATEWAY_BASE.replace(/\/$/, "")}/generate`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), COMFY_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow, stream: false }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const text = await res.text();

    if (!res.ok) {
      return json(
        {
          success: false,
          error: "comfyui_failed",
          detail: text,
          requestId,
        },
        502
      );
    }

    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }

    return json(
      {
        success: true,
        requestId,
        ...payload,
      },
      200,
      { set: pendingSet, del: pendingDel }
    );
  } catch (err: any) {
    return json(
      {
        success: false,
        error: "internal_error",
        detail: err?.message || "unknown error",
        requestId,
      },
      500
    );
  }
}

// ------------------------------------------------------------
// Explicit GET guard (prevents implicit 405 noise)
// ------------------------------------------------------------
export async function GET() {
  return json(
    {
      success: false,
      error: "method_not_allowed",
      detail: "Use POST",
    },
    405
  );
}
