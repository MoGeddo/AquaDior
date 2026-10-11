import { createClient } from "@supabase/supabase-js";
import { demoClient, isDemoMode } from "./mock";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const DEMO = isDemoMode();

if (DEMO) {
  console.info(
    "%c🧪 الوضع التجريبي (Demo Mode)%c\n" +
      "التطبيق شغال ببيانات وهمية. عشان تربط الداتابيز الحقيقية:\n" +
      "1. انسخ .env.example لـ .env\n" +
      "2. حط VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY\n" +
      "3. شغّل SQL files من مجلد supabase/\n" +
      "4. اعمل restart",
    "background:#0f766e;color:#fff;padding:4px 8px;border-radius:4px",
    ""
  );
}

/** العميل الأساسي — demo لو مفيش Supabase، وإلا الحقيقي */
export const supabase: any = DEMO
  ? demoClient
  : createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });

export const DEMO_MODE = DEMO;

/** إيميل وهمي مبني على رقم الموبايل (علشان Supabase Auth المجاني) */
export function phoneToEmail(phone: string): string {
  const clean = phone.replace(/\D/g, "");
  return `${clean}@ommal.app`;
}
