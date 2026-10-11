import { useAuth } from "../store/auth";
import { useNavigate } from "react-router-dom";

export default function PendingApproval() {
  const { profile, signOut } = useAuth();
  const nav = useNavigate();

  return (
    <div className="auth" style={{ alignItems: "flex-start", padding: "24px 16px" }}>
      <div className="login-card center">
        <div style={{ fontSize: 52 }}>⏳</div>
        <h1 style={{ fontSize: 20, margin: "10px 0" }}>
          حسابك مستني تفعيل المالك
        </h1>
        <p className="muted" style={{ fontSize: 14, lineHeight: 1.8 }}>
          سجّلنا بياناتك وصورة بطاقتك.
          <br />
          أول ما المالك يوافق، هتقدر تسجّل حضورك وتاخد فلوك.
        </p>

        {profile && (
          <div
            className="card mt"
            style={{ textAlign: "right", boxShadow: "none" }}
          >
            <div className="row">
              <span className="muted">الاسم</span>
              <b>{profile.full_name}</b>
            </div>
            <div className="row">
              <span className="muted">الموبايل</span>
              <b dir="ltr">{profile.phone}</b>
            </div>
            <div className="row">
              <span className="muted">الحالة</span>
              <span className="badge amber">مستني موافقة</span>
            </div>
          </div>
        )}

        <button
          className="btn btn-block mt"
          onClick={async () => {
            await signOut();
            nav("/login", { replace: true });
          }}
        >
          خروج
        </button>

        <p className="small muted mt">تقدر تقفل التطبيق وتفتحه تاني بعدين.</p>
      </div>
    </div>
  );
}
