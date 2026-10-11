// supabase/functions/notify-telegram/index.ts
// Edge Function مجانية — بتبعّت الإشعارات والتقارير على تليجرام
// Deploy:  supabase functions deploy notify-telegram

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const EMOJI: Record<string, string> = {
  attendance_new: "✅",
  attendance_edit: "⚠️",
  withdrawal_auto: "💵",
  withdrawal_pending: "🔔",
  withdrawal_decided: "📝",
  deduction_new: "➖",
};

async function tg(token: string, chat: string, text: string) {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chat,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  return r.ok;
}

// ============ تقرير يومي ============
async function dailyReport(token: string, chat: string, currency: string) {
  const { data: s } = await supabase.from("daily_summary").select("*").single();
  if (!s) return false;

  const { data: absent } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("role", "worker")
    .eq("is_active", true);

  const { data: att } = await supabase
    .from("attendance")
    .select("worker_id")
    .eq("work_date", new Date().toISOString().slice(0, 10));

  const present = new Set((att ?? []).map((a: any) => a.worker_id));
  const absentNames = (absent ?? [])
    .filter((w: any) => !present.has(w.id))
    .map((w: any) => "• " + w.full_name)
    .join("\n") || "مفيش غياب 🎉";

  const text =
    `📊 <b>تقرير اليوم</b>\n\n` +
    `👷 إجمالي العمال: <b>${s.total_workers}</b>\n` +
    `✅ نزلوا النهاردة: <b>${s.present_today}</b>\n` +
    `❌ غايبين: <b>${s.absent_today}</b>\n\n` +
    `💰 فلوس اتسحبت النهاردة: <b>${s.withdrawn_today} ${currency}</b>\n` +
    `📈 استحقاق النهاردة: <b>${s.earned_today} ${currency}</b>\n\n` +
    `<b>الأسماء الغايبة:</b>\n${absentNames}`;

  return tg(token, chat, text);
}

// ============ بث الإشعارات الجديدة ============
async function broadcast() {
  const { data: tgSet } = await supabase
    .from("settings").select("value").eq("key", "telegram").single();
  const { data: appSet } = await supabase
    .from("settings").select("value").eq("key", "app").single();

  const token = tgSet?.value?.bot_token;
  const chat = tgSet?.value?.chat_id;
  if (!token || !chat) {
    return { ok: false, error: "telegram not configured" };
  }

  const mode = new URL(Deno.env.get("SUPABASE_URL")!).searchParams.get("mode");
  void mode;
  const since = tgSet?.value?.last_broadcast_at || "1970-01-01T00:00:00Z";

  const { data: notifs } = await supabase
    .from("notifications")
    .select("*")
    .gt("created_at", since)
    .order("created_at", { ascending: true })
    .limit(50);

  let sent = 0;
  for (const n of notifs ?? []) {
    const emoji = EMOJI[n.type] ?? "🔔";
    const ok = await tg(
      token,
      chat,
      `${emoji} <b>${n.title}</b>\n${n.body}`
    );
    if (ok) sent++;
  }

  if (notifs && notifs.length > 0) {
    await supabase
      .from("settings")
      .update({
        value: {
          ...tgSet.value,
          last_broadcast_at: notifs[notifs.length - 1].created_at,
        },
      })
      .eq("key", "telegram");
  }

  return { ok: true, sent };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "broadcast";

  const { data: tgSet } = await supabase
    .from("settings").select("value").eq("key", "telegram").single();
  const { data: appSet } = await supabase
    .from("settings").select("value").eq("key", "app").single();

  const token = tgSet?.value?.bot_token;
  const chat = tgSet?.value?.chat_id;
  if (!token || !chat) {
    return new Response(
      JSON.stringify({ ok: false, error: "telegram not configured" }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  let result;
  if (action === "daily") {
    result = {
      ok: await dailyReport(
        token,
        chat,
        appSet?.value?.currency ?? "ج.م"
      ),
    };
  } else {
    result = await broadcast();
  }

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
});
