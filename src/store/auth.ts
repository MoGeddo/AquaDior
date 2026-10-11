import { create } from "zustand";
import { supabase, phoneToEmail } from "../lib/supabase";
import type { Profile } from "../lib/types";

/**
 * تحويل المُعرّف لإيميل:
 * - لو فيه @ → إيميل مباشر (المالك/المدير)
 * - لو أرقام بس → رقم موبايل (توافق مع الإصدار القديم)
 * - غير كده → يوزر نيم (العمال)
 */
function toEmail(identifier: string): string {
  const id = identifier.trim();
  if (id.includes("@")) return id.toLowerCase();
  if (/^\d{8,}$/.test(id)) return phoneToEmail(id);
  return `${id.toLowerCase()}@ommal.app`;
}

interface AuthState {
  profile: Profile | null;
  loading: boolean;
  ready: boolean;
  init: () => Promise<void>;
  /** دخول عام: إيميل للمديرين، يوزر نيم للعمال */
  signIn: (identifier: string, password: string) => Promise<{ error?: string }>;
  signUp: (
    phone: string,
    fullName: string,
    username: string,
    password: string
  ) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  profile: null,
  loading: false,
  ready: false,

  init: async () => {
    set({ loading: true });
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) await get().refresh();
    supabase.auth.onAuthStateChange(async (_event: string, session: any) => {
      if (session?.user) await get().refresh();
      else set({ profile: null });
    });
    set({ loading: false, ready: true });
  },

  refresh: async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return set({ profile: null });
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", auth.user.id)
      .single();
    set({ profile: (data as Profile) ?? null });
  },

  signIn: async (identifier, password) => {
    set({ loading: true });
    const email = toEmail(identifier);
    console.log("🔐 محاولة دخول بالإيميل:", email);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      set({ loading: false });
      console.error("❌ خطأ الدخول من Supabase:", error);
      // ترجمة الأخطاء الشائعة لرسائل مفهومة
      const m = (error.message ?? "").toLowerCase();
      let msg = error.message;
      if (m.includes("invalid login")) {
        msg = "اسم المستخدم أو كلمة السر غلط";
      } else if (m.includes("email not confirmed")) {
        msg = "الحساب لسه متأكدش — اقفل Confirm email في Supabase";
      } else if (m.includes("rate limit") || m.includes("too many")) {
        msg = "جرّبت كتير مرات — استنى دقيقة وجرّب تاني";
      } else if (m.includes("invalid api key") || m.includes("apikey")) {
        msg = "مفتاح الـ API غلط أو معطّل — محتاج الـ publishable key";
      } else if (m.includes("failed to fetch") || m.includes("network")) {
        msg = "مش عارف أوصل للداتابيز — راجع الإنترنت";
      }
      return { error: `❌ ${msg}\n\n(التفاصيل التقنية: ${error.message})` };
    }
    await get().refresh();
    set({ loading: false });
    return {};
  },

  signUp: async (phone, fullName, username, password) => {
    set({ loading: true });
    const clean = phone.replace(/\D/g, "");
    if (clean.length < 10) {
      set({ loading: false });
      return { error: "اكتب رقم موبايل صحيح" };
    }

    const { data, error } = await supabase.auth.signUp({
      email: toEmail(username),
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          phone: clean,
          username: username.trim().toLowerCase(),
          role: "worker",
        },
      },
    });

    if (error) {
      set({ loading: false });
      return { error: error.message };
    }

    if (!data.session) {
      set({ loading: false });
      return {
        error:
          "تم إنشاء الحساب. لو ما دخلتش تلقائيًا، اتأكد إن Confirm email مقفول في Supabase.",
      };
    }

    await get().refresh();
    set({ loading: false });
    return {};
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ profile: null });
  },
}));
