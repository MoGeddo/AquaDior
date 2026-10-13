import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { money, todayStr } from "../../lib/calc";
import type { WorkerBalance, Notification } from "../../lib/types";
import { useAuth } from "../../store/auth";
import AppIcon from "../../components/AppIcon";

export default function Dashboard() {
  const { profile } = useAuth();
  const [balances, setBalances] = useState<WorkerBalance[]>([]);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [present, setPresent] = useState(0);
  const [todayWd, setTodayWd] = useState(0);
  const [todayEarned, setTodayEarned] = useState(0);
  const [absentNames, setAbsentNames] = useState<string[]>([]);

  const load = useCallback(async () => {
    const t = todayStr();

    const { data } = await supabase
      .from("worker_balances")
      .select("*")
      .eq("is_active", true)
      .order("full_name");
    const list = (data ?? []) as WorkerBalance[];
    setBalances(list);

    const [{ data: att }, { data: wd }, { data: n }, { data: earn }] =
      await Promise.all([
        supabase.from("attendance").select("worker_id").eq("work_date", t),
        supabase
          .from("withdrawals")
          .select("amount")
          .gte("created_at", t + "T00:00:00"),
        supabase
          .from("notifications")
          .select("*")
          .eq("user_id", profile?.id ?? "")
          .order("created_at", { ascending: false })
          .limit(6),
        supabase.from("attendance_with_wage").select("wage").eq("work_date", t),
      ]);

    const presentIds = new Set((att ?? []).map((a: any) => a.worker_id));
    setPresent(presentIds.size);
    setTodayWd((wd ?? []).reduce((s: number, x: any) => s + Number(x.amount), 0));
    setTodayEarned(
      (earn ?? []).reduce((s: number, x: any) => s + Number(x.wage), 0)
    );
    setNotifs((n ?? []) as Notification[]);
    setAbsentNames(
      list.filter((b) => !presentIds.has(b.worker_id)).map((b) => b.full_name)
    );
  }, [profile?.id]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 20000);
    return () => clearInterval(t);
  }, [load]);

  const total = {
    earned: balances.reduce((s, b) => s + Number(b.earned), 0),
    wd: balances.reduce((s, b) => s + Number(b.withdrawn_approved), 0),
    pending: balances.reduce((s, b) => s + Number(b.withdrawn_pending), 0),
    dd: balances.reduce((s, b) => s + Number(b.deducted), 0),
    settled: balances.reduce((s, b) => s + Number(b.settled_paid ?? 0), 0),
    net: balances.reduce((s, b) => s + Number(b.balance), 0),
  };

  return (
    <>
      {/* ===== أرقام النهاردة ===== */}
      <div className="stats">
        <div className="stat">
          <div className="label">إجمالي العمال</div>
          <div className="value teal">{balances.length}</div>
        </div>
        <div className="stat">
          <div className="label">نزلوا النهاردة</div>
          <div className="value green">
            <span className="value-with-icon"><AppIcon name="circleCheck" size={19} /><span>{present}</span></span>
          </div>
        </div>
        <div className="stat">
          <div className="label">غايبين</div>
          <div className="value red">{balances.length - present}</div>
        </div>
        <div className="stat">
          <div className="label">فلوس النهاردة</div>
          <div className="value amber">{money(todayWd)}</div>
        </div>
      </div>

      <div className="grid-2">
        {/* ===== ملخص اليوم ===== */}
        <div className="card">
          <div className="card-title">
            <span className="icon-label">
              <AppIcon name="calendarCheck" size={18} />
              <span>ملخص النهاردة</span>
            </span>
          </div>
          <div className="row">
            <span className="muted">استحقاق العمال النهاردة</span>
            <b className="num">{money(todayEarned)}</b>
          </div>
          <div className="row">
            <span className="muted">فلوس اتسحبت النهاردة</span>
            <b className="num" style={{ color: "var(--amber-600)" }}>
              {money(todayWd)}
            </b>
          </div>
          <div className="row">
            <span className="muted">الصافي</span>
            <b className="num" style={{ color: "var(--green-600)" }}>
              {money(todayEarned - todayWd)}
            </b>
          </div>
        </div>

        {/* ===== إجمالي الأرصدة ===== */}
        <div className="card">
          <div className="card-title">
            <span className="icon-label">
              <AppIcon name="wallet" size={18} />
              <span>إجمالي الأرصدة (كل المشاريع)</span>
            </span>
          </div>
          <div className="row">
            <span className="muted">إجمالي الاستحقاقات</span>
            <b className="num">{money(total.earned)}</b>
          </div>
          <div className="row">
            <span className="muted">المسحوب (موافق عليه)</span>
            <b className="num" style={{ color: "var(--amber-600)" }}>
              {money(total.wd)}
            </b>
          </div>
          {total.pending > 0 && (
            <div className="row">
              <span className="muted">مستني موافقتك</span>
              <b className="num" style={{ color: "var(--blue-600)" }}>
                {money(total.pending)}
              </b>
            </div>
          )}
          <div className="row">
            <span className="muted">الخصومات</span>
            <b className="num" style={{ color: "var(--red-600)" }}>
              {money(total.dd)}
            </b>
          </div>
          {total.settled > 0 && (
            <div className="row">
              <span className="muted">تسويات مصروفة</span>
              <b className="num" style={{ color: "var(--green-600)" }}>{money(total.settled)}</b>
            </div>
          )}
          <div className="row" style={{ borderTop: "2px solid var(--ink-200)" }}>
            <span>
              <b>المطلوب صرفه للكل</b>
            </span>
            <b className="num" style={{ fontSize: 20, color: "var(--green-600)" }}>
              {money(total.net)}
            </b>
          </div>
        </div>
      </div>

      {/* ===== الغايبين ===== */}
      <div className="card">
        <div className="card-title">
          <span className="icon-label">
            <AppIcon name="hardHat" size={18} />
            <span>العمال اللي مسجّلوش النهاردة ({absentNames.length})</span>
          </span>
          <Link to="/admin/attendance" className="btn btn-sm">
            فتح الحضور
          </Link>
        </div>
        {absentNames.length === 0 ? (
          <div className="empty empty-with-icon">
            <AppIcon name="circleCheck" size={24} className="empty-state-icon" />
            <span>كل العمال سجّلوا النهاردة</span>
          </div>
        ) : (
          <div className="flex wrap" style={{ gap: 8 }}>
            {absentNames.map((n) => (
              <span key={n} className="badge red">
                {n}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ===== الإشعارات ===== */}
      <div className="card">
        <div className="card-title">
          <span className="icon-label">
            <AppIcon name="bell" size={18} />
            <span>آخر الإشعارات</span>
          </span>
          <Link to="/admin/audit" className="btn btn-sm">
            سجل التعديلات
          </Link>
        </div>
        {notifs.length === 0 && <div className="empty">مفيش إشعارات</div>}
        {notifs.map((n) => (
          <div className="row" key={n.id}>
            <div style={{ minWidth: 0 }}>
              <div className="main">{n.title}</div>
              <div className="meta">{n.body}</div>
            </div>
            <span className="small muted">{n.created_at?.slice(11, 16)}</span>
          </div>
        ))}
      </div>

      {/* ===== أكبر المسحوبين ===== */}
      <div className="card">
        <div className="card-title">
          <span className="icon-label">
            <AppIcon name="banknote" size={18} />
            <span>أكبر المسحوبين</span>
          </span>
          <Link to="/admin/workers" className="btn btn-sm">
            كل العمال
          </Link>
        </div>
        <div className="table-wrap" role="region" aria-label="جدول العمال الأكثر سحبًا" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>العامل</th>
                <th>أيام</th>
                <th>استحقاق</th>
                <th>خد</th>
                <th>رصيد</th>
              </tr>
            </thead>
            <tbody>
              {[...balances]
                .sort(
                  (a, b) =>
                    Number(b.withdrawn_approved) +
                    Number(b.withdrawn_pending) -
                    (Number(a.withdrawn_approved) + Number(a.withdrawn_pending))
                )
                .slice(0, 8)
                .map((b) => (
                  <tr key={b.worker_id}>
                    <td>{b.full_name}</td>
                    <td className="num">{b.days_worked}</td>
                    <td className="num">{money(b.earned)}</td>
                    <td className="num" style={{ color: "var(--amber-600)" }}>
                      {money(Number(b.withdrawn_approved) + Number(b.withdrawn_pending))}
                    </td>
                    <td className="num" style={{ color: "var(--green-600)" }}>
                      <b>{money(b.balance)}</b>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
