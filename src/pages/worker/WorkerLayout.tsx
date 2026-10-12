import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../store/auth";
import { money } from "../../lib/calc";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import type { WorkerBalance } from "../../lib/types";
import { AquaDiorShield } from "../../components/AquaDiorLogo";

type AssignedProject = { id: string; name: string; status: "active" | "closed"; address: string | null };
type WorkerOutletContext = {
  bal: WorkerBalance | null;
  reload: () => void;
  loading: boolean;
  loadError: string | null;
  projects: AssignedProject[];
  hasAssignedProjects: boolean;
};

export default function WorkerLayout() {
  const { profile, signOut } = useAuth();
  const nav = useNavigate();
  const [bal, setBal] = useState<WorkerBalance | null>(null);
  const [projects, setProjects] = useState<AssignedProject[]>([]);
  const [hasAssignedProjects, setHasAssignedProjects] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const [
        { data: balance, error: balanceError },
        { data: assignments, error: assignmentError },
      ] = await Promise.all([
        supabase
          .from("worker_balances")
          .select("*")
          .eq("worker_id", profile.id)
          .maybeSingle(),
        supabase
          .from("worker_projects")
          .select("project_id, project:projects(id, name, status, address)")
          .eq("worker_id", profile.id),
      ]);
      const queryError = balanceError ?? assignmentError;
      if (queryError) {
        setLoadError(queryError.message ?? "تعذر تحميل بيانات الحساب");
        return;
      }

      const rows = (assignments ?? []) as any[];
      const activeProjects: AssignedProject[] = rows
        .map((row) => row.project)
        .filter((project: any) => project?.status === "active")
        .map((project: any) => ({
          id: project.id,
          name: project.name,
          status: project.status,
          address: project.address ?? null,
        }));
      const allProjects: AssignedProject[] = rows
        .map((row) => row.project)
        .filter((project: any) => project)
        .map((project: any) => ({
          id: project.id,
          name: project.name,
          status: project.status,
          address: project.address ?? null,
        }));
      setBal((balance as WorkerBalance | null) ?? null);
      setProjects(activeProjects);
      setHasAssignedProjects(allProjects.length > 0);
      setLoadError(null);
    } catch (error: any) {
      setLoadError(error?.message ?? "تعذر تحميل بيانات الحساب");
    } finally {
      setLoading(false);
    }
  }, [profile]);

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
    hasAssignedProjects,
  };

  return (
    <>
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <AquaDiorShield size={34} />
          <div>
            <h1>أهلاً {profile?.full_name?.split(" ")[0]} 👋</h1>
            <div className="sub">
              رصيدك العام: <b style={{ color: "var(--gold-300)" }}>{money(bal?.balance ?? 0)}</b>
            </div>
          </div>
        </div>
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

      <div className="page has-bottom-nav">
        {loadError && (
          <div className="alert error" role="alert">
            تعذر تحميل الرصيد العام أو تعيينات المشاريع: {loadError}{" "}
            <button className="btn btn-sm" onClick={() => void load()}>إعادة المحاولة</button>
          </div>
        )}
        <Outlet context={outletContext} />
      </div>

      <nav className="bottom-nav">
        <NavLink to="/worker" end>
          <span className="ico">🏠</span>
          <span>الرئيسية</span>
        </NavLink>
        <NavLink to="/worker/take-money">
          <span className="ico">💵</span>
          <span>خدت فلوس</span>
        </NavLink>
        <NavLink to="/worker/statement">
          <span className="ico">📋</span>
          <span>كشفي</span>
        </NavLink>
      </nav>
    </>
  );
}

export type { AssignedProject, WorkerOutletContext };
