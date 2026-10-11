/**
 * وضع تجريبي (Demo Mode)
 * يشتغل التطبيق كامل ببيانات وهمية من غير Supabase.
 * بيتفعّل تلقائيًا لو VITE_SUPABASE_URL مش متظبط.
 */

const uid = () => Math.random().toString(36).slice(2, 10);

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function isoDaysAgo(n: number, h = 9): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, 30, 0, 0);
  return d.toISOString();
}

const WORKER_NAMES = [
  ["أحمد محمد علي", 350],
  ["محمود سيد إبراهيم", 350],
  ["خالد عبد الرحمن", 300],
  ["مصطفى كمال حسن", 400],
  ["رمضان فتحي أحمد", 300],
  ["سعيد حسن محمود", 350],
  ["عمرو الشحات عبد الله", 400],
  ["طارق سعيد منصور", 300],
  ["حسن علي حسين", 350],
  ["ياسر عبد العزيز", 350],
  ["إسلام محمد فؤاد", 300],
  ["عادل رمضان سعد", 350],
];

export const demoDB: any = {
  profiles: [
    {
      id: "demo-owner",
      full_name: "عابدين يونس",
      phone: "01000000000",
      username: "abden.younes",
      role: "owner",
      daily_wage: 0,
      default_site_id: "site-1",
      is_active: true,
      status: "active",
      created_at: isoDaysAgo(60),
    },
    {
      id: "demo-owner-2",
      full_name: "محمود عبدين",
      phone: "01000000001",
      username: "mahmoud.abdin",
      role: "owner",
      daily_wage: 0,
      is_active: true,
      status: "active",
      created_at: isoDaysAgo(60),
    },
    {
      id: "demo-developer",
      full_name: "Mostafa Geddo",
      phone: "01000000002",
      username: "mostafageddo",
      role: "developer",
      daily_wage: 0,
      is_active: true,
      status: "active",
      created_at: isoDaysAgo(60),
    },
    ...WORKER_NAMES.map(([name, wage], i) => ({
      id: `demo-w${i + 1}`,
      full_name: name as string,
      phone: `0111${String(1000000 + i * 137).slice(0, 7)}`,
      role: "worker",
      daily_wage: wage as number,
      default_site_id: `site-${(i % 3) + 1}`,
      is_active: i !== 10,
      status: "active",
      id_card_url: null,
      username:
        "worker" +
        String(i + 1).padStart(2, "0"),
      created_at: isoDaysAgo(50 - i),
    })),
    // طلب تسجيل مستني موافقة
    {
      id: "demo-pending-1",
      full_name: "سيد عبد الله سيد",
      phone: "01155555555",
      username: "sayed.ali",
      role: "worker",
      daily_wage: 0,
      is_active: true,
      status: "pending",
      id_card_url: null,
      created_at: isoDaysAgo(0, 8),
    },
  ],

  projects: [
    {
      id: "proj-1",
      name: "عمارة المنصورة",
      description: "دورين + بدروم",
      status: "active",
      start_date: daysAgo(25),
      end_date: null,
      created_at: isoDaysAgo(25),
    },
    {
      id: "proj-2",
      name: "تشطيب فيلا التجمع",
      description: "تشطيب كامل",
      status: "active",
      start_date: daysAgo(12),
      end_date: null,
      created_at: isoDaysAgo(12),
    },
  ],

  sites: [
    { id: "site-1", project_id: "proj-1", name: "موقع العمارة - أ", address: "المنصورة - شارع الجيش", is_active: true },
    { id: "site-2", project_id: "proj-1", name: "موقع العمارة - ب", address: "المنصورة - behind", is_active: true },
    { id: "site-3", project_id: "proj-2", name: "الفيلا - تجمع", address: "التجمع الأول", is_active: true },
  ],

  site_workers: WORKER_NAMES.flatMap((_, i) => [
    { site_id: `site-${(i % 3) + 1}`, worker_id: `demo-w${i + 1}`, assigned_at: isoDaysAgo(20) },
  ]),

  worker_projects: WORKER_NAMES.map((_, i) => ({
    id: `wp-${i + 1}`,
    worker_id: `demo-w${i + 1}`,
    project_id: i % 3 === 2 ? "proj-2" : "proj-1",
    daily_wage: WORKER_NAMES[i][1],
    joined_at: isoDaysAgo(20),
  })),

  attendance: WORKER_NAMES.flatMap((_, wi) =>
    Array.from({ length: 14 }, (_, d) => {
      // كل عامل عنده نمط غياب مختلف
      const skip = (wi + d * 3) % 7 === 0 || (wi === 3 && d === 5) || (wi === 7 && d === 9);
      if (skip) return null;
      return {
        id: `att-${wi}-${d}`,
        worker_id: `demo-w${wi + 1}`,
        project_id: wi % 3 === 2 ? "proj-2" : "proj-1",
        work_date: daysAgo(d),
        source: d === 0 ? "worker" : "worker",
        lat: d === 0 ? 31.0409 : null,
        lng: d === 0 ? 31.3785 : null,
        note: null,
        created_by: `demo-w${wi + 1}`,
        created_at: isoDaysAgo(d, 7 + (d % 2)),
      };
    }).filter(Boolean)
  ),

  attendance_sites: [] as any[],

  withdrawals: [
    { id: "wd-1", worker_id: "demo-w1", project_id: "proj-1", amount: 200, note: "مواصلات", status: "approved", decided_by: "demo-owner", decided_at: isoDaysAgo(6), decision_note: null, created_by: "demo-w1", created_at: isoDaysAgo(6) },
    { id: "wd-2", worker_id: "demo-w1", project_id: "proj-1", amount: 300, note: "خامات", status: "approved", decided_by: "demo-owner", decided_at: isoDaysAgo(3), decision_note: null, created_by: "demo-w1", created_at: isoDaysAgo(3) },
    { id: "wd-3", worker_id: "demo-w1", project_id: "proj-1", amount: 700, note: null, status: "pending", decided_by: null, decided_at: null, decision_note: null, created_by: "demo-w1", created_at: isoDaysAgo(0, 10) },
    { id: "wd-4", worker_id: "demo-w2", project_id: "proj-1", amount: 150, note: "أكل", status: "approved", decided_by: "demo-owner", decided_at: isoDaysAgo(4), decision_note: null, created_by: "demo-w2", created_at: isoDaysAgo(4) },
    { id: "wd-5", worker_id: "demo-w2", project_id: "proj-1", amount: 450, note: "سلفة", status: "approved", decided_by: "demo-owner", decided_at: isoDaysAgo(1), decision_note: null, created_by: "demo-w2", created_at: isoDaysAgo(1) },
    { id: "wd-6", worker_id: "demo-w3", project_id: "proj-1", amount: 900, note: "خامات ومواصلات", status: "pending", decided_by: null, decided_at: null, decision_note: null, created_by: "demo-w3", created_at: isoDaysAgo(0, 11) },
    { id: "wd-7", worker_id: "demo-w4", project_id: "proj-1", amount: 250, note: null, status: "approved", decided_by: "demo-owner", decided_at: isoDaysAgo(2), decision_note: null, created_by: "demo-w4", created_at: isoDaysAgo(2) },
    { id: "wd-8", worker_id: "demo-w5", project_id: "proj-1", amount: 120, note: "أكل", status: "rejected", decided_by: "demo-owner", decided_at: isoDaysAgo(5), decision_note: "اتصرف امبارح", created_by: "demo-w5", created_at: isoDaysAgo(5) },
  ],

  deductions: [
    { id: "dd-1", worker_id: "demo-w6", project_id: "proj-1", amount: 50, reason: "نسي يسجّل حضوره", created_by: "demo-owner", created_at: isoDaysAgo(4) },
  ],

  settlements: [],

  notifications: [
    { id: "nt-1", user_id: "demo-owner", type: "withdrawal_pending", title: "مطلوب موافقة ⚠️", body: "أحمد محمد علي خد 700 ج.م — فوق السقف", data: {}, is_read: false, created_at: isoDaysAgo(0, 10) },
    { id: "nt-2", user_id: "demo-owner", type: "attendance_new", title: "حضور جديد", body: "محمود سيد إبراهيم سجّل حضوره", data: {}, is_read: false, created_at: isoDaysAgo(0, 9) },
    { id: "nt-3", user_id: "demo-owner", type: "attendance_edit", title: "تعديل حضور ⚠️", body: "خالد عبد الرحمن عُدّل حضوره", data: {}, is_read: true, created_at: isoDaysAgo(1, 14) },
  ],

  audit_log: [
    { id: 1, table_name: "withdrawals", record_id: "wd-3", action: "insert", old_data: null, new_data: { worker_id: "demo-w1", amount: 700 }, changed_by: "demo-w1", changed_at: isoDaysAgo(0, 10) },
    { id: 2, table_name: "attendance", record_id: "att-1-0", action: "insert", old_data: null, new_data: { worker_id: "demo-w1", work_date: daysAgo(0) }, changed_by: "demo-w1", changed_at: isoDaysAgo(0, 9) },
    { id: 3, table_name: "deductions", record_id: "dd-1", action: "insert", old_data: null, new_data: { worker_id: "demo-w6", amount: 50, reason: "نسي يسجّل حضوره" }, changed_by: "demo-owner", changed_at: isoDaysAgo(4) },
  ],

  settings: [
    { key: "app", value: { auto_approve_limit: 500, absence_deduction: 50, day_lock_time: "00:00", gps_enabled: true, currency: "ج.م" }, updated_at: isoDaysAgo(1) },
    { key: "telegram", value: { bot_token: "", chat_id: "" }, updated_at: isoDaysAgo(1) },
  ],
};

