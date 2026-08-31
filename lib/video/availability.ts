import { isPrivateCreatorMediaDeliveryReady } from "@/lib/private-creator-media/r2Config";
export const isVideoGenerationEnabled = (env: NodeJS.ProcessEnv = process.env) => env.VIDEO_GENERATION_ENABLED === "true";
export const isVideoBaseReady = (env: NodeJS.ProcessEnv = process.env) => isVideoGenerationEnabled(env) && env.DURABLE_COMPUTE_JOBS_ENABLED === "true" && isPrivateCreatorMediaDeliveryReady(env);
export const isVideoSubmissionReady = () => isVideoBaseReady(process.env);
