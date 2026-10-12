import { useEffect, useState } from "react";
import {
  getRememberedUsername,
  getRememberSession,
  setRememberSession,
  saveRememberedUsername,
} from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../store/auth";
import AquaDiorLogo from "../components/AquaDiorLogo";

export default function Login() {
  const { signIn, profile, loading } = useAuth();
  const nav = useNavigate();

  const [username, setUsername] = useState(getRememberedUsername);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(getRememberSession);
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!profile) return;
    if (profile.status === "pending") nav("/pending", { replace: true });
    else if (profile.status !== "active" || !profile.is_active)
      nav("/rejected", { replace: true });
    else nav(profile.role === "worker" ? "/worker" : "/admin", { replace: true });
  }, [profile, nav]);

  if (profile) return <div className="empty">جاري تحويلك...</div>;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!username.trim()) return setErr("اكتب اسم المستخدم");
    if (!password) return setErr("اكتب كلمة السر");
    setRememberSession(remember);
    const r = await signIn(username, password);
    if (r.error) {
      setErr(r.error);
      return;
    }
    saveRememberedUsername(username, remember);
  }

  return (
    <div className="auth auth-login">
      <div className="auth-bg" aria-hidden="true" />
      <div className="auth-card">
        <div className="auth-brand">
          <AquaDiorLogo size={70} showText={true} />
          <p style={{ marginTop: 8 }}>نظام إدارة العمليات وحضور ومصاريف العمال</p>
        </div>

        {err && <div className="alert error">{err}</div>}

        <form onSubmit={onSubmit} className="auth-form" autoComplete="on">
          <div className="inp-group">
            <label htmlFor="u">اسم المستخدم</label>
            <div className="inp">
              <span className="inp-ico">👤</span>
              <input
                id="u"
                name="username"
                dir="ltr"
                maxLength={128}
                autoComplete="username"
                placeholder="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          </div>

          <div className="inp-group">
            <label htmlFor="p">كلمة السر</label>
            <div className="inp">
              <span className="inp-ico">🔒</span>
              <input
                id="p"
                name="current-password"
                type={show ? "text" : "password"}
                maxLength={128}
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

          <label className="remember-row">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => {
                const enabled = event.target.checked;
                setRemember(enabled);
                setRememberSession(enabled);
                if (!enabled) saveRememberedUsername("", false);
              }}
            />
            <span className="remember-copy">
              <strong>خليك مسجّل على هذا الجهاز</strong>
              <small>نحفظ الجلسة واسم المستخدم فقط؛ لا نخزّن كلمة السر. مدير كلمات المرور في جهازك يقدر يملأها تلقائيًا.</small>
            </span>
          </label>

          <div className="role-hint">
            <span className="muted small">كل واحد له حساب باسمه</span>
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

      </div>
    </div>
  );
}
