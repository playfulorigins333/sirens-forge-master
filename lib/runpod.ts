// lib/runpod.ts
import fs from "fs";
import path from "path";

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY!;
const RUNPOD_API_URL = "https://api.runpod.io/graphql";

if (!RUNPOD_API_KEY) {
  throw new Error("Missing env: RUNPOD_API_KEY");
}

type StartLoraPodArgs = {
  loraId: string;
  userId: string;
  supabaseUrl: string;
  serviceRoleKey: string;
};

export async function startLoraTrainingPod({
  loraId,
  userId,
  supabaseUrl,
  serviceRoleKey,
}: StartLoraPodArgs) {
  const templatePath = path.join(
    process.cwd(),
    "runpod",
    "start_pod.json"
  );

  const templateRaw = fs.readFileSync(templatePath, "utf-8");

  const podConfig = JSON.parse(templateRaw);

  // Inject runtime env vars
  podConfig.env.LORA_ID = loraId;
  podConfig.env.USER_ID = userId;
  podConfig.env.SUPABASE_URL = supabaseUrl;
  podConfig.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey;

  const query = `
    mutation CreatePod($input: PodInput!) {
      podCreate(input: $input) {
        id
        name
        desiredStatus
      }
    }
  `;

  const res = await fetch(RUNPOD_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
    },
    body: JSON.stringify({
      query,
      variables: {
        input: podConfig,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RunPod API error: ${text}`);
  }

  const json = await res.json();

  if (json.errors) {
    throw new Error(
      `RunPod GraphQL error: ${JSON.stringify(json.errors)}`
    );
  }

  return json.data.podCreate;
}