// اربط المواقع بالحضور
demoDB.attendance.forEach((a: any, i: number) => {
  if (!a) return;
  const n = i % 4 === 0 ? 2 : 1;
  for (let k = 0; k < n; k++) {
    demoDB.attendance_sites.push({
      id: `as-${i}-${k}`,
      attendance_id: a.id,
      site_id: `site-${((i + k) % 3) + 1}`,
    });
  }
});

// ============ VIEWS ============
export function workerBalances(): any[] {
  return demoDB.profiles
    .filter((p: any) => p.role === "worker")
    .map((p: any) => {
      const att = demoDB.attendance.filter((a: any) => a && a.worker_id === p.id);
      const days = att.length;
      const earned = att.reduce((s: number) => s + (p.daily_wage || 0), 0);
      const wd = demoDB.withdrawals.filter((w: any) => w.worker_id === p.id);
      const approved = wd
        .filter((w: any) => w.status === "approved")
        .reduce((s: number, w: any) => s + w.amount, 0);
      const pending = wd
        .filter((w: any) => w.status === "pending")
        .reduce((s: number, w: any) => s + w.amount, 0);
      const deducted = demoDB.deductions
        .filter((d: any) => d.worker_id === p.id)
        .reduce((s: number, d: any) => s + d.amount, 0);
      return {
        worker_id: p.id,
        full_name: p.full_name,
        phone: p.phone,
        role: p.role,
        daily_wage: p.daily_wage,
        is_active: p.is_active,
        days_worked: days,
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
        workers_count: demoDB.worker_projects.filter((w: any) => w.project_id === p.id).length,
        attendance_count: demoDB.attendance.filter((a: any) => a && a.project_id === p.id).length,
        total_withdrawn: demoDB.withdrawals
          .filter((w: any) => w.project_id === p.id)
          .reduce((s: number, w: any) => s + w.amount, 0),
        total_deductions: 0,
        total_paid: 0,
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

function build(table: string) {
  const state: { filters: [string, any][]; order: [string, "asc" | "desc"] | null; limit: number | null } = {
    filters: [],
    order: null,
    limit: null,
  };

  const result = () => {
    let rs = rows(table).filter((r) => matchRow(r, state.filters));
    if (state.order) rs = sortRows(rs, state.order[0], state.order[1]);
    if (state.limit) rs = rs.slice(0, state.limit);
    return rs;
  };

  const q: any = {
    select: () => q,
    insert: async (payload: any) => {
      const arr = Array.isArray(payload) ? payload : [payload];
      const created = arr.map((p) => ({ id: uid(), created_at: new Date().toISOString(), ...p }));
      demoDB[table] = [...rows(table), ...created];
      return { data: Array.isArray(payload) ? created : created[0], error: null };
    },
    update: async (payload: any) => {
      const rs = result();
      rs.forEach((r) => Object.assign(r, payload));
      return { data: rs, error: null };
    },
    delete: async () => {
      const rs = result();
      const ids = new Set(rs.map((r) => r.id));
      demoDB[table] = rows(table).filter((r: any) => !ids.has(r.id));
      return { data: rs, error: null };
    },
    upsert: async (payload: any) => {
      const arr = Array.isArray(payload) ? payload : [payload];
      arr.forEach((p) => {
        const existing = rows(table).find((r) => r.id === p.id || r.key === p.key);
        if (existing) Object.assign(existing, p);
        else demoDB[table] = [...rows(table), { id: uid(), ...p }];
      });
      return { data: arr, error: null };
    },
    eq: (k: string, v: any) => {
      state.filters.push([k, v]);
      return q;
    },
    neq: (k: string, v: any) => {
      state.filters.push([k, { $ne: v }]);
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
      const rs = result();
      return { data: rs[0] ?? null, error: rs.length ? null : { message: "no rows" } };
    },
    maybeSingle: async () => {
      const rs = result();
      return { data: rs[0] ?? null, error: null };
    },
    then: (res: any) => res({ data: result(), error: null, count: result().length }),
  };
  return q;
}

// ============ AUTH MOCK ============
let currentUser: any = null;

const authMock = {
  getSession: async () => ({
    data: { session: currentUser ? { user: currentUser } : null },
    error: null,
  }),
  getUser: async () => ({
    data: { user: currentUser ?? null },
    error: currentUser ? null : { message: "not logged in" },
  }),
  signInWithPassword: async ({ email }: any) => {
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
  if (fn === "register_attendance") {
    const worker = demoDB.profiles.find((p: any) => p.id === args.p_worker_id);
    const existing = demoDB.attendance.find(
      (a: any) => a && a.worker_id === args.p_worker_id && a.work_date === args.p_work_date
    );
    if (existing) {
      existing.lat = args.p_lat ?? existing.lat;
      existing.lng = args.p_lng ?? existing.lng;
      demoDB.attendance_sites = demoDB.attendance_sites.filter(
        (x: any) => x.attendance_id !== existing.id
      );
      (args.p_site_ids ?? []).forEach((sid: string) =>
        demoDB.attendance_sites.push({
          id: uid(),
          attendance_id: existing.id,
          site_id: sid,
        })
      );
      return { data: existing.id, error: null };
    }
    const rec = {
      id: uid(),
      worker_id: args.p_worker_id,
      project_id: demoDB.worker_projects.find((w: any) => w.worker_id === args.p_worker_id)?.project_id ?? null,
      work_date: args.p_work_date,
      source: "worker",
      lat: args.p_lat ?? null,
      lng: args.p_lng ?? null,
      note: args.p_note ?? null,
      created_by: args.p_worker_id,
      created_at: new Date().toISOString(),
    };
    demoDB.attendance.push(rec);
    demoDB.notifications.unshift({
      id: uid(),
      user_id: "demo-owner",
      type: "attendance_new",
      title: "حضور جديد",
      body: `${worker?.full_name} سجّل حضوره`,
      data: {},
      is_read: false,
      created_at: new Date().toISOString(),
    });
    if (args.p_site_ids) {
      args.p_site_ids.forEach((sid: string) =>
        demoDB.attendance_sites.push({ id: uid(), attendance_id: rec.id, site_id: sid })
      );
    }
    return { data: rec.id, error: null };
  }

  if (fn === "register_withdrawal") {
    const bal = workerBalances().find((b) => b.worker_id === args.p_worker_id);
    if (args.p_amount > (bal?.available ?? 0)) {
      return {
        data: null,
        error: { message: `مش هتاخد أكتر من اللي اشتغلته — متاح تاخد ${bal?.available ?? 0} جنيه` },
      };
    }
    const autoLimit = demoDB.settings[0].value.auto_approve_limit;
    const rec = {
      id: uid(),
      worker_id: args.p_worker_id,
      project_id: demoDB.worker_projects.find((w: any) => w.worker_id === args.p_worker_id)?.project_id ?? null,
      amount: args.p_amount,
      note: args.p_note ?? null,
      status: args.p_amount <= autoLimit ? "approved" : "pending",
      decided_by: args.p_amount <= autoLimit ? "demo-owner" : null,
      decided_at: args.p_amount <= autoLimit ? new Date().toISOString() : null,
      decision_note: null,
      created_by: args.p_worker_id,
      created_at: new Date().toISOString(),
    };
    demoDB.withdrawals.push(rec);
    return { data: rec, error: null };
  }

  if (fn === "approve_worker") {
    demoDB.profiles.forEach((p: any) => {
      if (p.id === args.p_worker_id) {
        p.status = "active";
        p.daily_wage = args.p_daily_wage ?? p.daily_wage;
        p.approved_at = new Date().toISOString();
      }
    });
    (args.p_site_ids ?? []).forEach((sid: string) => {
      if (!demoDB.site_workers.some((x: any) => x.site_id === sid && x.worker_id === args.p_worker_id)) {
        demoDB.site_workers.push({
          site_id: sid,
          worker_id: args.p_worker_id,
          assigned_at: new Date().toISOString(),
        });
      }
    });
    if (args.p_project_id) {
      demoDB.worker_projects.push({
        id: uid(),
        worker_id: args.p_worker_id,
        project_id: args.p_project_id,
        daily_wage: args.p_daily_wage,
        joined_at: new Date().toISOString(),
      });
    }
    demoDB.notifications.unshift({
      id: uid(),
      user_id: args.p_worker_id,
      type: "account_approved",
      title: "تم تفعيل حسابك",
      body: "تقدر دلوقاني تسجّل حضورك وتاخد فلوك",
      data: {},
      is_read: false,
      created_at: new Date().toISOString(),
    });
    return { data: null, error: null };
  }

  if (fn === "reject_worker") {
    demoDB.profiles.forEach((p: any) => {
      if (p.id === args.p_worker_id) {
        p.status = "rejected";
        p.reject_reason = args.p_reason ?? null;
      }
    });
    return { data: null, error: null };
  }

  if (fn === "add_attendance_site") {
    const dup = demoDB.attendance_sites.find(
      (x: any) => x.attendance_id === args.p_attendance_id && x.site_id === args.p_site_id
    );
    if (!dup) {
      demoDB.attendance_sites.push({
        id: uid(),
        attendance_id: args.p_attendance_id,
        site_id: args.p_site_id,
      });
    }
    return { data: null, error: null };
  }

  if (fn === "create_worker") {
    const id = uid();
    demoDB.profiles.push({
      id,
      full_name: args.p_full_name,
      phone: args.p_phone,
      role: "worker",
      daily_wage: args.p_daily_wage ?? 0,
      is_active: true,
      created_at: new Date().toISOString(),
    });
    (args.p_site_ids ?? []).forEach((sid: string) =>
      demoDB.site_workers.push({ site_id: sid, worker_id: id, assigned_at: new Date().toISOString() })
    );
    if (args.p_project_id)
      demoDB.worker_projects.push({
        id: uid(),
        worker_id: id,
        project_id: args.p_project_id,
        daily_wage: args.p_daily_wage,
        joined_at: new Date().toISOString(),
      });
    return { data: id, error: null };
  }

  if (fn === "reset_worker_password") return { data: null, error: null };
  if (fn === "export_project_data") {
    const pid = args.p_project_id;
    const proj = demoDB.projects.find((p: any) => p.id === pid);
    const workerIds = demoDB.worker_projects
      .filter((w: any) => w.project_id === pid)
      .map((w: any) => w.worker_id);
    return {
      data: {
        project: proj ?? null,
        workers: demoDB.profiles.filter((p: any) => workerIds.includes(p.id)),
        attendance: demoDB.attendance.filter((a: any) => a && a.project_id === pid),
        withdrawals: demoDB.withdrawals.filter((w: any) => w.project_id === pid),
        deductions: demoDB.deductions.filter((d: any) => d.project_id === pid),
        settlements: demoDB.settlements.filter((s: any) => s.project_id === pid),
      },
      error: null,
    };
  }

  if (fn === "close_project") {
    demoDB.projects.forEach((p: any) => {
      if (p.id === args.p_project_id) {
        p.status = "closed";
        p.closed_at = new Date().toISOString();
      }
    });
    return { data: null, error: null };
  }

  return { data: null, error: { message: `rpc ${fn} not mocked` } };
};

// ============ CLIENT ============
export function isDemoMode(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  // Force صريح من .env
  if (import.meta.env.VITE_DEMO_MODE === "1") return true;
  if (import.meta.env.VITE_DEMO_MODE === "0") return false;
  // لو الـ URL أو الـ key ناقصين أو placeholders → وضع تجريبي
  if (!url || !key) return true;
  if (url.includes("placeholder") || key.includes("placeholder")) return true;
  // الـ publishable key الجديد لازم يكون طويل (sb_publishable_...)
  if (key.length < 30) return true;
  return false;
}

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
