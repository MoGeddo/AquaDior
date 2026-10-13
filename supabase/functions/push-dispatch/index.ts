// Send queued in-app notification alerts through OneSignal.
// Required Edge Function secrets: ONESIGNAL_APP_ID, ONESIGNAL_REST_API_KEY,
// PUSH_DISPATCH_SECRET. Supabase provides SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY to Edge Functions.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const oneSignalAppId = Deno.env.get("ONESIGNAL_APP_ID");
const oneSignalRestKey = Deno.env.get("ONESIGNAL_REST_API_KEY");
const dispatchSecret = Deno.env.get("PUSH_DISPATCH_SECRET");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase Edge Function environment configuration");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

function safeProviderError(value: string): string {
  return value.replace(/(Authorization\s*:\s*Key\s+)[^\s"']+/gi, "$1[redacted]").slice(0, 500);
}

async function sendPush(userId: string): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch("https://api.onesignal.com/notifications?c=push", {
    method: "POST",
    headers: {
      Authorization: `Key ${oneSignalRestKey}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    signal: AbortSignal.timeout(12_000),
    body: JSON.stringify({
      app_id: oneSignalAppId,
      target_channel: "push",
      include_aliases: { external_id: [userId] },
      headings: { ar: "أكوا ديور", en: "Aqua Dior" },
      // Keep lock-screen content generic: balances, deductions, names, and GPS
      // details stay inside the authenticated application.
      contents: {
        ar: "لديك إشعار جديد. افتح التطبيق للاطلاع على التفاصيل.",
        en: "You have a new notification. Open the app for details.",
      },
    }),
  });

  if (response.ok) return { ok: true };
  return { ok: false, error: safeProviderError(await response.text()) || `OneSignal HTTP ${response.status}` };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  if (!dispatchSecret || !oneSignalAppId || !oneSignalRestKey) {
    return Response.json({ ok: false, error: "push_not_configured" }, { status: 503 });
  }

  const suppliedSecret = request.headers.get("x-push-secret") ?? "";
  if (!constantTimeEqual(suppliedSecret, dispatchSecret)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { data: deliveries, error: claimError } = await supabase.rpc("claim_push_deliveries", {
    p_limit: 10,
  });
  if (claimError) {
    console.error("Failed to claim push deliveries", claimError.message);
    return Response.json({ ok: false, error: "queue_unavailable" }, { status: 500 });
  }

  const outcomes = await Promise.all((deliveries ?? []).map(async (delivery: any) => {
    let result: { ok: boolean; error?: string };
    try {
      result = await sendPush(String(delivery.user_id));
    } catch (error) {
      result = { ok: false, error: safeProviderError(String(error)) };
    }

    const { error: completionError } = await supabase.rpc("complete_push_delivery", {
      p_queue_id: delivery.queue_id,
      p_success: result.ok,
      p_error: result.error ?? null,
    });
    if (completionError) {
      // The row is still recoverable: stale processing claims are reclaimed after five minutes.
      console.error("Failed to finish push delivery", delivery.queue_id, completionError.message);
      return false;
    }
    return result.ok;
  }));
  const accepted = outcomes.filter(Boolean).length;
  const retrying = outcomes.length - accepted;

  return Response.json({ ok: true, claimed: deliveries?.length ?? 0, accepted, retrying });
});
