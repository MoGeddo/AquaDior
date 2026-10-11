import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../store/auth";

const ROLE_HINT: Record<string, { label: string; icon: string; cls: string }> = {
  owner: { label: "مالك", icon: "👑", cls: "amber" },
  manager: { label: "مدير", icon: "🧑‍💼", cls: "blue" },
  developer: { label: "مطوّر", icon: "🛠️", cls: "teal" },
  worker: { label: "عامل", icon: "👷", cls: "green" },
};

export default function Login() {
  const { signIn, profile, loading } = useAuth();
  const nav = useNavigate();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [diag, setDiag] = useState("");
  const [diagBusy, setDiagBusy] = useState(false);

  if (profile) {
    if (profile.status === "pending") nav("/pending", { replace: true });
    else if (profile.status === "rejected" || !profile.is_active)
      nav("/rejected", { replace: true });
    else nav(profile.role === "worker" ? "/worker" : "/admin", { replace: true });
  }

  const lower = username.trim().toLowerCase();
  // التلميح بيظهر للحسابات الإدارية بس، من غير ما يفصح عن الاسم
  const hint = lower.length >= 3 ? ROLE_HINT.worker : null;

  /** 🔍 تشخيص الاتصال بالداتابيز */
  async function diagnose() {
    setDiagBusy(true);
    setDiag("");
    const url = import.meta.env.VITE_SUPABASE_URL as string;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    const out: string[] = [];

    out.push(`URL: ${url || "❌ مفقود"}`);
    out.push(`KEY: ${key ? key.slice(0, 18) + "..." : "❌ مفقود"}`);

    // 1) fetch مباشر
    try {
      const r = await fetch(`${url}/rest/v1/profiles?select=id&limit=1`, {
        headers: { apikey: key },
      });
      out.push(`fetch: HTTP ${r.status}`);
    } catch (e: any) {
      out.push(`fetch: ❌ ${e.message}`);
    }

    // 2) قراءة جدول عبر supabase-js
    try {
      const { error } = await supabase.from("profiles").select("id").limit(1);
      out.push(`profiles: ${error ? "❌ " + error.message : "✅ تمام"}`);
    } catch (e: any) {
      out.push(`profiles: ❌ ${e.message}`);
    }

    // 3) محاولة دخول حقيقية
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: "abden.younes@ommal.app",
        password: "123456",
      });
      out.push(`signIn: ${error ? "❌ " + error.message : "✅ نجح الدخول!"}`);
    } catch (e: any) {
      out.push(`signIn: ❌ ${e.message}`);
    }

    setDiag(out.join("\n"));
    setDiagBusy(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!username.trim()) return setErr("اكتب اسم المستخدم");
    if (!password) return setErr("اكتب كلمة السر");
    const r = await signIn(username, password);
    if (r.error) setErr(r.error);
  }

  return (
    <div className="auth">
      <div className="auth-bg" aria-hidden />

      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo">
            <svg viewBox="0 0 512 512" width="64" height="64" aria-hidden>
              <rect width="512" height="512" rx="112" fill="#0f766e" />
              <path d="M120 300 a136 136 0 0 1 272 0 v18 H120 z" fill="#ffffff" />
              <rect x="96" y="318" width="320" height="30" rx="15" fill="#ffffff" />
              <path
                d="M186 236 l30 30 62 -66"
                stroke="#0f766e"
                strokeWidth="26"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h1>حضور ومصاريف العمال</h1>
          <p>سجّل شغلك والفلوس اللي خدتها</p>
        </div>

        {err && <div className="alert error">{err}</div>}

        <form onSubmit={onSubmit} className="auth-form">
          <div className="inp-group">
            <label htmlFor="u">اسم المستخدم</label>
            <div className="inp">
              <span className="inp-ico">👤</span>
              <input
                id="u"
                dir="ltr"
                autoComplete="username"
                placeholder="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
              />
            </div>
          </div>

          <div className="inp-group">
            <label htmlFor="p">كلمة السر</label>
            <div className="inp">
              <span className="inp-ico">🔒</span>
              <input
                id="p"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="inp-act"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? "اخفاء كلمة السر" : "إظهار كلمة السر"}
              >
                {show ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          <div className="role-hint">
            {hint ? (
              <span className={`badge ${hint.cls}`}>
                {hint.icon} {hint.label}
              </span>
            ) : (
              <span className="muted small">كل واحد له حساب باسمه</span>
            )}
          </div>

          <button className="btn btn-primary btn-block btn-lg" disabled={loading}>
            {loading ? "جاري الدخول..." : "دخول"}
          </button>
        </form>

        <div className="auth-foot">
          <span className="muted small">أول مرة؟</span>
          <button className="btn btn-ghost btn-sm" onClick={() => nav("/register")}>
            سجّل حساب جديد
          </button>
        </div>

        <button
          type="button"
          className="btn btn-ghost btn-sm btn-block mt"
          onClick={diagnose}
          disabled={diagBusy}
        >
          {diagBusy ? "بيختبر..." : "🔍 اختبر الاتصال بالداتابيز"}
        </button>

        {diag && (
          <pre
            dir="ltr"
            style={{
              fontSize: 11,
              lineHeight: 1.8,
              background: "rgba(0,0,0,0.06)",
              padding: 12,
              borderRadius: 10,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              marginTop: 10,
            }}
          >
            {diag}
          </pre>
        )}
      </div>
    </div>
  );
}
