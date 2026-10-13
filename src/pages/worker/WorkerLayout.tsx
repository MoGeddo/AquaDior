import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../store/auth";
import { money } from "../../lib/calc";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import type { WorkerBalance } from "../../lib/types";
import { AquaDiorShield } from "../../components/AquaDiorLogo";
import NotificationCenter from "../../components/NotificationCenter";
import AppIcon from "../../components/AppIcon";

export type AvailableProject = { id: string; name: string; status: "active"; address: string | null };
type WorkerOutletContext = {
  bal: WorkerBalance | null;
  reload: () => void;
  loading: boolean;
  loadError: string | null;
  projects: AvailableProject[];
};

export default function WorkerLayout() {
  const { profile, signOut } = useAuth();
  const nav = useNavigate();
  const [bal, setBal] = useState<WorkerBalance | null>(null);
  const [projects, setProjects] = useState<AvailableProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const [
        { data: balance, error: balanceError },
        { data: activeProjects, error: projectError },
      ] = await Promise.all([
        supabase
          .from("worker_balances")
          .select("*")
          .eq("worker_id", profile.id)
          .maybeSingle(),
        supabase
          .from("projects")
          .select("id, name, status, address")
          .eq("status", "active")
          .order("name"),
      ]);
      const queryError = balanceError ?? projectError;
      if (queryError) {
        setLoadError(queryError.message ?? "تعذر تحميل بيانات الحساب والمشاريع المفتوحة");
        return;
      }

      setBal((balance as WorkerBalance | null) ?? null);
      setProjects((activeProjects ?? []) as AvailableProject[]);
      setLoadError(null);
    } catch (error: any) {
      setLoadError(error?.message ?? "تعذر تحميل بيانات الحساب");
    } finally {
      setLoading(false);
    }
  }, [profile]);

  const loadUnreadNotifications = useCallback(async () => {
    if (!profile) return;
    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .eq("is_read", false);
    if (!error) setUnreadNotifications(count ?? 0);
  }, [profile]);

  useEffect(() => {
    void loadUnreadNotifications();
    const timer = window.setInterval(() => void loadUnreadNotifications(), 15000);
    return () => window.clearInterval(timer);
  }, [loadUnreadNotifications]);

  const handleUnreadChange = useCallback((change: number | "refresh") => {
    if (change === "refresh") {
      void loadUnreadNotifications();
    } else {
      setUnreadNotifications((current) => Math.max(0, current + change));
    }
  }, [loadUnreadNotifications]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const outletContext: WorkerOutletContext = {
    bal,
    reload: load,
    loading,
    loadError,
    projects,
  };

  return (
    <>
      <div className="topbar">
        <div className="worker-topbar-heading" style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <AquaDiorShield size={34} />
          <div style={{ minWidth: 0 }}>
            <h1>أهلاً {profile?.full_name?.split(" ")[0]}</h1>
            <div className="sub">
              رصيدك العام: <b style={{ color: "var(--gold-300)" }}>{money(bal?.balance ?? 0)}</b>
            </div>
          </div>
        </div>
        <div className="worker-topbar-actions">
          <button
            className="btn btn-sm btn-ghost worker-notification-trigger"
            aria-label={unreadNotifications ? `الإشعارات، ${unreadNotifications} غير مقروء` : "الإشعارات"}
            title="الإشعارات"
            onClick={() => setShowNotifications(true)}
          >
            <AppIcon name="bell" size={20} />
            {unreadNotifications > 0 && <span className="badge red notification-count">{unreadNotifications > 99 ? "99+" : unreadNotifications}</span>}
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={async () => {
              await signOut();
              nav("/login", { replace: true });
            }}
          >
            خروج
          </button>
        </div>
      </div>

      <div className="page has-bottom-nav">
        {loadError && (
          <div className="alert error" role="alert">
            تعذر تحميل الرصيد العام أو المشاريع المفتوحة: {loadError}{" "}
            <button className="btn btn-sm" onClick={() => void load()}>إعادة المحاولة</button>
          </div>
        )}
        <Outlet context={outletContext} />
      </div>

      <nav className="bottom-nav" aria-label="تنقل العامل">
        <NavLink to="/worker" end>
          <span className="ico"><AppIcon name="home" size={21} /></span>
          <span>الرئيسية</span>
        </NavLink>
        <NavLink to="/worker/take-money">
          <span className="ico"><AppIcon name="banknote" size={21} /></span>
          <span>خدت فلوس</span>
        </NavLink>
        <NavLink to="/worker/statement">
          <span className="ico"><AppIcon name="clipboardList" size={21} /></span>
          <span>كشفي</span>
        </NavLink>
      </nav>
      {showNotifications && profile && (
        <NotificationCenter
          userId={profile.id}
          unreadCount={unreadNotifications}
          onClose={() => setShowNotifications(false)}
          onUnreadChange={handleUnreadChange}
        />
      )}
    </>
  );
}

export type { WorkerOutletContext };
