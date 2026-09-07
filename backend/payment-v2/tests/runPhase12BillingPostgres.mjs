import { spawnSync } from "node:child_process"
const raw=process.env.PHASE12_DATABASE_URL
if(!raw)throw new Error("PHASE12_DATABASE_URL is required")
if(/[?#]/.test(raw))throw new Error("PHASE12_DATABASE_URL query/hash forbidden")
const url=new URL(raw)
if(!["postgres:","postgresql:"].includes(url.protocol)||!["127.0.0.1","localhost","[::1]"].includes(url.hostname)||url.port!=="5432"||url.pathname!=="/phase12_test"||url.search||url.hash)throw new Error("Refusing to run outside loopback:5432/phase12_test")
const version=spawnSync("psql",[raw,"-XAt","-v","ON_ERROR_STOP=1","-c","show server_version_num"],{encoding:"utf8"})
if(version.status!==0||!/^17\d{4}$/.test((version.stdout||"").trim()))throw new Error("PostgreSQL 17 is required")
const run=(file)=>{const result=spawnSync("psql",[raw,"-X","-v","ON_ERROR_STOP=1","-f",file],{stdio:"inherit"});if(result.status!==0)process.exit(result.status??1)}
for(const file of[
 "backend/payment-v2/tests/phase12PostgresSetup.sql",
 "supabase/migrations/20260801002800_payment_first_v2_contract.sql",
 "supabase/migrations/20260805002900_payment_v2_lifecycle_foundation.sql",
 "supabase/migrations/20260807003100_payment_v2_affiliate_attribution.sql",
 "supabase/migrations/20260807003200_affiliate_public_cutover_hardening.sql",
 "supabase/migrations/20260812080000_lock05e_payment_v2_early_bird_subscription_lifecycle.sql",
 "supabase/migrations/20260812090000_lock05f_launch_inventory_reset.sql",
 "supabase/migrations/20260905060000_phase8_governance_foundation.sql",
 "supabase/migrations/20260906070000_phase10_admin_support_security.sql",
 "supabase/migrations/20260906200000_phase12_billing_refunds_disputes.sql",
 "backend/payment-v2/tests/phase12BillingPostgresIntegration.sql",
])run(file)
console.log("Phase 12 PostgreSQL integration passed against phase12_test using real Payment V2, affiliate, A3, inventory, governance, and admin migrations.")
