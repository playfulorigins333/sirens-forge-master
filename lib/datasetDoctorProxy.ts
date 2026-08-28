import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { ensureActiveSubscription } from "./subscription-checker";
import { requireSirensApiConfig, sirensApiFetch } from "./sirensApi";
import { isDurableComputeJobsEnabled } from "./compute-jobs";
import { trainerSelectionCapacityError, TRAINER_EXECUTION_SELECTION_LIMIT_MESSAGE } from "./dataset-doctor/trainer-execution-capacity";

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const SELECTED_IMAGE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Operation = "analyze" | "images" | "approve" | "review-selection";

function safeUpstreamResponse(upstream: Response, internalSecret: string) {
  return upstream.text().then((body) =>
    new NextResponse(body.replaceAll(internalSecret, "[redacted]"), {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("Content-Type") || "application/json",
      },
    }),
  );
}

export async function proxyDatasetDoctorOperation(
  request: Request,
  jobId: string,
  operation: Operation,
) {
  try {
    const auth = await ensureActiveSubscription();
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.error, message: auth.message },
        { status: auth.status },
      );
    }
    const userId = auth.user.id;

    if (!UUID_RE.test(jobId)) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    // Configuration is required before any service-role lookup or request parsing.
    const config = requireSirensApiConfig();
    const supabaseAdmin = getSupabaseAdmin();
    const { data: job, error } = await supabaseAdmin
      .from("dataset_doctor_jobs")
      .select("id")
      .eq("id", jobId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !job) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    let init: RequestInit;
    if (operation === "images") {
      init = { method: "GET" };
    } else if (operation === "analyze") {
      init = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rebuild_from_r2: true }),
      };
    } else {
      const body = await request.json().catch(() => null);
      const selectedImageIds = body?.selected_image_ids;
      if (
        !Array.isArray(selectedImageIds) ||
        selectedImageIds.length < 3 || selectedImageIds.length > 100 || new Set(selectedImageIds).size !== selectedImageIds.length ||
        !selectedImageIds.every(
          (id: unknown) =>
            typeof id === "string" && SELECTED_IMAGE_ID_RE.test(id),
        )
      ) {
        return NextResponse.json(
          { error: "INVALID_SELECTED_IMAGE_IDS" },
          { status: 400 },
        );
      }
      if (Object.keys(body).some((key) => operation === "approve" ? !["selected_image_ids", "queue_training"].includes(key) : key !== "selected_image_ids") || body.queue_training === true) return NextResponse.json({ error: "INVALID_SELECTED_IMAGE_IDS" }, { status: 400 });
      if (operation === "approve" && trainerSelectionCapacityError(selectedImageIds.length, isDurableComputeJobsEnabled())) return NextResponse.json({ error: "TRAINER_EXECUTION_SELECTION_LIMIT", message: TRAINER_EXECUTION_SELECTION_LIMIT_MESSAGE }, { status: 409 });
      init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(operation === "approve" ? { selected_image_ids: selectedImageIds, queue_training: false } : { selected_image_ids: selectedImageIds }) };
    }

    const upstream = await sirensApiFetch(
      `/dataset-doctor/jobs/${jobId}/${operation}`,
      init,
      fetch,
      config,
    );
    return safeUpstreamResponse(upstream, config.internalSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.toLowerCase().includes("unauthorized")) {
      return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
    }
    if (
      message === "SIRENS_API_INTERNAL_SECRET_MISSING" ||
      message === "SIRENS_API_BASE_URL_MISSING"
    ) {
      return NextResponse.json({ error: message }, { status: 500 });
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
