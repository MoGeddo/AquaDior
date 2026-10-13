import { lazy, Suspense, useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useAuth } from "./store/auth";
import SplashScreen from "./components/SplashScreen";
import { DialogProvider, useDialog } from "./components/DialogProvider";
import { clearBlockedQueue, queueSummary } from "./lib/db";
import { startSyncLoop } from "./lib/sync";
import { DEMO_MODE, SUPABASE_CONFIGURED } from "./lib/supabase";
import { syncExternalPushIdentity } from "./lib/push";
import AppIcon from "./components/AppIcon";

const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const PendingApproval = lazy(() => import("./pages/PendingApproval"));
const WorkerLayout = lazy(() => import("./pages/worker/WorkerLayout"));
const WorkerHome = lazy(() => import("./pages/worker/WorkerHome"));
const TakeMoney = lazy(() => import("./pages/worker/TakeMoney"));
const MyStatement = lazy(() => import("./pages/worker/MyStatement"));

const AdminLayout = lazy(() => import("./pages/admin/AdminLayout"));
const Dashboard = lazy(() => import("./pages/admin/Dashboard"));
const Developer = lazy(() => import("./pages/admin/Developer"));
const Registrations = lazy(() => import("./pages/admin/Registrations"));
const Workers = lazy(() => import("./pages/admin/Workers"));
const Projects = lazy(() => import("./pages/admin/Projects"));
const Attendance = lazy(() => import("./pages/admin/Attendance"));
const Withdrawals = lazy(() => import("./pages/admin/Withdrawals"));
const Deductions = lazy(() => import("./pages/admin/Deductions"));
const Settlements = lazy(() => import("./pages/admin/Settlements"));
const AuditLog = lazy(() => import("./pages/admin/AuditLog"));
const SettingsPage = lazy(() => import("./pages/admin/SettingsPage"));

function OfflineBanner() {
  const { profile } = useAuth();
  const { confirm } = useDialog();
  const [online, setOnline] = useState(navigator.onLine);
  const [queue, setQueue] = useState<{ pending: number; blocked: number; lastError: string | null }>({
    pending: 0,
    blocked: 0,
    lastError: null,
  });

  useEffect(() => {
    const profileId = profile?.id;
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    const refreshQueue = async () => {
      if (!profileId) {
        setQueue({ pending: 0, blocked: 0, lastError: null });
        return;
      }
      try {
        setQueue(await queueSummary(profileId));
      } catch {
        // The local queue can be temporarily unavailable (e.g. storage pressure).
      }
    };
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    window.addEventListener("queue-flushed", refreshQueue);
    window.addEventListener("queue-updated", refreshQueue);
    void refreshQueue();
    const timer = window.setInterval(() => void refreshQueue(), 5000);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      window.removeEventListener("queue-flushed", refreshQueue);
      window.removeEventListener("queue-updated", refreshQueue);
      window.clearInterval(timer);
    };
  }, [profile?.id]);

  async function clearRejectedOperations() {
    if (!profile) return;
    const accepted = await confirm({
      title: "مسح العمليات المرفوضة؟",
      message: "العمليات المعروضة رفضها الخادم ولم تُقبل. سيتم حذفها من طابور هذا الجهاز فقط؛ لن تتغير البيانات المسجلة على الخادم.",
      confirmText: "مسح من هذا الجهاز",
      cancelText: "إبقاء العمليات",
      tone: "danger",
    });
    if (!accepted) return;
    await clearBlockedQueue(profile.id);
    setQueue(await queueSummary(profile.id));
  }

  if (online && queue.pending === 0) return null;
  return (
    <div className="offline-banner" role="status">
      <div className="offline-banner-main">
        <AppIcon name={online ? "rotateCcw" : "wifiOff"} size={18} />
        <span>
          {!online
            ? `مفيش نت — ${queue.pending} عملية محفوظة على الجهاز وتنتظر المزامنة`
            : `جاري رفع ${queue.pending} عملية...`}
        </span>
      </div>
      {queue.blocked > 0 && (
        <div className="small offline-banner-warning">
          <span className="icon-label">
            <AppIcon name="shieldAlert" size={16} />
            <span>رُفضت {queue.blocked} عملية وتوقفت إعادة المحاولة.</span>
          </span>
          {queue.lastError && <div dir="auto">آخر سبب: {queue.lastError}</div>}
          <button className="btn btn-sm mt" onClick={clearRejectedOperations}>
            <AppIcon name="trash2" size={17} />
            حذف العمليات المرفوضة من هذا الجهاز
          </button>
        </div>
      )}
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
  if (profile.status === "rejected" || profile.status === "suspended") {
    return <Navigate to="/rejected" replace />;
  }
  if (profile.status !== "active" || !profile.is_active) {
    return <Navigate to="/rejected" replace />;
  }
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
        <AppIcon name="shieldAlert" size={48} className="rejected-route-icon" />
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
  const { init, ready, profile } = useAuth();
  // Show the brand intro on every fresh app launch (never in the smoke/demo harness).
  const [showSplash, setShowSplash] = useState(() => !DEMO_MODE);
  const [splashLeaving, setSplashLeaving] = useState(false);

  useEffect(() => {
    void init();
    if (DEMO_MODE || SUPABASE_CONFIGURED) return startSyncLoop();
    return undefined;
  }, [init]);

  useEffect(() => {
    if (!ready) return;
    void syncExternalPushIdentity(profile?.id ?? null);
  }, [ready, profile?.id]);

  useEffect(() => {
    if (!showSplash) return;
    const beginFade = window.setTimeout(() => setSplashLeaving(true), 2000);
    const finish = window.setTimeout(() => setShowSplash(false), 2480);
    return () => {
      window.clearTimeout(beginFade);
      window.clearTimeout(finish);
    };
  }, [showSplash]);

  if (!DEMO_MODE && !SUPABASE_CONFIGURED) {
    return (
      <div className="auth" role="alert">
        <div className="login-card center">
          <h1>التطبيق غير مهيّأ</h1>
          <p className="muted">
            قاعدة البيانات غير مربوطة. اضبط VITE_SUPABASE_URL و
            VITE_SUPABASE_ANON_KEY في إعدادات النشر. لا تدخل بيانات حقيقية في وضع تجريبي.
          </p>
        </div>
      </div>
    );
  }

  return (
    <DialogProvider>
      <BrowserRouter>
        <div className="app-shell">
          {DEMO_MODE && (
            <div className="offline-banner demo-mode-banner" role="status">
              <AppIcon name="shieldAlert" size={18} />
              <span>وضع Demo — بيانات وهمية محفوظة محليًا، ولا تمثل أي حسابات أو أرصدة حقيقية.</span>
            </div>
          )}
          <OfflineBanner />
          <Suspense fallback={<div className="empty" role="status">جاري تحميل الشاشة...</div>}>
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
                <Route
                  path="developer"
                  element={
                    <Guard roles={["developer"]}>
                      <Developer />
                    </Guard>
                  }
                />
                <Route path="sites" element={<Navigate to="/admin/projects" replace />} />
                <Route path="projects" element={<Projects />} />
                <Route path="attendance" element={<Attendance />} />
                <Route path="withdrawals" element={<Withdrawals />} />
                <Route path="deductions" element={<Deductions />} />
                <Route path="settlements" element={<Settlements />} />
                <Route path="audit" element={<AuditLog />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>

              <Route path="/" element={ready ? <RoleHome /> : <div className="empty">...</div>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
          {showSplash && <SplashScreen leaving={splashLeaving} />}
        </div>
      </BrowserRouter>
    </DialogProvider>
  );
}
