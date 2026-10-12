import { create } from "zustand";
import { supabase, phoneToEmail, SUPABASE_CONFIGURED, DEMO_MODE } from "../lib/supabase";
import type { Profile } from "../lib/types";

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
  signIn: (identifier: string, password: string) => Promise<{ error?: string }>;
  signUp: (
    phone: string,
    fullName: string,
    username: string,
    password: string
  ) => Promise<{ error?: string; accountCreated?: boolean; accountExists?: boolean }>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

let initialization: Promise<void> | null = null;

export const useAuth = create<AuthState>((set, get) => ({
  profile: null,
  loading: false,
  ready: false,

  init: () => {
    if (initialization) return initialization;
    initialization = (async () => {
      if (!DEMO_MODE && !SUPABASE_CONFIGURED) {
        set({ loading: false, ready: true, profile: null });
        return;
      }
      set({ loading: true });
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (data.session?.user) await get().refresh();

        // لا تنفّذ استدعاءات Supabase داخل callback المتزامن لتفادي قفل Auth.
        supabase.auth.onAuthStateChange((_event: string, session: any) => {
          if (!session?.user) {
            set({ profile: null, ready: true });
            return;
          }
          void Promise.resolve().then(() => get().refresh());
        });
      } catch (error) {
        console.error("Auth initialization failed", error);
        set({ profile: null });
      } finally {
        set({ loading: false, ready: true });
      }
    })();
    return initialization;
  },

  refresh: async () => {
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) {
        set({ profile: null });
        return;
      }
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", auth.user.id)
        .maybeSingle();
      if (error) throw error;
      set({ profile: (data as Profile | null) ?? null });
    } catch (error) {
      console.error("Profile refresh failed", error);
      set({ profile: null });
    }
  },

  signIn: async (identifier, password) => {
    if (!identifier.trim()) return { error: "اكتب اسم المستخدم" };
    if (!password) return { error: "اكتب كلمة السر" };
    set({ loading: true });
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: toEmail(identifier),
        password,
      });
      if (error) {
        const message = (error.message ?? "").toLowerCase();
        if (message.includes("invalid login")) {
          return { error: "اسم المستخدم أو كلمة السر غير صحيحة" };
        }
        if (message.includes("email not confirmed")) {
          return { error: "الحساب لم يُفعّل بعد. لا يلزمك بريد إلكتروني؛ اطلب من الإدارة تفعيل الحساب ثم سجّل الدخول باسم المستخدم وكلمة السر." };
        }
        if (message.includes("rate limit") || message.includes("too many")) {
          return { error: "محاولات كثيرة — انتظر قليلاً ثم حاول مرة أخرى" };
        }
        if (message.includes("failed to fetch") || message.includes("network")) {
          return { error: "تعذر الاتصال بالخادم؛ تحقق من الإنترنت" };
        }
        return { error: "تعذر تسجيل الدخول. راجع إعدادات الحساب أو اتصل بالإدارة." };
      }
      await get().refresh();
      return {};
    } catch {
      return { error: "تعذر الاتصال بالخادم؛ حاول مرة أخرى" };
    } finally {
      set({ loading: false });
    }
  },

  signUp: async (phone, fullName, username, password) => {
    if (!DEMO_MODE && !SUPABASE_CONFIGURED) {
      return { error: "التطبيق غير مربوط بقاعدة بيانات؛ تواصل مع الإدارة" };
    }
    set({ loading: true });
    try {
      const clean = phone.replace(/\D/g, "");
      const cleanUsername = username.trim().toLowerCase();
      if (clean.length < 10 || clean.length > 15) {
        return { error: "اكتب رقم موبايل صحيح" };
      }
      if (fullName.trim().length < 3 || fullName.trim().length > 120) {
        return { error: "الاسم يجب أن يكون بين 3 و120 حرفًا" };
      }
      if (!/^[a-z0-9._-]{3,32}$/.test(cleanUsername)) {
        return { error: "اسم المستخدم من 3 إلى 32 حرفاً/رقماً، بدون مسافات أو رموز أخرى" };
      }
      if (password.length < 8 || password.length > 128) {
        return { error: "كلمة السر يجب أن تكون بين 8 و128 حرفًا" };
      }

      const { data, error } = await supabase.auth.signUp({
        email: toEmail(cleanUsername),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            phone: clean,
            username: cleanUsername,
            role: "worker",
          },
        },
      });
      if (error) return { error: error.message };
      if (!data.session) {
        // Supabase intentionally returns no identity details for an existing
        // email when email confirmation is enabled. Try signing in so a worker
        // can safely resume a prior registration without creating a duplicate.
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          return { accountExists: true };
        }
        return {
          accountCreated: Boolean(data.user),
          error: data.user
            ? "تم إنشاء الحساب، لكن إعدادات الخادم منعت بدء جلسة الدخول. لا تدخل بريدًا إلكترونيًا؛ يلزم من الإدارة إيقاف تأكيد البريد وتفعيل الحساب مرة واحدة، ثم تسجّل الدخول باسم المستخدم وكلمة السر."
            : "الخادم لم يُكمل إنشاء الحساب. لا تحتاج إلى بريد إلكتروني؛ أعد المحاولة، وإذا استمر الرفض راجع الإدارة.",
        };
      }
      await get().refresh();
      return {};
    } catch {
      return { error: "تعذر إنشاء الحساب؛ تحقق من الاتصال وحاول مرة أخرى" };
    } finally {
      set({ loading: false });
    }
  },

  signOut: async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      set({ profile: null });
    }
  },
}));
