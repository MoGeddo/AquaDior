/**
 * وضع Demo محلي فقط، لا يتصل بـSupabase.
 * يبدأ بحسابات الإدارة الثلاثة فقط ولا يحمّل أي عمال أو مشاريع أو حركات وهمية.
 * التفعيل يحتاج VITE_DEMO_MODE=1 صراحةً؛ لا تستخدمه لتشغيل بيانات حقيقية.
 */

const uid = () => Math.random().toString(36).slice(2, 10);

export const demoDB: any = {
  // حسابات تعريفية محلية للاختبار فقط؛ لا توجد أرقام اتصال أو سجلات تشغيل وهمية.
  profiles: [
    {
      id: "demo-owner",
      full_name: "عابدين يونس",
      username: "abden.younes",
      role: "owner",
      daily_wage: 0,
      is_active: true,
      status: "active",
    },
    {
      id: "demo-owner-2",
      full_name: "محمود عبدين",
      username: "mahmoud.abdin",
      role: "owner",
      daily_wage: 0,
      is_active: true,
      status: "active",
    },
    {
      id: "demo-developer",
      full_name: "مصطفى جدو",
      username: "mostafageddo",
      role: "developer",
      daily_wage: 0,
      is_active: true,
      status: "active",
    },
  ],
  projects: [] as any[],
  sites: [] as any[],
  worker_projects: [] as any[],
  site_workers: [] as any[],
  attendance: [] as any[],
  attendance_projects: [] as any[],
  withdrawals: [] as any[],
  deductions: [] as any[],
  settlements: [] as any[],
  notifications: [] as any[],
  audit_log: [] as any[],
  settings: [
    { key: "app", value: { gps_enabled: false, currency: "ج.م" }, updated_at: new Date().toISOString() },
    { key: "telegram", value: {}, updated_at: new Date().toISOString() },
  ],
};

// Fixtures exist only in the isolated jsdom smoke build, never in Demo/dev or production.
if (import.meta.env.VITE_SMOKE_TEST === "1") {
  demoDB.profiles.push({
    id: "smoke-worker-1",
    full_name: "عامل اختبار آلي",
    phone: "01000009999",
    username: "worker01",
    role: "worker",
    daily_wage: 350,
    is_active: true,
    status: "active",
  });
  demoDB.projects.push(
    {
      id: "smoke-project-1",
      name: "مشروع اختبار آلي",
      status: "active",
      address: "",
      start_date: new Date().toISOString().slice(0, 10),
    },
    {
      id: "smoke-project-2",
      name: "موقع اختبار آلي ثانٍ",
      status: "active",
      address: "",
      start_date: new Date().toISOString().slice(0, 10),
    }
  );
  demoDB.worker_projects.push(
    {
      id: "smoke-assignment-1",
      worker_id: "smoke-worker-1",
      project_id: "smoke-project-1",
      daily_wage: 350,
      joined_at: new Date().toISOString(),
    },
    {
      id: "smoke-assignment-2",
      worker_id: "smoke-worker-1",
      project_id: "smoke-project-2",
      daily_wage: 350,
      joined_at: new Date().toISOString(),
    }
  );
}

// ============ VIEWS ============
export function workerBalances(): any[] {
  return demoDB.profiles
    .filter((p: any) => p.role === "worker")
    .map((p: any) => {
      const att = demoDB.attendance.filter((a: any) => a && a.worker_id === p.id);
      const earned = att.reduce(
        (sum: number, record: any) => sum + Number(record.daily_wage_snapshot ?? p.daily_wage ?? 0),
        0
      );
      const wd = demoDB.withdrawals.filter((w: any) => w.worker_id === p.id);
      const approved = wd.filter((w: any) => w.status === "approved").reduce((s: number, w: any) => s + w.amount, 0);
      const pending = wd.filter((w: any) => w.status === "pending").reduce((s: number, w: any) => s + w.amount, 0);
      const deducted = demoDB.deductions.filter((d: any) => d.worker_id === p.id).reduce((s: number, d: any) => s + d.amount, 0);
      return {
        worker_id: p.id,
        full_name: p.full_name,
        phone: p.phone,
        role: p.role,
        daily_wage: p.daily_wage,
        is_active: p.is_active,
        days_worked: att.length,
        earned,
        withdrawn_approved: approved,
        withdrawn_pending: pending,
        deducted,
        balance: earned - approved - deducted,
        available: earned - approved - pending - deducted,
      };
    });
}

