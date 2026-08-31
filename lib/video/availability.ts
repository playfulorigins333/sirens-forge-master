import "server-only";
import { isDurableComputeJobsEnabled } from "@/lib/compute-jobs";
import { isPrivateCreatorMediaDeliveryReady } from "@/lib/private-creator-media/r2Config";
export const isVideoGenerationEnabled = (env: NodeJS.ProcessEnv = process.env) => env.VIDEO_GENERATION_ENABLED === "true";
export const isVideoSubmissionReady = () => isVideoGenerationEnabled() && isDurableComputeJobsEnabled() && isPrivateCreatorMediaDeliveryReady();
