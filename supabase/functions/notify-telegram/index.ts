// Supabase Edge Function for authenticated Telegram notifications and daily reports.
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN.
// Optional: TELEGRAM_CRON_SECRET and APP_ORIGIN.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const telegramToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase Edge Function environment configuration");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const EMOJI: Record<string, string> = {
  attendance_new: "✅",
  attendance_edit: "⚠️",
  withdrawal_auto: "💵",
  withdrawal_pending: "🔔",
  withdrawal_decided: "📝",
  deduction_new: "➖",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Vary": "Origin",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function sendTelegram(chatId: string, text: string): Promise<boolean> {
  if (!telegramToken) return false;
  try {
    const response = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!response.ok) return false;
    const result = await response.json();
    return result?.ok === true;
  } catch {
    return false;
  }
}

async function dailyReport(chatId: string, currency: string): Promise<boolean> {
  const { data: summary, error: summaryError } = await supabase
    .from("daily_summary")
    .select("*")
    .single();
  if (summaryError || !summary?.day) return false;

  const [{ data: workers, error: workersError }, { data: attendance, error: attendanceError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name")
        .eq("role", "worker")
        .eq("status", "active")
        .eq("is_active", true),
      supabase
        .from("attendance")
        .select("worker_id")
        .eq("work_date", summary.day),
    ]);
  if (workersError || attendanceError) return false;

  const present = new Set((attendance ?? []).map((row: any) => row.worker_id));
  const absentNames = (workers ?? [])
    .filter((worker: any) => !present.has(worker.id))
    .map((worker: any) => `• ${escapeHtml(worker.full_name)}`)
    .join("\n") || "مفيش غياب 🎉";

  const text =
    `📊 <b>تقرير اليوم — ${escapeHtml(summary.day)}</b>\n\n` +
    `👷 إجمالي العمال: <b>${summary.total_workers}</b>\n` +
    `✅ نزلوا النهاردة: <b>${summary.present_today}</b>\n` +
    `❌ غايبين: <b>${summary.absent_today}</b>\n\n` +
    `💰 فلوس اتسحبت النهاردة: <b>${summary.withdrawn_today} ${escapeHtml(currency)}</b>\n` +
    `📈 استحقاق النهاردة: <b>${summary.earned_today} ${escapeHtml(currency)}</b>\n\n` +
    `<b>الأسماء الغايبة:</b>\n${absentNames}`;

  return sendTelegram(chatId, text);
}

async function broadcast(chatId: string, telegramSettings: Record<string, unknown>) {
  const since = typeof telegramSettings.last_broadcast_at === "string"
    ? telegramSettings.last_broadcast_at
    : "1970-01-01T00:00:00.000Z";
  const lastId = typeof telegramSettings.last_broadcast_id === "string"
    ? telegramSettings.last_broadcast_id
    : "00000000-0000-0000-0000-000000000000";

  const { data: notifications, error } = await supabase
    .from("notifications")
    .select("id, type, title, body, created_at")
    .or(`created_at.gt.${since},and(created_at.eq.${since},id.gt.${lastId})`)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(50);
  if (error) return { ok: false, sent: 0 };

  let sent = 0;
  let cursor: { id: string; created_at: string } | null = null;
  for (const notification of notifications ?? []) {
    const emoji = EMOJI[notification.type] ?? "🔔";
    const text = `${emoji} <b>${escapeHtml(notification.title)}</b>\n${escapeHtml(notification.body)}`;
    if (!await sendTelegram(chatId, text)) break;
    sent++;
    cursor = { id: notification.id, created_at: notification.created_at };
  }

  if (cursor) {
    const { error: updateError } = await supabase
      .from("settings")
      .update({
        value: {
          ...telegramSettings,
          last_broadcast_at: cursor.created_at,
          last_broadcast_id: cursor.id,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("key", "telegram");
    if (updateError) return { ok: false, sent };
  }
  return { ok: true, sent };
}

async function authorize(request: Request): Promise<boolean> {
  const cronSecret = Deno.env.get("TELEGRAM_CRON_SECRET");
  if (cronSecret && request.headers.get("x-cron-secret") === cronSecret) return true;

  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return false;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return false;
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, status, is_active")
    .eq("id", data.user.id)
    .maybeSingle();
  return !profileError && Boolean(
    profile && ["owner", "manager", "developer"].includes(profile.role) &&
    profile.status === "active" && profile.is_active === true
  );
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const configuredOrigin = Deno.env.get("APP_ORIGIN");
  const requestOrigin = request.headers.get("Origin");
  if (configuredOrigin && requestOrigin && requestOrigin !== configuredOrigin) {
    return json({ ok: false, error: "origin_not_allowed" }, 403);
  }
  if (!await authorize(request)) return json({ ok: false, error: "unauthorized" }, 401);
  if (!telegramToken) return json({ ok: false, error: "telegram_not_configured" }, 503);

  let body: Record<string, unknown> = {};
  const bodyText = await request.text();
  if (bodyText.length > 4096) return json({ ok: false, error: "body_too_large" }, 413);
  if (bodyText.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ ok: false, error: "invalid_body" }, 400);
    }
    body = parsed as Record<string, unknown>;
  }
  const url = new URL(request.url);
  const action = typeof body.action === "string"
    ? body.action
    : url.searchParams.get("action") ?? "broadcast";
  if (!["test", "daily", "broadcast"].includes(action)) {
    return json({ ok: false, error: "invalid_action" }, 400);
  }

  const { data: setting, error: settingError } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "telegram")
    .maybeSingle();
  const { data: appSetting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "app")
    .maybeSingle();
  if (settingError) return json({ ok: false, error: "settings_unavailable" }, 500);

  const telegramSettings = (setting?.value ?? {}) as Record<string, unknown>;
  const chatId = typeof telegramSettings.chat_id === "string" ? telegramSettings.chat_id.trim() : "";
  if (!chatId) return json({ ok: false, error: "telegram_chat_not_configured" }, 503);

  if (action === "test") {
    const ok = await sendTelegram(chatId, "✅ اختبار من تطبيق أكوا ديور للمقاولات — الإشعارات شغالة!");
    return json({ ok }, ok ? 200 : 502);
  }
  if (action === "daily") {
    const currency = typeof appSetting?.value?.currency === "string" ? appSetting.value.currency : "ج.م";
    const ok = await dailyReport(chatId, currency);
    return json({ ok }, ok ? 200 : 502);
  }
  return json(await broadcast(chatId, telegramSettings));
});