// ============ QUERY BUILDER ============
function rows(table: string): any[] {
  if (table === "worker_balances") return workerBalances();
  if (table === "daily_summary") return [];
  if (table === "project_archive") {
    return demoDB.projects
      .filter((p: any) => p.status === "closed")
      .map((p: any) => ({
        project_id: p.id,
        project_name: p.name,
        start_date: p.start_date,
        closed_at: p.closed_at,
        archived_at: p.closed_at,
        workers_count: new Set([
          ...demoDB.worker_projects.filter((w: any) => w.project_id === p.id).map((w: any) => w.worker_id),
          ...demoDB.attendance_projects
            .filter((link: any) => link.project_id === p.id)
            .map((link: any) => demoDB.attendance.find((a: any) => a.id === link.attendance_id)?.worker_id)
            .filter(Boolean),
        ]).size,
        attendance_count: new Set(demoDB.attendance_projects
          .filter((link: any) => link.project_id === p.id)
          .map((link: any) => link.attendance_id)).size,
      }));
  }
  if (table === "admin_users") {
    return demoDB.profiles.map((p: any) => ({
      ...p,
      days_worked: demoDB.attendance.filter((a: any) => a && a.worker_id === p.id).length,
      withdrawn: demoDB.withdrawals
        .filter((w: any) => w.worker_id === p.id)
        .reduce((s: number, w: any) => s + w.amount, 0),
      edits_made: 0,
    }));
  }
  return demoDB[table] ?? [];
}

function matchRow(r: any, filters: [string, any][]): boolean {
  return filters.every(([k, v]) => {
    const rv = r[k];
    if (v !== null && typeof v === "object") {
      if ("$ne" in v) return rv !== v.$ne;
      if ("$is" in v) return rv === v.$is;
      if ("$in" in v) return v.$in.includes(rv);
      if ("$gte" in v) return rv >= v.$gte;
      if ("$lte" in v) return rv <= v.$lte;
      return false;
    }
    return rv === v;
  });
}

function sortRows(rs: any[], key: string, dir: "asc" | "desc"): any[] {
  const out = [...rs];
  out.sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === bv) return 0;
    const c = av > bv ? 1 : -1;
    return dir === "desc" ? -c : c;
  });
  return out;
}

/**
 * دعم العلاقات المتداخلة في الاستعلامات (embedded selects) — زي Supabase بالحرف.
 * أمثلة: select("*, worker:profiles!withdrawals_worker_id_fkey(full_name)")
 *        select("project_id, projects(status)")
 * من غير الدعم ده، r.projects و r.worker بيطلعوا undefined وتبوظ شاشات
 * (زي شاشة العامل اللي كانت بتقول "مشروعك اتقفل" غلط).
 */
const NESTED_TABLES: Record<string, () => any[]> = {
  profiles: () => demoDB.profiles,
  projects: () => demoDB.projects,
  attendance: () => demoDB.attendance.filter(Boolean),
  attendance_projects: () => demoDB.attendance_projects,
  withdrawals: () => demoDB.withdrawals,
  deductions: () => demoDB.deductions,
};

/** يقسّم على الفواصل اللي بره الأقواس */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** يدوّر على عمود الربط (foreign key) المناسب للصف */
function findFkColumn(row: any, relName: string, hint?: string): string | null {
  const candidates: string[] = [];
  // التلميح اللي جاي من Supabase: withdrawals_worker_id_fkey
  const m = hint?.match(/^[\w]+_([\w]+)_fkey$/);
  if (m) candidates.push(m[1]);
  if (hint) candidates.push(hint);
  const singular = relName.replace(/ies$/, "y").replace(/s$/, "");
  candidates.push(`${relName}_id`, `${singular}_id`);
  if (/^(worker|profile|profiles)$/i.test(relName)) {
    candidates.push("worker_id", "profile_id", "created_by", "user_id");
  }
  candidates.push(relName, singular);
  for (const c of candidates) if (c && c in row) return c;
  return null;
}

function pickColumns(obj: any, cols: string | null): any {
  if (!cols || cols.trim() === "*") return obj;
  const out: any = {};
  for (const w of splitTopLevel(cols)) {
    const name = w.includes(":") ? w.split(":")[0].trim() : w;
    if (name in obj) out[name] = obj[name];
  }
  return out;
}

