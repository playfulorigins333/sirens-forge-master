drop policy if exists
  "authenticated users can upload lora datasets lk1r3q_0"
on storage.objects;

drop policy if exists
  "allow anon uploads to lora-datasets"
on storage.objects;

drop policy if exists
  "allow authenticated uploads to lora-datasets"
on storage.objects;

drop policy if exists
  "sf_lora_datasets_insert_public"
on storage.objects;

drop policy if exists
  "sf_lora_datasets_update_public"
on storage.objects;
