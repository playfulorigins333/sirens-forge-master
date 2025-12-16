// lib/runpod.ts

const RUNPOD_API_URL = "https://api.runpod.io/graphql";

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
  const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;

  // Runtime check ONLY (do not crash build)
  if (!RUNPOD_API_KEY) {
    throw new Error("RUNPOD_API_KEY is not configured");
  }

  const podConfig = {
    name: `lora-${loraId}`,
    imageName: "python:3.10",
    gpuTypeId: "NVIDIA_T4",
    cloudType: "SECURE",
    containerDiskInGb: 20,
    volumeInGb: 20,
    env: {
      LORA_ID: loraId,
      USER_ID: userId,
      SUPABASE_URL: supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    },
  };

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
      variables: { input: podConfig },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RunPod API error: ${text}`);
  }

  const json = await res.json();

  if (json.errors) {
    throw new Error(JSON.stringify(json.errors));
  }

  return json.data.podCreate;
}
