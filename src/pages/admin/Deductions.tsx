import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "../../components/Modal";
import { supabase } from "../../lib/supabase";
import { money } from "../../lib/calc";
import type { Deduction } from "../../lib/types";
import AppIcon from "../../components/AppIcon";

type ProfileName = { id: string; full_name: string; phone?: string | null };
type DeductionRow = Deduction & { workerName: string; workerPhone: string; creatorName: string };
const PAGE_SIZE = 100;

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value?.slice(0, 16) ?? "";
  return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function Deductions() {
  const [rows, setRows] = useState<DeductionRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reversing, setReversing] = useState<DeductionRow | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reverseBusy, setReverseBusy] = useState(false);

  const load = useCallback(async (from = 0) => {
    const firstPage = from === 0;
    if (firstPage) setLoading(true);
    else setLoadingMore(true);
    setError("");
    try {
      const { data, error: queryError } = await supabase
        .from("deductions")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (queryError) throw queryError;
      const deductions = (data ?? []) as Deduction[];
      const ids = [...new Set(deductions.flatMap((row) => [row.worker_id, row.created_by].filter(Boolean) as string[]))];
      const names = new Map<string, ProfileName>();
      if (ids.length) {
        const { data: profiles, error: profileError } = await supabase
          .from("profiles")
          .select("id, full_name, phone")
          .in("id", ids);
        if (profileError) throw profileError;
        (profiles ?? []).forEach((profile: ProfileName) => names.set(profile.id, profile));
      }
      const pageRows = deductions.map((row) => ({
        ...row,
        workerName: names.get(row.worker_id)?.full_name ?? "عامل غير متاح",
        workerPhone: names.get(row.worker_id)?.phone ?? "",
        creatorName: row.created_by ? names.get(row.created_by)?.full_name ?? "حساب الإدارة" : "النظام",
      }));
      setRows((previous) => {
        if (firstPage) return pageRows;
        const seen = new Set(previous.map((row) => row.id));
        return [...previous, ...pageRows.filter((row) => !seen.has(row.id))];
      });
      setHasMore(deductions.length === PAGE_SIZE);
      setOffset(from + PAGE_SIZE);
    } catch (caught: any) {
      setError(caught?.message ?? "تعذر تحميل سجل الخصومات");
    } finally {
      if (firstPage) setLoading(false);
      else setLoadingMore(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("ar-EG");
    if (!term) return rows;
    return rows.filter((row) => [row.workerName, row.workerPhone, row.reason, row.void_reason ?? "", String(row.amount)]
      .some((value) => value.toLocaleLowerCase("ar-EG").includes(term)));
  }, [rows, search]);
  const total = filtered.reduce((sum, row) => sum + (row.voided_at ? 0 : Number(row.amount || 0)), 0);

  async function reverseDeduction() {
    if (!reversing) return;
    const reason = reverseReason.trim();
    if (reason.length < 3 || reason.length > 500) {
      setError("اكتب سببًا واضحًا من 3 إلى 500 حرف.");
      return;
    }
    setError("");
    setReverseBusy(true);
    try {
      const { error: rpcError } = await supabase.rpc("reverse_worker_deduction", {
        p_deduction_id: reversing.id,
        p_reason: reason,
      });
      if (rpcError) throw rpcError;
      setRows((previous) => previous.map((row) => row.id === reversing.id
        ? { ...row, voided_at: new Date().toISOString(), void_reason: reason }
        : row));
      setMessage(`تم إلغاء خصم ${money(reversing.amount)} وإرجاعه إلى رصيد ${reversing.workerName}. سُجّل سبب الإلغاء للمراجعة.`);
      setReversing(null);
      setReverseReason("");
    } catch (caught: any) {
      setError(caught?.message ?? "تعذر إلغاء الخصم؛ لم يتغير السجل المالي.");
    } finally {
      setReverseBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <div className="card-title">
          <span className="icon-label">
            <AppIcon name="fileMinus" size={18} />
            <span>سجل الخصومات — على الحساب العام للعامل</span>
          </span>
          <button className="btn btn-sm" onClick={() => void load()} disabled={loading}>
            {loading ? "جاري التحميل…" : "تحديث"}
          </button>
        </div>
        <p className="small muted" style={{ lineHeight: 1.7, marginTop: -6 }}>
          الخصومات تخص رصيد العامل العام ولا تتكرر حسب مشاريعه. الحركات لا تُحذف؛ عند الخطأ ألغِ القيد مع توضيح السبب، وسيُحفظ الأثر ويُحدّث الرصيد.
        </p>
        <label className="field">
          <span className="label">ابحث باسم العامل أو رقمه أو سبب الخصم</span>
          <input
            className="input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="مثال: اسم العامل أو سبب الخصم"
            aria-label="البحث في سجل الخصومات"
          />
        </label>
        <div className="stats">
          <div className="stat"><div className="label">سجلات معروضة</div><div className="value">{filtered.length}</div></div>
          <div className="stat"><div className="label">الخصومات الفعالة المعروضة</div><div className="value red">{money(total)}</div></div>
        </div>
        {hasMore && <p className="small muted">يوجد سجلات أقدم؛ استخدم زر التحميل أسفل القائمة.</p>}
      </div>

      {error && <div className="alert error" role="alert">{error} <button className="btn btn-sm" onClick={() => void load()}>إعادة المحاولة</button></div>}
      {message && <div className="alert success" role="status">{message}<button className="btn btn-sm" onClick={() => setMessage("")}>إغلاق</button></div>}
      {loading && rows.length === 0 ? (
        <div className="empty" role="status">جاري تحميل سجل الخصومات…</div>
      ) : filtered.length === 0 ? (
        <div className="card center muted">{rows.length ? "مفيش خصومات مطابقة للبحث." : "مفيش خصومات مسجلة."}</div>
      ) : (
        <div className="card deduction-list">
          {filtered.map((row) => (
            <article className="deduction-row" key={row.id}>
              <div className="deduction-main">
                <div className="deduction-worker">{row.workerName}</div>
                {row.workerPhone && <div className="small muted num" dir="ltr">{row.workerPhone}</div>}
              </div>
              <div className="deduction-amount num">
                {row.voided_at ? <span className="badge gray">ملغي</span> : <>− {money(row.amount)}</>}
              </div>
              <div className="deduction-reason">
                {row.reason}
                {row.void_reason && <div className="small muted">سبب الإلغاء: {row.void_reason}</div>}
              </div>
              <div className="small muted deduction-meta">
                <time dateTime={row.created_at}>{formatDate(row.created_at)}</time>
                <span>سجّله: {row.creatorName}</span>
              </div>
              {!row.voided_at && (
                <button className="btn btn-ghost" onClick={() => { setReversing(row); setReverseReason(""); setError(""); }}>
                  إلغاء/تصحيح الخصم
                </button>
              )}
            </article>
          ))}
        </div>
      )}
      {hasMore && <button className="btn btn-block mb" onClick={() => void load(offset)} disabled={loadingMore}>{loadingMore ? "جاري تحميل سجلات أقدم…" : "تحميل سجلات أقدم"}</button>}

      {reversing && (
        <Modal centered title="إلغاء/تصحيح خصم" onClose={() => { if (!reverseBusy) setReversing(null); }}>
          <div className="alert info" role="note">
            سيُعاد مبلغ {money(reversing.amount)} إلى رصيد {reversing.workerName}. لن يُحذف القيد الأصلي؛ سيظل ظاهرًا كملغي مع سبب الإلغاء في كشف العامل وسجل المراجعة.
          </div>
          <label className="field">
            <span className="label">سبب الإلغاء (3 أحرف على الأقل)</span>
            <textarea
              className="input"
              rows={3}
              maxLength={500}
              value={reverseReason}
              onChange={(event) => setReverseReason(event.target.value)}
              placeholder="مثال: أُدخل المبلغ بالخطأ، وسيُسجّل المبلغ الصحيح في قيد مستقل"
              aria-label="سبب إلغاء الخصم"
            />
          </label>
          <div className="row">
            <button className="btn btn-ghost" onClick={() => setReversing(null)} disabled={reverseBusy}>رجوع</button>
            <button className="btn btn-danger" onClick={() => void reverseDeduction()} disabled={reverseBusy || reverseReason.trim().length < 3}>
              {reverseBusy ? "جاري الحفظ…" : "تأكيد الإلغاء"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
