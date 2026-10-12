import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../store/auth";
import { supabase, DEMO_MODE } from "../lib/supabase";
import { compressImage, fmtSize } from "../lib/image";
import { AquaDiorShield } from "../components/AquaDiorLogo";

function registrationErrorMessage(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("email not confirmed")) {
    return "الحساب لم يُفعّل بعد. لا يلزم العامل بريد إلكتروني؛ على الإدارة تفعيل الحساب ثم يمكن الدخول باسم المستخدم وكلمة السر.";
  }
  if (normalized.includes("rate limit") || normalized.includes("too many")) {
    return "محاولات كثيرة؛ انتظر قليلًا ثم حاول مرة أخرى.";
  }
  if (/already registered|already exists|duplicate key|unique constraint|مسجل|مسجّل|موجود/i.test(message)) {
    return "اسم المستخدم أو رقم الموبايل مستخدم من قبل. جرّب الدخول بالحساب الموجود أو تواصل مع الإدارة.";
  }
  if (/invalid email|unable to validate email/i.test(message)) {
    return "تعذر إعداد الحساب من الخادم. العامل لا يحتاج إلى بريد إلكتروني؛ راجع الإدارة لإصلاح إعدادات التسجيل.";
  }
  if (/database error saving new user|trigger/i.test(message)) {
    return "الخادم رفض حفظ طلب التسجيل؛ تحتاج الإدارة لمراجعة إعداد تسجيل العمال في قاعدة البيانات.";
  }
  if (/failed to fetch|network|fetch error/i.test(message)) {
    return "تعذر الاتصال بالخادم؛ تحقق من الإنترنت وحاول مرة أخرى.";
  }
  if (/row-level security|storage|bucket/i.test(message)) {
    return "تعذر رفع صورة البطاقة؛ تحتاج الإدارة لمراجعة مخزن الصور وصلاحياته.";
  }

  const safeMessage = message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "بيانات الحساب")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return safeMessage ? `تعذر إكمال التسجيل: ${safeMessage}` : "تعذر إكمال التسجيل؛ حاول مرة أخرى أو تواصل مع الإدارة.";
}

