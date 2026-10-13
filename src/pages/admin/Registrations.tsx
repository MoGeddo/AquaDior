import { useEffect, useState } from "react";
import { supabase, DEMO_MODE } from "../../lib/supabase";
import { fmtDateOnly } from "../../lib/calc";
import { arabicError } from "../../lib/errors";
import type { Profile } from "../../lib/types";
import { Modal } from "../../components/Modal";
import { useDialog } from "../../components/DialogProvider";
import AppIcon from "../../components/AppIcon";

export default function Registrations() {
  const { prompt } = useDialog();
  const [rows, setRows] = useState<Profile[]>([]);
  const [msg, setMsg] = useState("");
  const [approving, setApproving] = useState<Profile | null>(null);
  const [viewing, setViewing] = useState<Profile | null>(null);
  const [cardUrl, setCardUrl] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    setRows((data ?? []) as Profile[]);
  }

  useEffect(() => {
    load();
  }, []);

  async function openCard(p: Profile) {
    setViewing(p);
    setCardUrl(null);
    if (DEMO_MODE) {
      setCardUrl(
        "data:image/svg+xml;utf8," +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="250"><rect width="400" height="250" fill="#e2e8f0"/><text x="200" y="120" font-size="20" text-anchor="middle" fill="#64748b">صورة البطاقة</text><text x="200" y="150" font-size="14" text-anchor="middle" fill="#94a3b8">${p.full_name}</text></svg>`
          )
      );
      return;
    }
    if (!p.id_card_url) return;
    try {
      if (p.id_card_url.startsWith("http")) {
        setCardUrl(p.id_card_url);
      } else {
        const { data } = await supabase.storage
          .from("id-cards")
          .createSignedUrl(p.id_card_url, 3600);
        setCardUrl(data?.signedUrl ?? null);
      }
    } catch {
      setCardUrl(null);
    }
  }

  async function reject(p: Profile) {
    const reason = await prompt({
      title: `رفض طلب ${p.full_name}؟`,
      message: "سيتم رفض الطلب وإيقاف الحساب. يمكنك كتابة سبب اختياري يظهر في سجل الطلب.",
      inputLabel: "سبب الرفض (اختياري)",
      placeholder: "اكتب السبب أو اتركه فارغًا",
      confirmText: "رفض الطلب",
      cancelText: "العودة للطلب",
      maxLength: 500,
      tone: "danger",
    });
    if (reason === null) return;
    const { error } = await supabase.rpc("reject_worker", {
      p_worker_id: p.id,
      p_reason: reason.trim() || null,
    });
    if (error) return setMsg("خطأ: " + arabicError(error, "تعذر رفض الطلب."));
    setMsg("تم الرفض");
    await load();
  }

  return (
    <>
      <div className="flex-between mb wrap">
        <h2>طلبات التسجيل الجديدة</h2>
        <span className="badge amber">{rows.length} طلب</span>
      </div>

      {msg && <div className="alert success">{msg}</div>}

      <div className="card">
        <div className="card-title">
          <span>اللي سجّلوا بياناتهم ومستنيين موافقتك</span>
        </div>
        <div className="table-wrap" role="region" aria-label="جدول طلبات التسجيل" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>الاسم</th>
                <th>الموبايل</th>
                <th>اسم المستخدم</th>
                <th>تاريخ التسجيل</th>
                <th>البطاقة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <b>{p.full_name}</b>
                  </td>
                  <td className="num" dir="ltr">
                    {p.phone}
                  </td>
                  <td className="num" dir="ltr">
                    {p.username ?? "—"}
                  </td>
                  <td className="num small">{fmtDateOnly(p.created_at)}</td>
                  <td>
                    <button className="btn btn-sm" onClick={() => openCard(p)}>
                      <AppIcon name="idCard" size={16} />
                      شوف
                    </button>
                  </td>
                  <td>
                    <div className="flex">
                      <button
                        className="btn btn-sm btn-success"
                        onClick={() => setApproving(p)}
                        disabled={!DEMO_MODE && !p.id_card_url}
                        title={!DEMO_MODE && !p.id_card_url ? "لا يمكن التفعيل قبل رفع صورة البطاقة" : undefined}
                      >
                        <AppIcon name="circleCheck" size={16} />
                        فعّل
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => void reject(p)}
                        aria-label={`رفض طلب ${p.full_name}`}
                        title="رفض الطلب"
                      >
                        <AppIcon name="circleX" size={17} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="center muted">
                    <span className="empty-state-inline">
                      <AppIcon name="inbox" size={20} />
                      <span>مفيش طلبات جديدة</span>
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-title">إزاي بيشتغل؟</div>
        <p className="small muted">
          العامل بيسجّل بنفسه (موبايل + اسم زي البطاقة + صورة البطاقة).
          حسابه بيتفتح أول ما تضغط "فعّل" وتحدد اليومية. العامل يختار المشروع أو المشاريع بنفسه عند تسجيل الحضور.
          لو رفضت، العامل بيوصلو إشعار بالسبب.
        </p>
      </div>

      {viewing && (
        <Modal title={`بطاقة ${viewing.full_name}`} onClose={() => setViewing(null)}>
          {cardUrl ? (
            <img
              src={cardUrl}
              alt="بطاقة"
              style={{
                width: "100%",
                borderRadius: 12,
                border: "1px solid var(--border)",
              }}
            />
          ) : (
            <div className="empty">مفيش صورة مرفوعة</div>
          )}
          <div className="card mt" style={{ boxShadow: "none" }}>
            <div className="row">
              <span className="muted">الاسم المسجّل</span>
              <b>{viewing.full_name}</b>
            </div>
            <div className="row">
              <span className="muted">الموبايل</span>
              <b dir="ltr">{viewing.phone}</b>
            </div>
          </div>
          <p className="small muted center">
            تأكد إن الاسم في الصورة مطابق للاسم المسجّل
          </p>
        </Modal>
      )}

      {approving && (
        <ApproveModal
          worker={approving}
          onClose={() => setApproving(null)}
          onDone={async () => {
            setApproving(null);
            setMsg("تم تفعيل الحساب");
            await load();
          }}
        />
      )}
    </>
  );
}

function ApproveModal({
  worker,
  onClose,
  onDone,
}: {
  worker: Profile;
  onClose: () => void;
  onDone: () => void;
}) {
  const [wage, setWage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function approve() {
    setErr("");
    if (!wage || Number(wage) <= 0) return setErr("حدد اليومية");
    setBusy(true);
    const { error } = await supabase.rpc("approve_worker", {
      p_worker_id: worker.id,
      p_daily_wage: Number(wage),
    });
    setBusy(false);
    if (error) return setErr(arabicError(error, "تعذر حفظ بيانات العامل."));
    onDone();
  }

  return (
    <Modal centered title={`تفعيل ${worker.full_name}`} onClose={onClose}>
      {err && <div className="alert error">{err}</div>}
      {!DEMO_MODE && !worker.id_card_url && (
        <div className="alert error" role="alert">
          لا يمكن التفعيل قبل رفع صورة البطاقة والتحقق منها.
        </div>
      )}

      <label className="field">
        <span>اليومية (جنيه)</span>
        <input
          className="input input-big"
          inputMode="decimal"
          placeholder="350"
          value={wage}
          onChange={(e) => setWage(e.target.value.replace(/[^\d.]/g, ""))}
          autoFocus
        />
      </label>

      <p className="small muted">بعد التفعيل، العامل يختار بنفسه من المشاريع المفتوحة عند تسجيل الحضور.</p>


      <button className="btn btn-primary btn-block" onClick={approve} disabled={busy || (!DEMO_MODE && !worker.id_card_url)}>
        {busy ? "جاري التفعيل..." : "فعّل الحساب"}
      </button>
    </Modal>
  );
}
