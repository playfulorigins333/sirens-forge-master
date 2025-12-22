import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type IngestJob = {
  job_id: string;
  mode: 'Safe' | 'NSFW' | 'Ultra';
  results: Array<{
    platform: string;
    content: string;
    metadata?: {
      explicitness_level?: number;
      tone?: string[];
    };
  }>;
};

export async function ingestCaptionTemplates(job: IngestJob) {
  let inserted = 0;
  let autoApproved = 0;

  console.log('INGEST JOB:', job.job_id);

  for (const row of job.results) {
    const explicitness = row.metadata?.explicitness_level ?? 0;

    // Auto-approval rule (LOCKED)
    const approved = explicitness < 3;

    // REQUIRED by schema
    const contentHash = crypto
      .createHash('sha256')
      .update(row.content)
      .digest('hex');

    const payload = {
      platform: row.platform,
      mode: job.mode,
      content: row.content,
      content_hash: contentHash,
      explicitness_level: explicitness,
      tone: row.metadata?.tone ?? [],
      approved,
      approved_by: approved ? 'auto' : null,
      approved_at: approved ? new Date().toISOString() : null,
      active: true,
      job_id: job.job_id,
    };

    console.log('ATTEMPT INSERT:', payload);

    const { error } = await supabase
      .from('caption_templates')
      .insert(payload);

    if (error) {
      console.error('SUPABASE INSERT ERROR:', error);
      continue;
    }

    inserted++;
    if (approved) autoApproved++;
  }

  return {
    job_id: job.job_id,
    inserted,
    auto_approved: autoApproved,
  };
}