function expandRelations(row: any, sel: string): any {
  const out = { ...row };
  for (const part of splitTopLevel(sel)) {
    const m = part.match(/^(?:([\w.]+):)?([\w]+)(?:!([\w]+))?\(([^)]*)\)$/);
    if (!m) continue; // عمود عادي أو *
    const alias = (m[1] || m[2]).split(".").pop() as string;
    const target = m[2].split(".").pop() as string;
    const hint = m[3];
    const inner = m[4];
    const source = NESTED_TABLES[target];
    if (!source) continue;
    const fk = findFkColumn(row, alias, hint);
    if (!fk) continue;
    const match = source().find((x: any) => x && x.id === row[fk]) ?? null;
    out[alias] = match ? pickColumns(match, inner) : null;
  }
  return out;
}

function build(table: string) {
  const state: {
    filters: [string, any][];
    order: [string, "asc" | "desc"] | null;
    limit: number | null;
    select: string | null;
  } = {
    filters: [],
    order: null,
    limit: null,
    select: null,
  };

  /** الصفوف الأصلية (من غير نسخ/ترتيب/توسيع) — للعمليات اللي بتعدّل الداتا */
  const matched = () => {
    let rs = rows(table).filter((r) => matchRow(r, state.filters));
    if (state.limit) rs = rs.slice(0, state.limit);
    return rs;
  };

  const result = () => {
    let rs = rows(table).filter((r) => matchRow(r, state.filters));
    if (state.order) rs = sortRows(rs, state.order[0], state.order[1]);
    if (state.limit) rs = rs.slice(0, state.limit);
    if (state.select) rs = rs.map((r) => expandRelations(r, state.select as string));
    return rs;
  };

  /**
   * العمليات اللي بتغيّر الداتا (insert/update/delete/upsert) بتتنفّذ **متأخرة**،
   * يعني بعد ما كل الفلاتر تتحدد — بالظبط زي Supabase الحقيقي.
   * من غير كده update().eq() كان هينفّذ التعديل على الجدول كله قبل ما يشوف الفلتر.
   */
  let pending: null | (() => { data: any; error: any }) = null;

  function exec() {
    if (pending) {
      const run = pending;
      pending = null;
      return run();
    }
    const rs = result();
    return { data: rs, error: null, count: rs.length };
  }

  /** شبكة أمان: لو الكود ما استناش النتيجة، ننفّذ العملية في الميكروتاسك الجاي */
  function scheduleFlush() {
    queueMicrotask(() => {
      if (pending) exec();
    });
  }

  const q: any = {
    select: (cols?: string) => {
      state.select = cols ?? "*";
      return q;
    },
    insert: (payload: any) => {
      const arr = Array.isArray(payload) ? payload : [payload];
      const many = Array.isArray(payload);
      pending = () => {
        const created = arr.map((p) => ({ id: uid(), created_at: new Date().toISOString(), ...p }));
        demoDB[table] = [...rows(table), ...created];
        return { data: many ? created : created[0], error: null };
      };
      scheduleFlush();
      return q;
    },
    update: (payload: any) => {
      pending = () => {
        // ⚠️ نعدّل الصفوف الأصلية نفسها (مش نسخ العرض)
        const rs = matched();
        rs.forEach((r) => Object.assign(r, payload));
        return { data: rs, error: null };
      };
      scheduleFlush();
      return q;
    },
    delete: () => {
      pending = () => {
        const rs = matched();
        const ids = new Set(rs.map((r) => r.id));
        demoDB[table] = rows(table).filter((r: any) => !ids.has(r.id));
        return { data: rs, error: null };
      };
      scheduleFlush();
      return q;
    },
    upsert: (payload: any) => {
      const arr = Array.isArray(payload) ? payload : [payload];
      pending = () => {
        arr.forEach((p) => {
          const existing = rows(table).find((r) => r.id === p.id || (p.key != null && r.key === p.key));
          if (existing) Object.assign(existing, p);
          else demoDB[table] = [...rows(table), { id: uid(), ...p }];
        });
        return { data: arr, error: null };
      };
      scheduleFlush();
      return q;
    },
    eq: (k: string, v: any) => {
      state.filters.push([k, v]);
      return q;
    },
    neq: (k: string, v: any) => {
      state.filters.push([k, { $ne: v }]);
      return q;
    },
    is: (k: string, v: any) => {
      state.filters.push([k, { $is: v }]);
      return q;
    },
    in: (k: string, vs: any[]) => {
      state.filters.push([k, { $in: vs }]);
      return q;
    },
    gte: (k: string, v: any) => {
      state.filters.push([k, { $gte: v }]);
      return q;
    },
    lte: (k: string, v: any) => {
      state.filters.push([k, { $lte: v }]);
      return q;
    },
    order: (k: string, o: any) => {
      state.order = [k, o?.ascending === false ? "desc" : "asc"];
      return q;
    },
    limit: (n: number) => {
      state.limit = n;
      return q;
    },
    single: async () => {
      const rs = exec().data as any[];
      return { data: rs[0] ?? null, error: rs.length ? null : { message: "no rows" } };
    },
    maybeSingle: async () => {
      const rs = exec().data as any[];
      return { data: rs[0] ?? null, error: null };
    },
    then: (onFulfilled?: any, onRejected?: any) =>
      Promise.resolve().then(() => exec()).then(onFulfilled, onRejected),
  };
  return q;
}

