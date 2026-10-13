type ErrorLike = {
  message?: unknown;
  code?: unknown;
};

function getMessage(error: unknown): string {
  if (typeof error === "string") return error.trim();
  if (!error || typeof error !== "object") return "";
  const message = (error as ErrorLike).message;
  return typeof message === "string" ? message.trim() : "";
}

/** يمنع ظهور رسائل الخادم الإنجليزية داخل واجهة التطبيق. */
export function arabicError(error: unknown, fallback: string): string {
  const message = getMessage(error);
  if (!message) return fallback;

  // Keep clear Arabic server messages, including validation messages from SQL.
  if (!/[A-Za-z]{2,}/.test(message)) return message;

  const lower = message.toLowerCase();
  const code = error && typeof error === "object"
    ? String((error as ErrorLike).code ?? "")
    : "";

  if (/invalid login credentials|invalid credentials/.test(lower)) {
    return "اسم المستخدم أو كلمة السر غير صحيحة.";
  }
  if (/email not confirmed|email.*not.*confirm/.test(lower)) {
    return "الحساب لم يُفعّل بعد؛ اطلب من الإدارة تفعيله ثم حاول مرة أخرى.";
  }
  if (/rate limit|too many requests/.test(lower)) {
    return "محاولات كثيرة؛ انتظر قليلًا ثم حاول مرة أخرى.";
  }
  if (/failed to fetch|network|offline|load failed|connection|timeout|timed out/.test(lower)) {
    return "تعذر الاتصال بالخادم؛ تحقق من الاتصال وحاول مرة أخرى.";
  }
  if (code === "42501" || /permission denied|not authorized|unauthorized|row.level security|insufficient privilege/.test(lower)) {
    return "لا تملك صلاحية تنفيذ هذا الإجراء.";
  }
  if (code === "23505" || /duplicate key|unique constraint|already exists/.test(lower)) {
    return "هذه البيانات مسجلة بالفعل.";
  }
  if (/not found|does not exist|schema cache|could not find/.test(lower)) {
    return fallback;
  }
  return fallback;
}
