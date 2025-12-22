import { ingestCaptionTemplates } from './ingestCaptionTemplates.ts';

async function run() {
  const mockJob = {
    job_id: 'test-job-001',
    output_type: 'caption_templates',
    results: [
      {
        platform: 'twitter',
        content: 'Late night energy. Link in bio.',
        metadata: { explicitness_level: 0 },
      },
      {
        platform: 'onlyfans',
        content: 'Feeling naughty tonight 😈 Full set waiting.',
        metadata: { explicitness_level: 2 },
      },
      {
        platform: 'fanvue',
        content: 'Exclusive drops for my favorites.',
        metadata: { explicitness_level: 1 },
      },
      {
        platform: 'fanvue',
        content: 'Ultra explicit gated test.',
        metadata: { explicitness_level: 3 },
      },
    ],
  };

  const result = await ingestCaptionTemplates(mockJob);
  console.log('INGEST RESULT:', result);
}

run().catch(console.error);
