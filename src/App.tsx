import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useAuth } from "./store/auth";
import { pendingCount } from "./lib/db";
import { startSyncLoop } from "./lib/sync";

import Login from "./pages/Login";
import Register from "./pages/Register";
import PendingApproval from "./pages/PendingApproval";
import WorkerLayout from "./pages/worker/WorkerLayout";
import WorkerHome from "./pages/worker/WorkerHome";
import TakeMoney from "./pages/worker/TakeMoney";
import MyStatement from "./pages/worker/MyStatement";

import AdminLayout from "./pages/admin/AdminLayout";
import Dashboard from "./pages/admin/Dashboard";
import Developer from "./pages/admin/Developer";
import Registrations from "./pages/admin/Registrations";
import Workers from "./pages/admin/Workers";
import Sites from "./pages/admin/Sites";
import Projects from "./pages/admin/Projects";
import Attendance from "./pages/admin/Attendance";
import Withdrawals from "./pages/admin/Withdrawals";
import Settlements from "./pages/admin/Settlements";
import AuditLog from "./pages/admin/AuditLog";
import SettingsPage from "./pages/admin/SettingsPage";

function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine);
  const [queue, setQueue] = useState(0);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    const q = async () => setQueue(await pendingCount());
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    window.addEventListener("queue-flushed", q);
    q();
    const t = setInterval(q, 5000);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      clearInterval(t);
    };
  }, []);

  if (online && queue === 0) return null;
  return (
    <div className="offline-banner">
      {!online
        ? `📵 مفيش نت — ${queue} عملية هتتسجّل أول ما النت يرجع`
        : `⏳ جاري رفع ${queue} عملية...`}
    </div>
  );
}

function Guard({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { profile, ready } = useAuth();
  const loc = useLocation();

  if (!ready) return <div className="empty">جاري التحميل...</div>;
  if (!profile) return <Navigate to="/login" state={{ from: loc }} replace />;
  if (roles && !roles.includes(profile.role)) return <Navigate to="/" replace />;
  // حساب مستني تفعيل → ما يدخلش
  if (profile.status === "pending") return <Navigate to="/pending" replace />;
  if (profile.status === "rejected") return <Navigate to="/rejected" replace />;
  if (!profile.is_active) return <Navigate to="/rejected" replace />;
  return <>{children}</>;
}

function RoleHome() {
  const { profile } = useAuth();
  if (!profile) return <Navigate to="/login" replace />;
  if (profile.role === "worker") return <Navigate to="/worker" replace />;
  return <Navigate to="/admin" replace />;
}

function PendingRoute() {
  const { profile, ready } = useAuth();
  if (!ready) return <div className="empty">...</div>;
  if (!profile) return <Navigate to="/login" replace />;
  if (profile.status !== "pending") {
    return <Navigate to={profile.role === "worker" ? "/worker" : "/admin"} replace />;
  }
  return <PendingApproval />;
}

function RejectedRoute() {
  const { profile } = useAuth();
  const nav = useNavigate();
  return (
    <div className="auth">
      <div className="login-card center">
        <div style={{ fontSize: 52 }}>🚫</div>
        <h1 style={{ fontSize: 20, margin: "10px 0" }}>حسابك مش مفعّل</h1>
        <p className="muted">
          {profile?.reject_reason ?? "تواصل مع المالك عشان تفعيل حسابك"}
        </p>
        <button
          className="btn btn-block mt"
          onClick={async () => {
            await useAuth.getState().signOut();
            nav("/login", { replace: true });
          }}
        >
          خروج
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const { init, ready } = useAuth();

  useEffect(() => {
    init();
    startSyncLoop();
  }, []);

  return (
    <BrowserRouter>
      <div className="app-shell">
        <OfflineBanner />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/pending" element={<PendingRoute />} />
          <Route path="/rejected" element={<RejectedRoute />} />

          <Route
            path="/worker"
            element={
              <Guard roles={["worker"]}>
                <WorkerLayout />
              </Guard>
            }
          >
            <Route index element={<WorkerHome />} />
            <Route path="take-money" element={<TakeMoney />} />
            <Route path="statement" element={<MyStatement />} />
          </Route>

          <Route
            path="/admin"
            element={
              <Guard roles={["owner", "manager", "developer"]}>
                <AdminLayout />
              </Guard>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="workers" element={<Workers />} />
            <Route path="registrations" element={<Registrations />} />
            <Route path="developer" element={<Developer />} />
            <Route path="sites" element={<Sites />} />
            <Route path="projects" element={<Projects />} />
            <Route path="attendance" element={<Attendance />} />
            <Route path="withdrawals" element={<Withdrawals />} />
            <Route path="settlements" element={<Settlements />} />
            <Route path="audit" element={<AuditLog />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          <Route path="/" element={ready ? <RoleHome /> : <div className="empty">...</div>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