// ============ AUTH MOCK ============
let currentUser: any = null;
export const DEMO_PASSWORD = "demo-only-pass";

const authMock = {
  getSession: async () => ({
    data: { session: currentUser ? { user: currentUser } : null },
    error: null,
  }),
  getUser: async () => ({
    data: { user: currentUser ?? null },
    error: currentUser ? null : { message: "not logged in" },
  }),
  signInWithPassword: async ({ email, password }: any) => {
    if (password !== DEMO_PASSWORD) {
      return { data: {}, error: { message: "Invalid login credentials" } };
    }
    const local = ((email ?? "").split("@")[0] || "").toLowerCase();
    const p = demoDB.profiles.find(
      (x: any) =>
        (x.username && x.username.toLowerCase() === local) ||
        (x.email && x.email.toLowerCase() === local) ||
        (x.phone && x.phone === local)
    );
    if (!p) return { data: {}, error: { message: "invalid" } };
    currentUser = { id: p.id, email };
    fireAuth("SIGNED_IN");
    return { data: { user: currentUser }, error: null };
  },
  signUp: async ({ email, options }: any) => {
    const local = (email ?? "").split("@")[0];
    const meta = options?.data ?? {};
    if (demoDB.profiles.some((x: any) => x.phone === meta.phone)) {
      return { data: {}, error: { message: "الرقم ده مسجّل قبل كده" } };
    }
    if (demoDB.profiles.some((x: any) => x.username === local)) {
      return { data: {}, error: { message: "اسم المستخدم ده محجوز" } };
    }
    const id = uid();
    const p = {
      id,
      full_name: meta.full_name ?? "عامل جديد",
      phone: meta.phone,
      username: local,
      role: "worker",
      daily_wage: 0,
      is_active: true,
      status: "pending",
      id_card_url: null,
      created_at: new Date().toISOString(),
    };
    demoDB.profiles.push(p);
    demoDB.notifications.unshift({
      id: uid(),
      user_id: "demo-owner",
      type: "registration_new",
      title: "طلب تسجيل جديد",
      body: `${p.full_name} سجّل بياناته — مستني موافقتك`,
      data: {},
      is_read: false,
      created_at: new Date().toISOString(),
    });
    currentUser = { id, email };
    fireAuth("SIGNED_IN");
    return { data: { user: currentUser, session: { user: currentUser } }, error: null };
  },
  signOut: async () => {
    currentUser = null;
    fireAuth("SIGNED_OUT");
    return { error: null };
  },
  onAuthStateChange: (cb: any) => {
    listeners.push(cb);
    return { data: { subscription: { unsubscribe: () => {} } } };
  },
};

let listeners: any[] = [];
function fireAuth(event: string) {
  listeners.forEach((cb) => cb(event, currentUser ? { user: currentUser } : null));
}

