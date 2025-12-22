import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function run() {
  console.log('READ TEST: approved + active captions');

  const { data, error } = await supabase
    .from('caption_templates')
    .select(
      'id, platform, mode, content, approved, active, created_at'
    )
    .eq('approved', true)
    .eq('active', true)
    .limit(5);

  if (error) {
    console.error('READ ERROR:', error);
    return;
  }

  console.log('RESULTS:', data);
}

run().catch((err) => {
  console.error('UNHANDLED ERROR:', err);
});
