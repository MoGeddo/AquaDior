import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../store/auth";
import { money } from "../../lib/calc";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import type { WorkerBalance } from "../../lib/types";
import { AquaDiorShield } from "../../components/AquaDiorLogo";

export default function WorkerLayout() {
  const { profile, signOut } = useAuth();
  const nav = useNavigate();
  const [bal, setBal] = useState<WorkerBalance | null>(null);

  async function load() {
    if (!profile) return;
    const { data } = await supabase
      .from("worker_balances")
      .select("*")
      .eq("worker_id", profile.id)
      .single();
    if (data) setBal(data as WorkerBalance);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [profile]);

  return (
    <>
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <AquaDiorShield size={34} />
          <div>
            <h1>أهلاً {profile?.full_name?.split(" ")[0]} 👋</h1>
            <div className="sub">
              رصيدك: <b style={{ color: "var(--gold-300)" }}>{money(bal?.balance ?? 0)}</b>
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
        <Outlet context={{ bal, reload: load }} />
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
