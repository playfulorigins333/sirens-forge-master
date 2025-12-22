import { ingestCaptionTemplates } from './ingestCaptionTemplates';

async function run() {
  const mockJob = {
    job_id: 'test-job-001',
    results: [
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
