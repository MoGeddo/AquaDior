import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "../../store/auth";
import { supabase } from "../../lib/supabase";
import { AquaDiorShield } from "../../components/AquaDiorLogo";

const LINKS = [
  { to: "/admin", label: "📊 الداشبورد", end: true },
  { to: "/admin/registrations", label: "🔔 طلبات التسجيل" },
  { to: "/admin/attendance", label: "📅 الحضور" },
  { to: "/admin/workers", label: "👷 العمال" },
  { to: "/admin/projects", label: "🏗️ المشاريع/المواقع" },
  { to: "/admin/withdrawals", label: "💵 الفلوس" },
  { to: "/admin/deductions", label: "📉 الخصومات" },
  { to: "/admin/settlements", label: "🧾 التسويات" },
  { to: "/admin/audit", label: "🛡️ سجل التعديلات" },
  { to: "/admin/settings", label: "⚙️ الإعدادات" },
  { to: "/admin/developer", label: "🛠️ المطوّر" },
];

export default function AdminLayout() {
  const { profile, signOut } = useAuth();
  const nav = useNavigate();
  const [pending, setPending] = useState(0);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!profile) return;
    const load = async () => {
      const [{ count: p }, { count: n }] = await Promise.all([
        supabase
          .from("profiles")
          .select("*", { count: "exact", head: true })
          .eq("status", "pending"),
        supabase
          .from("notifications")
          .select("*", { count: "exact", head: true })
          .eq("user_id", profile.id)
          .eq("is_read", false),
      ]);
      setPending(p ?? 0);
      setUnread(n ?? 0);
    };
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [profile]);

  return (
    <>
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <AquaDiorShield size={36} />
          <div>
            <h1>أكوا ديور للمقاولات</h1>
            <div className="sub">{profile?.full_name} • لوحة الإدارة</div>
          </div>
        </div>
        <div className="flex" style={{ gap: 8 }}>
          {unread > 0 && (
            <NavLink to="/admin/audit" className="badge red">
              🔔 {unread}
            </NavLink>
          )}
          <span className="role-chip">
            {profile?.role === "owner"
              ? "👑 مالك"
              : profile?.role === "developer"
              ? "🛠️ مطوّر"
              : "🧑‍💼 مدير"}
          </span>
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

      <nav className="admin-nav">
        {LINKS.filter((l) => l.to !== "/admin/developer" || profile?.role === "developer").map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end}>
            {l.label}
            {l.to === "/admin/registrations" && pending > 0 && (
              <span className="badge red" style={{ marginInlineStart: 6 }}>
                {pending}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="page page-wide">
        <Outlet />
      </div>
    </>
  );
}
