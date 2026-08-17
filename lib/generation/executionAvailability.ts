export function isGenerationExecutionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GENERATION_EXECUTION_ENABLED === "true";
}
