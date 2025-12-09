// lib/generation-jobs.ts

export type JobStatus = "queued" | "processing" | "completed" | "failed";
export type MediaKind = "image" | "video";

export interface JobOutput {
  kind: MediaKind;
  url: string;
}

export interface JobRecord {
  id: string;
  createdAt: number;
  status: JobStatus;
  payload: any;
  outputs: JobOutput[];
  error?: string | null;
}

// In-memory job store
const jobs = new Map<string, JobRecord>();

function makeJobId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `job_${Date.now()}_${rand}`;
}

export function createJob(payload: any): JobRecord {
  const id = makeJobId();

  const job: JobRecord = {
    id,
    createdAt: Date.now(),
    status: "queued",
    payload,
    outputs: [],
    error: null,
  };

  jobs.set(id, job);

  simulateProcessing(job).catch((err) => {
    const current = jobs.get(job.id);
    if (!current) return;
    current.status = "failed";
    current.error = err instanceof Error ? err.message : "Unknown error";
    jobs.set(job.id, current);
  });

  return job;
}

export function getJob(id: string): JobRecord | null {
  return jobs.get(id) ?? null;
}

export function listJobs(limit = 50): JobRecord[] {
  return Array.from(jobs.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

// -------------------------------
// MOCK PROCESSING (replace later)
// -------------------------------

async function simulateProcessing(job: JobRecord) {
  job.status = "processing";
  jobs.set(job.id, job);

  const delayMs = 2000 + Math.floor(Math.random() * 3000);
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  const existing = jobs.get(job.id);
  if (!existing) return;

  existing.outputs = buildMockOutputs(existing.payload);
  existing.status = "completed";
  jobs.set(job.id, existing);
}

function buildMockOutputs(payload: any): JobOutput[] {
  const mode = payload?.mode ?? "text_to_image";
  const batch =
    typeof payload?.advanced?.batch === "number" && payload.advanced.batch > 0
      ? payload.advanced.batch
      : 1;

  const isVideo =
    mode === "image_to_video" || mode === "text_to_video";

  const kind: MediaKind = isVideo ? "video" : "image";

  const outputs: JobOutput[] = [];

  for (let i = 0; i < batch; i++) {
    if (kind === "image") {
      outputs.push({
        kind: "image",
        url: "https://placehold.co/1024x1024/111827/8b5cf6?text=SirensForge+Preview",
      });
    } else {
      outputs.push({
        kind: "video",
        url: "https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4",
      });
    }
  }

  return outputs;
}
