import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../store/auth";
import { supabase, DEMO_MODE } from "../lib/supabase";
import { compressImage, fmtSize } from "../lib/image";
import { AquaDiorShield } from "../components/AquaDiorLogo";

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
  const [err, setErr] = useState("");

  function pickCard(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) return setErr("اختار صورة");
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
    if (clean.length < 10) return setErr("اكتب رقم موبايل صحيح");
    if (fullName.trim().length < 3) return setErr("اكتب الاسم بالكامل زي ما هو في البطاقة");
    if (username.trim().length < 3) return setErr("اسم المستخدم 3 حروف على الأقل");
    if (/\s/.test(username.trim())) return setErr("اسم المستخدم من غير مسافات");
    if (password.length < 4) return setErr("كلمة السر 4 حروف على الأقل");
    if (password !== password2) return setErr("كلمة السر مش متطابقة");
    if (!card) return setErr("لازم ترفع صورة البطاقة");

    setBusy(true);

    // 1) إنشاء الحساب
    const r = await signUp(clean, fullName, username, password);
    if (r.error) {
      setBusy(false);
      return setErr(r.error);
    }

    // 2) رفع صورة البطاقة
    try {
      if (!DEMO_MODE) {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth.user?.id;
        if (uid && card) {
          const blob = await compressImage(card);
          const path = `${uid}/card.jpg`;
          const { error: upErr } = await supabase.storage
            .from("id-cards")
            .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
          if (upErr) throw upErr;

          await supabase
            .from("profiles")
            .update({ id_card_url: path })
            .eq("id", uid);
        }
      }
      await refresh();
    } catch (e: any) {
      // الحساب اتعمل بس الصورة فشلت — نبلّغ ونكمّل
      console.warn("card upload failed", e);
    }

    setBusy(false);
    nav("/pending", { replace: true });
  }

  return (
    <div className="auth" style={{ alignItems: "flex-start", padding: "16px" }}>
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            <AquaDiorShield size={50} />
          </div>
          <h1>تسجيل حساب جديد</h1>
          <p>أكوا ديور للمقاولات — سجّل بياناتك وسيتم تفعيل حسابك مباشرة</p>
        </div>

        {err && <div className="alert error">{err}</div>}

        <label className="field">
          <span>رقم الموبايل *</span>
          <input
            className="input"
            inputMode="numeric"
            dir="ltr"
            placeholder="01xxxxxxxxx"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, ""))}
          />
        </label>

        <label className="field">
          <span>الاسم زي البطاقة بالظبط *</span>
          <input
            className="input"
            placeholder="مثال: أحمد محمد علي إبراهيم"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </label>

        {/* صورة البطاقة */}
        <div className="field">
          <span>صورة البطاقة (واضحة) *</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
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
          <span>اسم المستخدم * (هتدخل بيه بعد كده)</span>
          <input
            className="input"
            dir="ltr"
            placeholder="ahmed.ali"
            value={username}
            onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))}
          />
        </label>

        <label className="field">
          <span>كلمة السر *</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <label className="field">
          <span>تأكيد كلمة السر *</span>
          <input
            className="input"
            type="password"
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
