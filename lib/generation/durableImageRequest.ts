export type DurableImageSettings = {
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: number;
  output_count: number;
};

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function integer(value: number, fallback: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.trunc(finite(value, fallback))));
}

/** Canonicalizes already-normalized route values to the durable Image finalizer contract. */
export function normalizeDurableImageSettings(input: {
  width: number; height: number; steps: number; cfg: number; seed: number; batch: number;
}): DurableImageSettings {
  const candidateSeed = Math.trunc(finite(input.seed, 0));
  return {
    width: integer(input.width, 1024, 256, 2048),
    height: integer(input.height, 1536, 256, 2048),
    steps: integer(input.steps, 28, 1, 150),
    cfg: Math.max(1, Math.min(30, finite(input.cfg, 7))),
    seed: Number.isSafeInteger(candidateSeed) && candidateSeed >= 0 ? candidateSeed : 0,
    output_count: integer(input.batch, 1, 1, 4),
  };
}
