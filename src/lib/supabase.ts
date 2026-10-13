import { createClient } from "@supabase/supabase-js";
import { demoClient } from "./mock";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? "";
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? "";
const REMEMBER_SESSION_KEY = "aquadior:remember-session";
const REMEMBERED_USERNAME_KEY = "aquadior:remembered-username";
const authMemory = new Map<string, string>();

const DEMO = import.meta.env.VITE_DEMO_MODE === "1";
export const SUPABASE_CONFIGURED = Boolean(
  url && key && !url.includes("YOUR-PROJECT-REF") && !key.includes("YOUR-ANON")
);

function browserStorage(kind: "localStorage" | "sessionStorage"): Storage | null {
  try {
    return typeof window === "undefined" ? null : window[kind];
  } catch {
    return null;
  }
}

function safeGet(storage: Storage | null, name: string): string | null {
  try {
    return storage?.getItem(name) ?? null;
  } catch {
    return null;
  }
}

export function getRememberSession(): boolean {
  return safeGet(browserStorage("localStorage"), REMEMBER_SESSION_KEY) !== "false";
}

export function setRememberSession(remember: boolean): void {
  const local = browserStorage("localStorage");
  try {
    if (remember) local?.setItem(REMEMBER_SESSION_KEY, "true");
    else local?.setItem(REMEMBER_SESSION_KEY, "false");
  } catch {
    // The session storage adapter gracefully falls back to session-only memory.
  }
}

export function getRememberedUsername(): string {
  return safeGet(browserStorage("localStorage"), REMEMBERED_USERNAME_KEY) ?? "";
}

export function saveRememberedUsername(username: string, remember: boolean): void {
  const local = browserStorage("localStorage");
  try {
    if (remember && username.trim()) local?.setItem(REMEMBERED_USERNAME_KEY, username.trim());
    else local?.removeItem(REMEMBERED_USERNAME_KEY);
  } catch {
    // No password is stored; failure only removes the username convenience.
  }
}

/** Keep only Supabase's revocable auth session, never a plaintext password. */
const authStorage = {
  getItem(name: string): string | null {
    const stored = safeGet(browserStorage("localStorage"), name)
      ?? safeGet(browserStorage("sessionStorage"), name);
    return stored ?? authMemory.get(name) ?? null;
  },
  setItem(name: string, value: string): void {
    const remember = getRememberSession();
    const preferred = browserStorage(remember ? "localStorage" : "sessionStorage");
    const other = browserStorage(remember ? "sessionStorage" : "localStorage");
    try {
      if (preferred) preferred.setItem(name, value);
      else authMemory.set(name, value);
      other?.removeItem(name);
    } catch {
      authMemory.set(name, value);
    }
  },
  removeItem(name: string): void {
    authMemory.delete(name);
    try {
      browserStorage("localStorage")?.removeItem(name);
      browserStorage("sessionStorage")?.removeItem(name);
    } catch {
      // Best effort: remove from both browser stores and the in-memory fallback.
    }
  },
};

if (DEMO) {
  console.info(
    "%c🧪 وضع تجريبي صريح — البيانات محلية وفارغة من سجلات العمال والمشاريع.%c لا تستخدمه للتشغيل الحقيقي.",
    "background:#0f766e;color:#fff;padding:4px 8px;border-radius:4px",
    ""
  );
} else if (!SUPABASE_CONFIGURED) {
  console.error(
    "إعداد Supabase ناقص. اضبط VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY أو اختر VITE_DEMO_MODE=1 للاختبار فقط."
  );
}

/**
 * Demo محلي اختياري؛ builds التشغيل الحقيقي تستبدل mockClient بواجهة stub.
 * الإعداد غير المكتمل لا يتصل بخادم وهمي؛ App يعرض شاشة التهيئة فقط.
 */
export const supabase: any = DEMO
  ? demoClient
  : createClient(
      SUPABASE_CONFIGURED ? url : "https://supabase-not-configured.invalid",
      SUPABASE_CONFIGURED ? key : "missing-supabase-anon-key",
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: authStorage,
        },
      }
    );

export const DEMO_MODE = DEMO;

/** تحويل رقم الهاتف إلى بريد اصطناعي لتوافق Supabase Auth. */
export function phoneToEmail(phone: string): string {
  const clean = phone.replace(/\D/g, "");
  return `${clean}@ommal.app`;
}
