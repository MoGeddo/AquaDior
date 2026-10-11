import { useEffect, useState, useCallback } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { useAuth } from "../../store/auth";
import { supabase } from "../../lib/supabase";
import { enqueue } from "../../lib/db";
import { money, todayStr, fmtDate } from "../../lib/calc";
import type { WorkerBalance, Site, Attendance } from "../../lib/types";
import MoneyModal from "../../components/MoneyModal";
import SiteAddModal from "../../components/SiteAddModal";

function getGeo(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { timeout: 8000, enableHighAccuracy: false, maximumAge: 60000 }
    );
  });
}

export default function WorkerHome() {
  const { profile } = useAuth();
  const nav = useNavigate();
  const ctx = useOutletContext<{ bal: WorkerBalance | null; reload: () => void }>();

  const [sites, setSites] = useState<Site[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [today, setToday] = useState<Attendance | null>(null);
  const [todaySites, setTodaySites] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: string; text: string } | null>(null);
  const [showMoney, setShowMoney] = useState(false);
  const [showSite, setShowSite] = useState(false);
  const [projectLocked, setProjectLocked] = useState(false);

  const loadToday = useCallback(async () => {
    if (!profile) return;
    const d = todayStr();
    const { data } = await supabase
      .from("attendance")
      .select("*")
      .eq("worker_id", profile.id)
      .eq("work_date", d)
      .maybeSingle();
    setToday((data as Attendance) ?? null);

    if (data) {
      const { data: as } = await supabase
        .from("attendance_sites")
        .select("site_id")
        .eq("attendance_id", data.id);
      setTodaySites((as ?? []).map((r: any) => r.site_id));
    } else {
      setTodaySites([]);
    }
  }, [profile]);

  const loadProjectStatus = useCallback(async () => {
    if (!profile) return;
    const { data } = await supabase
      .from("worker_projects")
      .select("project_id, projects(status)")
      .eq("worker_id", profile.id);
    const rows = (data ?? []) as any[];
    // لو عنده مشاريع بس كلها مقفولة → اقفل الشاشة
    setProjectLocked(
      rows.length > 0 && !rows.some((r) => r.projects?.status === "active")
    );
  }, [profile]);

  const loadSites = useCallback(async () => {
    if (!profile) return;
    const { data } = await supabase
      .from("site_workers")
      .select("site_id, sites(*)")
      .eq("worker_id", profile.id);
    let list: Site[] = (data ?? [])
      .map((r: any) => r.sites)
      .filter((s: any) => s && s.is_active);

    if (list.length === 0) {
      const { data: all } = await supabase
        .from("sites")
        .select("*")
        .eq("is_active", true);
      list = (all ?? []) as Site[];
    }
    setSites(list);
  }, [profile]);

  useEffect(() => {
    loadToday();
    loadSites();
    loadProjectStatus();
  }, [loadToday, loadSites, loadProjectStatus]);

  async function register() {
    if (!profile) return;
    setBusy(true);
    setMsg(null);
    const geo = await getGeo();

    const args = {
      p_worker_id: profile.id,
      p_work_date: todayStr(),
      p_site_ids: picked.length ? picked : null,
      p_lat: geo?.lat ?? null,
      p_lng: geo?.lng ?? null,
    };

    try {
      if (navigator.onLine) {
        const { error } = await supabase.rpc("register_attendance", args);
        if (error) throw new Error(error.message);
        setMsg({ type: "success", text: "اتسجّل حضورك النهاردة ✅" });
      } else {
        await enqueue("rpc", "insert", { fn: "register_attendance", args });
        setMsg({
          type: "info",
          text: "اتسجّل أوفلاين — هيرفع أول ما النت يرجع 📵",
        });
      }
      await loadToday();
      ctx?.reload?.();
    } catch (e: any) {
      setMsg({ type: "error", text: e.message ?? "حصل خطأ" });
    }
    setBusy(false);
  }

  const bal = ctx?.bal;
  const done = !!today;

  // ===== مشروع مقفول: العمال ما يسجّلش، بس بياناته محفوظة =====
  if (projectLocked) {
    return (
      <div className="card center" style={{ padding: "36px 20px" }}>
        <div style={{ fontSize: 52 }}>📦</div>
        <h2 style={{ fontSize: 19, margin: "12px 0 8px" }}>
          مشروعك اتقفل
        </h2>
        <p className="muted" style={{ lineHeight: 1.9, fontSize: 14 }}>
          خلّصت شغلك في المشروع ده.
          <br />
          <b>كل بياناتك محفوظة</b> (أيام شغلك والفلوس اللي خدتها).
          <br />
          لو معاك فلوس متستحقّهاش، تواصل مع المالك.
        </p>

        <div
          className="card mt"
          style={{ textAlign: "right", boxShadow: "none", background: "var(--ink-50)" }}
        >
          <div className="row">
            <span className="muted">أيام شغلك</span>
            <b className="num">{bal?.days_worked ?? 0}</b>
          </div>
          <div className="row">
            <span className="muted">استحقاقك</span>
            <b className="num">{money(bal?.earned ?? 0)}</b>
          </div>
          <div className="row">
            <span className="muted">اللي خدته</span>
            <b className="num" style={{ color: "var(--amber-600)" }}>
              {money((bal?.withdrawn_approved ?? 0) + (bal?.withdrawn_pending ?? 0))}
            </b>
          </div>
          <div className="row" style={{ borderTop: "2px solid var(--ink-200)" }}>
            <span>
              <b>المتبقي لك</b>
            </span>
            <b className="num" style={{ fontSize: 20, color: "var(--green-600)" }}>
              {money(bal?.balance ?? 0)}
            </b>
          </div>
        </div>

        <button className="btn btn-block mt" onClick={() => nav("/worker/statement")}>
          📋 شوف كشف حسابك الكامل
        </button>
      </div>
    );
  }

  return (
    <>
      {/* ===== الرصيد بارز ===== */}
      <div
        className="card"
        style={{
          background: "linear-gradient(160deg, #0f766e, #134e4a)",
          border: "none",
          color: "#fff",
          boxShadow: "0 10px 28px rgba(15,118,110,0.28)",
        }}
      >
        <div style={{ fontSize: 12.5, opacity: 0.85, fontWeight: 700 }}>
          متاح تاخد دلوقتي
        </div>
        <div
          style={{
            fontSize: 36,
            fontWeight: 800,
            letterSpacing: "-1px",
            lineHeight: 1.2,
            margin: "2px 0",
          }}
        >
          {money(bal?.available ?? 0)}
        </div>
        <div style={{ fontSize: 12.5, opacity: 0.85 }}>
          رصيدك بعد كل حاجة: <b>{money(bal?.balance ?? 0)}</b>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="label">أيام الشهر</div>
          <div className="value teal">{bal?.days_worked ?? 0}</div>
        </div>
        <div className="stat">
          <div className="label">استحقاقك</div>
          <div className="value">{money(bal?.earned ?? 0)}</div>
        </div>
        <div className="stat">
          <div className="label">خدت</div>
          <div className="value amber">
            {money(
              (bal?.withdrawn_approved ?? 0) + (bal?.withdrawn_pending ?? 0)
            )}
          </div>
        </div>
        <div className="stat">
          <div className="label">يوميتك</div>
          <div className="value blue">{money(bal?.daily_wage ?? 0)}</div>
        </div>
      </div>

      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

      <div className="card">
        <div className="card-title">
          <span>{fmtDate(todayStr())}</span>
          {done ? (
            <span className="badge green">✓ نزلت</span>
          ) : (
            <span className="badge amber">لسه مسجّلتش</span>
          )}
        </div>

        {/* ===== لسه مسجّلش ===== */}
        {!done ? (
          <>
            <div className="card-title" style={{ marginTop: 2 }}>
              <span>هتنزل في أنهي مواقع النهاردة؟</span>
              <span className="small muted">تقدر تزوّد بعد كده</span>
            </div>
            <div className="flex wrap" style={{ gap: 8 }}>
              {sites.map((s) => {
                const on = picked.includes(s.id);
                return (
                  <button
                    key={s.id}
                    className={`btn btn-sm ${on ? "btn-primary" : ""}`}
                    onClick={() =>
                      setPicked((p) =>
                        on ? p.filter((x) => x !== s.id) : [...p, s.id]
                      )
                    }
                  >
                    {on ? "✓ " : ""}
                    {s.name}
                  </button>
                );
              })}
              {sites.length === 0 && (
                <span className="muted small">مفيش مواقع مضافة لسه</span>
              )}
            </div>

            <div className="mt">
              <button
                className="btn-hero primary"
                onClick={register}
                disabled={busy}
              >
                <span>⬇️ نزلت النهاردة</span>
                <small>
                  {picked.length > 0 ? `في ${picked.length} موقع` : "ضغطة واحدة وخلاص"}
                </small>
              </button>
            </div>
          </>
        ) : (
          /* ===== نازل خلاص ===== */
          <>
            <div className="card-title" style={{ marginTop: 2 }}>
              <span>المواقع اللي سجّلتها النهاردة</span>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => setShowSite(true)}
              >
                + موقع
              </button>
            </div>

            <div className="flex wrap" style={{ gap: 8 }}>
              {todaySites.length === 0 ? (
                <span className="muted small">مفيش مواقع متسجّلة</span>
              ) : (
                todaySites.map((id) => (
                  <span key={id} className="site-pill">
                    📍 {sites.find((s) => s.id === id)?.name ?? "موقع"}
                  </span>
                ))
              )}
            </div>

            <div className="mt">
              <button
                className="btn-hero money"
                onClick={() => setShowMoney(true)}
              >
                <span>💵 خدت فلوس</span>
                <small>كل مرة تاخد فيها فلوس اضغط هنا</small>
              </button>
            </div>

            {bal?.withdrawn_pending ? (
              <div className="alert info mt">
                عندك {money(bal.withdrawn_pending)} مستنية موافقة المالك
              </div>
            ) : null}
          </>
        )}
      </div>

      {showMoney && (
        <MoneyModal
          workerId={profile!.id}
          balance={bal}
          onClose={() => setShowMoney(false)}
          onDone={() => {
            ctx?.reload?.();
            setMsg({ type: "success", text: "اتسجّل ✅" });
          }}
        />
      )}

      {showSite && today && (
        <SiteAddModal
          attendanceId={today.id}
          sites={sites}
          existing={todaySites}
          onClose={() => setShowSite(false)}
          onDone={() => {
            loadToday();
            setMsg({ type: "success", text: "تم إضافة الموقع ✅" });
          }}
        />
      )}
    </>
  );
}