export default function Register() {
  const { signUp, refresh } = useAuth();
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");

  const [card, setCard] = useState<File | null>(null);
  const [cardPreview, setCardPreview] = useState<string | null>(null);
  const [cardSize, setCardSize] = useState<number>(0);

  const [busy, setBusy] = useState(false);
  const [accountCreated, setAccountCreated] = useState(false);
  const [err, setErr] = useState("");

  function pickCard(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) {
      return setErr("اختار صورة JPG أو PNG أو WebP فقط");
    }
    if (f.size > 10 * 1024 * 1024) return setErr("حجم الصورة أكبر من 10 ميجابايت");
    setErr("");
    setCard(f);
    setCardSize(f.size);
    const reader = new FileReader();
    reader.onload = () => setCardPreview(reader.result as string);
    reader.readAsDataURL(f);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");

    const clean = phone.replace(/\D/g, "");
    if (clean.length < 10 || clean.length > 15) return setErr("اكتب رقم موبايل صحيح من 10 إلى 15 رقمًا");
    if (fullName.trim().length < 3 || fullName.trim().length > 120) {
      return setErr("الاسم يجب أن يكون بين 3 و120 حرفًا");
    }
    if (!/^[a-z0-9._-]{3,32}$/i.test(username.trim())) {
      return setErr("اسم المستخدم من 3 إلى 32 حرفاً/رقماً، بدون مسافات أو رموز أخرى");
    }
    if (password.length < 8 || password.length > 128) return setErr("كلمة السر يجب أن تكون بين 8 و128 حرفًا");
    if (password !== password2) return setErr("كلمة السر مش متطابقة");
    if (!card) return setErr("لازم ترفع صورة البطاقة");

    setBusy(true);
    let hasAccount = accountCreated;
    try {
      // If account creation succeeded but image upload failed, resume the same account.
      let existingAccountSignIn = false;
      if (!accountCreated) {
        const r = await signUp(clean, fullName, username, password);
        if (r.accountExists) {
          hasAccount = true;
          setAccountCreated(true);
          existingAccountSignIn = true;
        } else if (r.error) {
          if (r.accountCreated) {
            hasAccount = true;
            setAccountCreated(true);
            setErr(registrationErrorMessage(r.error));
            return;
          }
          const duplicate = /already registered|already exists|duplicate key|unique constraint|مسجل|مسجّل|موجود/i.test(r.error);
          if (!duplicate) {
            setErr(registrationErrorMessage(r.error));
            return;
          }
          hasAccount = true;
          setAccountCreated(true);
          existingAccountSignIn = true;
        } else {
          hasAccount = true;
          setAccountCreated(true);
        }
      }

      if (!DEMO_MODE) {
        let { data: auth, error: authError } = await supabase.auth.getUser();
        if (authError || !auth.user) {
          const { error: loginError } = await supabase.auth.signInWithPassword({
            email: `${username.trim().toLowerCase()}@ommal.app`,
            password,
          });
          if (loginError) {
            const message = loginError.message ?? "";
            if (/email not confirmed/i.test(message)) {
              setErr("هذا الحساب لم يُفعّل بعد من الإدارة. العامل لا يحتاج بريدًا أو رابط تأكيد؛ اطلب من الإدارة تفعيل الحساب، ثم سجّل الدخول بنفس اسم المستخدم وكلمة السر.");
            } else if (/invalid login|invalid credentials/i.test(message)) {
              setErr("اسم المستخدم أو كلمة السر غير صحيحين. إذا كان هذا أول تسجيل، تأكد أن الإدارة لم تسجل هذا الحساب مسبقًا.");
            } else {
              setErr(registrationErrorMessage(message));
            }
            return;
          }
          existingAccountSignIn = true;
          ({ data: auth, error: authError } = await supabase.auth.getUser());
        }
        if (authError || !auth.user) throw new Error("تعذر بدء جلسة للحساب؛ سجّل الدخول ثم أعد رفع الصورة");

        const { data: registrationProfile, error: profileError } = await supabase
          .from("profiles")
          .select("full_name, phone, username, role, status, is_active, id_card_url")
          .eq("id", auth.user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!registrationProfile) throw new Error("ملف الحساب غير موجود؛ تواصل مع الإدارة قبل إعادة التسجيل");

        if (registrationProfile.role !== "worker" || registrationProfile.status !== "pending" || registrationProfile.is_active !== false) {
          await refresh();
          if (registrationProfile.status === "pending") nav("/pending", { replace: true });
          else if (registrationProfile.status === "active") {
            nav(registrationProfile.role === "worker" ? "/worker" : "/admin", { replace: true });
          } else nav("/rejected", { replace: true });
          return;
        }

        if (registrationProfile.phone !== clean ||
            registrationProfile.username !== username.trim().toLowerCase() ||
            registrationProfile.full_name !== fullName.trim()) {
          if (existingAccountSignIn) await useAuth.getState().signOut();
          setErr("بيانات هذا الحساب لا تطابق البيانات المدخلة. استخدم بيانات الحساب المسجل أو تواصل مع الإدارة.");
          return;
        }

        if (registrationProfile.id_card_url) {
          await refresh();
          nav("/pending", { replace: true });
          return;
        }
        if (!card) throw new Error("اختار صورة البطاقة");

        const blob = await compressImage(card);
        if (blob.size > 5 * 1024 * 1024) {
          throw new Error("الصورة بعد الضغط ما زالت أكبر من 5 ميجابايت");
        }
        const path = `${auth.user.id}/card.jpg`;
        const { error: uploadError } = await supabase.storage
          .from("id-cards")
          .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
        if (uploadError) throw uploadError;

        const { error: pathError } = await supabase.rpc("set_my_id_card", {
          p_path: path,
        });
        if (pathError) throw pathError;
      }

      await refresh();
      nav("/pending", { replace: true });
    } catch (e: any) {
      const message = registrationErrorMessage(String(e?.message ?? ""));
      setErr(hasAccount
        ? `الحساب موجود، لكن لم يكتمل التسجيل أو رفع صورة البطاقة. ${message} أعد المحاولة بنفس اسم المستخدم وكلمة السر.`
        : message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth auth-register">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            <AquaDiorShield size={50} />
          </div>
          <h1>تسجيل حساب جديد</h1>
          <p>أكوا ديور للمقاولات — سجّل بياناتك وسيُراجعها المالك قبل التفعيل</p>
        </div>

        {err && <div className="alert error">{err}</div>}

        <label className="field">
          <span>رقم الموبايل *</span>
          <input
            className="input"
            inputMode="numeric"
            maxLength={15}
            dir="ltr"
            placeholder="01xxxxxxxxx"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value.replace(/[^\d]/g, ""));
              setAccountCreated(false);
            }}
          />
        </label>

        <label className="field">
          <span>الاسم زي البطاقة بالظبط *</span>
          <input
            className="input"
            maxLength={120}
            placeholder="اكتب الاسم كاملًا كما في البطاقة"
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
              setAccountCreated(false);
            }}
          />
        </label>

        {/* صورة البطاقة */}
        <div className="field">
          <span>صورة البطاقة (واضحة) *</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={pickCard}
            style={{ display: "none" }}
          />
          <div
            onClick={() => fileRef.current?.click()}
            style={{
              border: "2px dashed var(--border)",
              borderRadius: 14,
              padding: cardPreview ? 8 : 26,
              textAlign: "center",
              cursor: "pointer",
              background: cardPreview ? "#f8fafc" : "transparent",
            }}
          >
            {cardPreview ? (
              <>
                <img
                  src={cardPreview}
                  alt="البطاقة"
                  style={{
                    width: "100%",
                    maxHeight: 180,
                    objectFit: "contain",
                    borderRadius: 8,
                  }}
                />
                <div className="small muted mt">
                  ✅ تم اختيار الصورة ({fmtSize(cardSize)}) — اضغط للتغيير
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 34 }}>🪪</div>
                <div className="small muted mt">اضغط تصوّر البطاقة أو ترفعها</div>
              </>
            )}
          </div>
        </div>

        <label className="field">
          <span>اسم المستخدم * (بدون بريد إلكتروني — هتدخل بيه فقط)</span>
          <input
            className="input"
            dir="ltr"
            autoComplete="username"
            maxLength={32}
            placeholder="ahmed.ali"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value.replace(/\s/g, ""));
              setAccountCreated(false);
            }}
          />
        </label>

        <label className="field">
          <span>كلمة السر *</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <label className="field">
          <span>تأكيد كلمة السر *</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
          />
        </label>

        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "جاري التسجيل..." : "سجّل"}
        </button>

        <p className="small muted center mt">
          حسابك هيفتح بعد ما المالك يراجع بياناتك وصورة البطاقة
        </p>

        <button
          type="button"
          className="btn btn-block btn-ghost mt"
          onClick={() => nav("/login")}
        >
          عندي حساب — دخول
        </button>
      </form>
    </div>
  );
}
