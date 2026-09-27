import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "./env.js";

export function admin() {
  return createClient(
    requireEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );
}