// ============ RPC MOCK ============
const rpcMock = async (fn: string, args: any) => {
  const now = () => new Date().toISOString();
  const activeProjects = () => demoDB.projects.filter((project: any) => project.status === "active");
  const activeAssignments = (workerId: string) => demoDB.worker_projects.filter((assignment: any) =>
    assignment.worker_id === workerId && activeProjects().some((project: any) => project.id === assignment.project_id)
  );
  const linkProjects = (attendanceId: string, projectIds: string[]) => {
    for (const projectId of new Set(projectIds)) {
      if (!demoDB.attendance_projects.some((link: any) =>
        link.attendance_id === attendanceId && link.project_id === projectId
      )) {
        demoDB.attendance_projects.push({ attendance_id: attendanceId, project_id: projectId, created_at: now() });
      }
    }
  };

  if (fn === "health_check") return { data: "ok", error: null };
  if (fn === "worker_app_config") {
    return { data: { gps_enabled: demoDB.settings[0]?.value?.gps_enabled === true }, error: null };
  }
  if (fn === "system_stats") {
    return { data: {
      workers: demoDB.profiles.filter((profile: any) => profile.role === "worker").length,
      admins: demoDB.profiles.filter((profile: any) => profile.role !== "worker").length,
      pending: demoDB.profiles.filter((profile: any) => profile.status === "pending").length,
      attendance: demoDB.attendance.length,
      withdrawals: demoDB.withdrawals.length,
      deductions: demoDB.deductions.length,
      audit: demoDB.audit_log.length,
      notifications: demoDB.notifications.length,
      settlements: demoDB.settlements.length,
    }, error: null };
  }

  if (fn === "developer_delete_worker") {
    const developer = demoDB.profiles.find((profile: any) =>
      profile.id === currentUser?.id && profile.role === "developer" &&
      profile.status === "active" && profile.is_active !== false
    );
    if (!developer) return { data: null, error: { message: "حذف العامل متاح للمطوّر النشط فقط" } };
    const worker = demoDB.profiles.find((profile: any) => profile.id === args.p_worker_id && profile.role === "worker");
    if (!worker) return { data: null, error: { message: "العامل غير موجود" } };
    if (demoDB.attendance.some((row: any) => row.worker_id === worker.id) ||
        demoDB.withdrawals.some((row: any) => row.worker_id === worker.id) ||
        demoDB.deductions.some((row: any) => row.worker_id === worker.id) ||
        demoDB.settlements.some((row: any) => row.worker_id === worker.id)) {
      return { data: null, error: { message: "لا يمكن حذف العامل لوجود حضور أو سجلات مالية/تسويات مرتبطة به؛ أوقف العامل بدلًا من حذف سجله" } };
    }
    const referenced = demoDB.profiles.some((profile: any) => profile.approved_by === worker.id) ||
      demoDB.projects.some((row: any) => row.created_by === worker.id || row.archived_by === worker.id) ||
      demoDB.attendance.some((row: any) => row.created_by === worker.id) ||
      demoDB.withdrawals.some((row: any) => row.created_by === worker.id || row.decided_by === worker.id) ||
      demoDB.deductions.some((row: any) => row.created_by === worker.id) ||
      demoDB.settlements.some((row: any) => row.confirmed_by === worker.id);
    if (referenced) return { data: null, error: { message: "لا يمكن حذف العامل لوجود سجلات مرتبطة بحسابه؛ أوقفه بدلًا من ذلك" } };
    demoDB.worker_projects = demoDB.worker_projects.filter((row: any) => row.worker_id !== worker.id);
    demoDB.site_workers = demoDB.site_workers.filter((row: any) => row.worker_id !== worker.id);
    demoDB.notifications = demoDB.notifications.filter((row: any) => row.user_id !== worker.id);
    demoDB.profiles = demoDB.profiles.filter((profile: any) => profile.id !== worker.id);
    return { data: worker.id_card_url ?? null, error: null };
  }

  if (fn === "developer_delete_project") {
    const developer = demoDB.profiles.find((profile: any) =>
      profile.id === currentUser?.id && profile.role === "developer" &&
      profile.status === "active" && profile.is_active !== false
    );
    if (!developer) return { data: null, error: { message: "حذف المشروع متاح للمطوّر النشط فقط" } };
    const project = demoDB.projects.find((row: any) => row.id === args.p_project_id);
    if (!project) return { data: null, error: { message: "المشروع غير موجود" } };
    const siteIds = new Set(demoDB.sites.filter((site: any) => site.project_id === project.id).map((site: any) => site.id));
    if (demoDB.attendance.some((row: any) => row.project_id === project.id) ||
        demoDB.attendance_projects.some((row: any) => row.project_id === project.id) ||
        (demoDB.attendance_sites ?? []).some((row: any) => siteIds.has(row.site_id)) ||
        demoDB.withdrawals.some((row: any) => row.project_id === project.id) ||
        demoDB.deductions.some((row: any) => row.project_id === project.id) ||
        demoDB.settlements.some((row: any) => row.project_id === project.id)) {
      return { data: null, error: { message: "لا يمكن حذف المشروع لوجود حضور أو حركات مالية/تسويات مرتبطة به؛ استخدم الأرشفة للحفاظ على السجلات" } };
    }
    demoDB.worker_projects = demoDB.worker_projects.filter((row: any) => row.project_id !== project.id);
    demoDB.site_workers = demoDB.site_workers.filter((row: any) => !siteIds.has(row.site_id));
    demoDB.sites = demoDB.sites.filter((site: any) => site.project_id !== project.id);
    demoDB.projects = demoDB.projects.filter((row: any) => row.id !== project.id);
    return { data: null, error: null };
  }

  if (fn === "register_attendance_multi" || fn === "admin_register_attendance_multi") {
    const isAdmin = fn === "admin_register_attendance_multi";
    const worker = demoDB.profiles.find((profile: any) => profile.id === args.p_worker_id && profile.role === "worker");
    if (!worker || worker.status === "rejected" || worker.is_active === false) {
      return { data: null, error: { message: "حساب العامل غير مفعّل" } };
    }
    const selected = Array.isArray(args.p_project_ids) ? args.p_project_ids : [];
    if (selected.some((id: any) => typeof id !== "string") || new Set(selected).size !== selected.length) {
      return { data: null, error: { message: "قائمة المشاريع غير صحيحة" } };
    }
    const assignments = activeAssignments(worker.id);
    if (assignments.length && !selected.length) {
      return { data: null, error: { message: "اختار مشروعًا نشطًا واحدًا على الأقل" } };
    }
    if (!isAdmin && demoDB.worker_projects.some((row: any) => row.worker_id === worker.id) && !assignments.length) {
      return { data: null, error: { message: "لا يوجد لديك مشروع نشط" } };
    }
    const allowed = new Set(assignments.map((assignment: any) => assignment.project_id));
    if (selected.some((id: string) => !allowed.has(id))) {
      return { data: null, error: { message: "المشروع غير نشط أو غير مخصص للعامل" } };
    }
    if (isAdmin && !selected.length) {
      return { data: null, error: { message: "اختر المشروع/الموقع أولًا" } };
    }
    const existing = demoDB.attendance.find((row: any) =>
      row.worker_id === worker.id && row.work_date === args.p_work_date
    );
    let attendance = existing;
    if (!attendance) {
      attendance = {
        id: uid(),
        worker_id: worker.id,
        project_id: selected[0] ?? null,
        work_date: args.p_work_date,
        daily_wage_snapshot: Number(worker.daily_wage ?? 0),
        source: isAdmin ? "admin" : "worker",
        lat: args.p_lat ?? null,
        lng: args.p_lng ?? null,
        note: args.p_note ?? null,
        created_by: isAdmin ? (currentUser?.id ?? "demo-owner") : worker.id,
        created_at: now(),
      };
      demoDB.attendance.push(attendance);
      demoDB.notifications.unshift({
        id: uid(),
        user_id: isAdmin ? worker.id : "demo-owner",
        type: "attendance_new",
        title: isAdmin ? "تم تسجيل حضورك" : "حضور جديد",
        body: isAdmin ? "سجلت الإدارة حضورك" : `${worker.full_name} سجّل حضوره`,
        data: {},
        is_read: false,
        created_at: now(),
      });
    } else {
      attendance.lat = args.p_lat ?? attendance.lat;
      attendance.lng = args.p_lng ?? attendance.lng;
      attendance.note = args.p_note ?? attendance.note;
    }
    linkProjects(attendance.id, selected);
    return { data: attendance.id, error: null };
  }

  if (fn === "add_attendance_project") {
    const attendance = demoDB.attendance.find((row: any) => row.id === args.p_attendance_id);
    const project = activeProjects().find((row: any) => row.id === args.p_project_id);
    if (!attendance || attendance.worker_id !== currentUser?.id || !project ||
        !activeAssignments(attendance.worker_id).some((row: any) => row.project_id === project.id)) {
      return { data: null, error: { message: "المشروع غير متاح أو غير مخصص لك" } };
    }
    linkProjects(attendance.id, [project.id]);
    return { data: null, error: null };
  }

  if (fn === "register_withdrawal") {
    const amount = Number(args.p_amount);
    if (!Number.isFinite(amount) || amount <= 0 || !args.p_request_id || args.p_project_id != null) {
      return { data: null, error: { message: "المبلغ أو بيانات طلب الصرف غير صحيحة؛ الصرف من الرصيد العام فقط" } };
    }
    const previous = demoDB.withdrawals.find((row: any) => row.client_request_id === args.p_request_id);
    if (previous) {
      if (previous.worker_id !== args.p_worker_id || Number(previous.amount) !== amount) {
        return { data: null, error: { message: "رقم العملية مستخدم لطلب مختلف" } };
      }
      return { data: previous, error: null };
    }
    const balance = workerBalances().find((row: any) => row.worker_id === args.p_worker_id);
    const available = Number(balance?.available ?? 0);
    if (amount > Math.max(available, 0)) {
      return { data: null, error: { message: `المتاح من رصيدك العام ${Math.max(available, 0)} جنيه فقط` } };
    }
    const autoLimit = Number(demoDB.settings[0]?.value?.auto_approve_limit ?? 500);
    const rec = {
      id: uid(), worker_id: args.p_worker_id, project_id: null, amount,
      note: args.p_note ?? null, client_request_id: args.p_request_id,
      status: amount <= autoLimit ? "approved" : "pending",
      decided_by: amount <= autoLimit ? "demo-owner" : null,
      decided_at: amount <= autoLimit ? now() : null,
      decision_note: null, created_by: args.p_worker_id, created_at: now(),
    };
    demoDB.withdrawals.push(rec);
    return { data: rec, error: null };
  }

  if (fn === "approve_worker") {
    const worker = demoDB.profiles.find((profile: any) => profile.id === args.p_worker_id && profile.role === "worker");
    if (!worker) return { data: null, error: { message: "العامل غير موجود" } };
    worker.status = "active";
    worker.daily_wage = args.p_daily_wage ?? worker.daily_wage;
    worker.approved_at = now();
    if (args.p_project_id && !demoDB.worker_projects.some((row: any) => row.worker_id === worker.id && row.project_id === args.p_project_id)) {
      demoDB.worker_projects.push({ id: uid(), worker_id: worker.id, project_id: args.p_project_id, daily_wage: worker.daily_wage, joined_at: now() });
    }
    demoDB.notifications.unshift({ id: uid(), user_id: worker.id, type: "account_approved", title: "تم تفعيل حسابك", body: "يمكنك الآن تسجيل الحضور ومراجعة رصيدك العام", data: {}, is_read: false, created_at: now() });
    return { data: null, error: null };
  }

  if (fn === "reject_worker") {
    demoDB.profiles.forEach((profile: any) => {
      if (profile.id === args.p_worker_id) {
        profile.status = "rejected";
        profile.reject_reason = args.p_reason ?? null;
      }
    });
    return { data: null, error: null };
  }

  if (fn === "create_worker") {
    const id = uid();
    demoDB.profiles.push({
      id, full_name: args.p_full_name, phone: args.p_phone, role: "worker",
      daily_wage: args.p_daily_wage ?? 0, is_active: true, status: "active",
      created_at: now(),
    });
    if (args.p_project_id) {
      demoDB.worker_projects.push({ id: uid(), worker_id: id, project_id: args.p_project_id, daily_wage: args.p_daily_wage ?? 0, joined_at: now() });
    }
    return { data: id, error: null };
  }

  if (fn === "save_worker_admin_details" || fn === "update_worker_details") {
    const worker = demoDB.profiles.find((profile: any) => profile.id === args.p_worker_id && profile.role === "worker");
    if (!worker) return { data: null, error: { message: "العامل غير موجود" } };
    const phone = String(args.p_phone ?? "").replace(/[^0-9]/g, "");
    const wage = Number(args.p_daily_wage);
    if (String(args.p_full_name ?? "").trim().length < 3 || phone.length < 10 || !Number.isFinite(wage) || wage < 0) {
      return { data: null, error: { message: "بيانات العامل غير صحيحة" } };
    }
    worker.full_name = String(args.p_full_name).trim();
    worker.phone = phone;
    worker.daily_wage = wage;
    worker.is_active = Boolean(args.p_is_active);
    if (fn === "save_worker_admin_details" && Array.isArray(args.p_project_ids)) {
      const selected = new Set(args.p_project_ids);
      if ([...selected].some((id) => !activeProjects().some((project: any) => project.id === id))) {
        return { data: null, error: { message: "قائمة المشاريع غير صالحة" } };
      }
      demoDB.worker_projects = demoDB.worker_projects.filter((assignment: any) =>
        assignment.worker_id !== worker.id ||
        !activeProjects().some((project: any) => project.id === assignment.project_id) ||
        selected.has(assignment.project_id)
      );
      for (const projectId of selected) {
        const existing = demoDB.worker_projects.find((assignment: any) => assignment.worker_id === worker.id && assignment.project_id === projectId);
        if (existing) existing.daily_wage = wage;
        else demoDB.worker_projects.push({ id: uid(), worker_id: worker.id, project_id: projectId, daily_wage: wage, joined_at: now() });
      }
    }
    return { data: null, error: null };
  }

  if (fn === "add_worker_deduction") {
    const amount = Number(args.p_amount);
    if (!Number.isFinite(amount) || amount <= 0 || String(args.p_reason ?? "").trim().length === 0 || args.p_project_id != null) {
      return { data: null, error: { message: "اكتب مبلغًا وسببًا صحيحين؛ الخصم على الحساب العام فقط" } };
    }
    const worker = demoDB.profiles.find((profile: any) => profile.id === args.p_worker_id && profile.role === "worker");
    if (!worker) return { data: null, error: { message: "العامل غير موجود" } };
    demoDB.deductions.push({ id: uid(), worker_id: worker.id, project_id: null, amount, reason: String(args.p_reason).trim(), created_by: currentUser?.id ?? "demo-owner", created_at: now() });
    return { data: null, error: null };
  }

  if (fn === "reset_worker_password") return { data: null, error: null };
  if (fn === "admin_update_user") {
    const profile = demoDB.profiles.find((row: any) => row.id === args.p_user_id);
    if (profile) Object.assign(profile, { full_name: args.p_full_name ?? profile.full_name, username: args.p_username ?? profile.username, role: args.p_role ?? profile.role, status: args.p_status ?? profile.status, daily_wage: args.p_daily_wage ?? profile.daily_wage, is_active: args.p_is_active ?? profile.is_active });
    return { data: null, error: null };
  }
  if (fn === "set_my_id_card") return { data: null, error: null };

  if (fn === "export_project_data") {
    const projectId = args.p_project_id;
    const project = demoDB.projects.find((row: any) => row.id === projectId);
    if (!project) return { data: null, error: { message: "المشروع غير موجود" } };
    const attendanceIds = new Set(demoDB.attendance_projects.filter((link: any) => link.project_id === projectId).map((link: any) => link.attendance_id));
    const workerIds = new Set([
      ...demoDB.worker_projects.filter((row: any) => row.project_id === projectId).map((row: any) => row.worker_id),
      ...demoDB.attendance.filter((row: any) => attendanceIds.has(row.id)).map((row: any) => row.worker_id),
    ]);
    const attendance = demoDB.attendance.filter((row: any) => attendanceIds.has(row.id)).map((row: any) => ({
      attendance_id: row.id,
      work_date: row.work_date,
      full_name: demoDB.profiles.find((profile: any) => profile.id === row.worker_id)?.full_name ?? "",
      source: row.source,
      created_at: row.created_at,
      projects: demoDB.attendance_projects.filter((link: any) => link.attendance_id === row.id)
        .map((link: any) => demoDB.projects.find((item: any) => item.id === link.project_id)?.name)
        .filter(Boolean),
    }));
    return {
      data: {
        project,
        workers: demoDB.profiles.filter((profile: any) => workerIds.has(profile.id)).map((profile: any) => ({ worker_id: profile.id, full_name: profile.full_name, phone: profile.phone })),
        attendance,
      },
      error: null,
    };
  }

  if (fn === "close_project") {
    const project = demoDB.projects.find((row: any) => row.id === args.p_project_id);
    if (!project) return { data: null, error: { message: "المشروع غير موجود" } };
    if (project.status === "closed") return { data: null, error: { message: "المشروع مؤرشف بالفعل" } };
    project.status = "closed";
    project.closed_at = now();
    project.archived_at = project.closed_at;
    project.end_date ??= project.closed_at.slice(0, 10);
    return { data: null, error: null };
  }

  return { data: null, error: { message: `rpc ${fn} not mocked` } };
};

// ============ CLIENT ============
const storageMock = {
  from: (_bucket: string) => ({
    upload: async (path: string) => {
      void path;
      const rec = { id: uid(), bucket: _bucket, created_at: new Date().toISOString() };
      demoDB.storage = demoDB.storage ?? [];
      demoDB.storage.push(rec);
      return { data: { path }, error: null };
    },
    getPublicUrl: (_path: string) => ({
      data: { publicUrl: "data:image/svg+xml;base64,PHN2Zy8+" },
    }),
    createSignedUrl: async (_path: string) => ({
      data: { signedUrl: "data:image/svg+xml;base64,PHN2Zy8+" },
      error: null,
    }),
    remove: async (paths: string[]) => ({
      data: paths.map((name) => ({ name })),
      error: null,
    }),
  }),
};

export const demoClient = {
  from: (table: string) => build(table),
  rpc: rpcMock,
  auth: authMock,
  storage: storageMock,
  channel: () => ({ on: () => ({ subscribe: () => {} }) }),
  removeChannel: () => {},
};
