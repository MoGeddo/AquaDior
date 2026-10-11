// ============================================================
//  🧪 اختبار تشغيل حقيقي للتطبيق (Smoke Test)
//  ------------------------------------------------------------
//  بيفتح التطبيق جوه متصفح وهمي (jsdom) ويتأكد إن:
//    • التطبيق بيفتح وشاشة الدخول بتظهر
//    • الدخول بحساب المالك بيودّي لوحة التحكم
//    • كل شاشات الإدارة بتفتح من غير أي خطأ
//    • العامل يقدر يسجّل حضوره وياخد فلوس
//    • القاعدة "العامل ما ياخدش أكتر من استحقاقه" مطبّقة
//
//  التشغيل:  npm run test:smoke
// ============================================================
import { readFileSync, existsSync } from "node:fs";
import { JSDOM } from "jsdom";
import "fake-indexeddb/auto";

const BUNDLE = process.env.SMOKE_BUNDLE || new URL("../.smoke-out/app.js", import.meta.url).pathname;
if (!existsSync(BUNDLE)) {
  console.error(`❌ مفيش ملف مبني في: ${BUNDLE}\n   شغّل: npm run test:smoke`);
  process.exit(1);
}

const errors = [];
const results = [];

const dom = new JSDOM(
  `<!doctype html><html dir="rtl" lang="ar"><head></head><body><div id="root"></div></body></html>`,
  { url: "http://localhost:5173/", runScripts: "dangerously", pretendToBeVisual: true }
);
const { window } = dom;

// ---- polyfills اللي jsdom ناقصها ----
window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
window.scrollTo = () => {};
window.alert = () => {};
window.confirm = () => true;
window.URL.createObjectURL = () => "blob:fake";
window.indexedDB = globalThis.indexedDB;
window.IDBKeyRange = globalThis.IDBKeyRange;
window.IDBDatabase = globalThis.IDBDatabase;
window.IDBTransaction = globalThis.IDBTransaction;
window.IDBRequest = globalThis.IDBRequest;

window.addEventListener("error", (e) => errors.push(e.error?.stack || e.message));
window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason?.stack || e.reason)));

const origError = window.console.error;
window.console.error = (...a) => {
  const msg = a.map((x) => x?.stack || String(x)).join(" ");
  if (!/React Router Future Flag|Download the React DevTools|Warning: /.test(msg)) errors.push(msg);
  origError.apply(window.console, a);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s) => window.document.querySelector(s);
const $$ = (s) => [...window.document.querySelectorAll(s)];
const text = () => window.document.getElementById("root")?.textContent || "";
const setPath = (p) => {
  window.history.pushState({}, "", p);
  window.dispatchEvent(new window.PopStateEvent("popstate"));
};

function setValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
  el.dispatchEvent(new window.Event("change", { bubbles: true }));
}
function click(el) {
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
}
function buttonByText(re) {
  return $$("button").find((b) => re.test(b.textContent || ""));
}
async function waitFor(fn, { timeout = 8000, label = "شرط" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (fn()) return true;
    } catch {}
    await sleep(60);
  }
  throw new Error(`⏱️ استنيت «${label}» ${timeout}ms ومحصلش`);
}
function check(name, ok, extra = "") {
  results.push({ name, ok, extra });
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`);
}
function findAmountInput() {
  // خانة المبلغ: inputMode=decimal أو placeholder="0"
  return (
    $$("input").find((i) => i.getAttribute("inputmode") === "decimal") ||
    $$("input").find((i) => i.getAttribute("placeholder") === "0") ||
    $('input[type="number"]')
  );
}
async function login(username, password) {
  await waitFor(() => window.location.pathname === "/login", { label: "شاشة الدخول" });
  await sleep(200);
  const ins = $$("input");
  if (ins.length < 2) throw new Error("مفيش خانات دخول");
  setValue(ins[0], username);
  setValue(ins[1], password);
  await sleep(150);
  const btn = buttonByText(/دخول/);
  if (!btn) throw new Error("مفيش زرار دخول");
  click(btn);
}

// ============================================================
console.log("\n🏁 اختبار تشغيل التطبيق\n" + "=".repeat(64));

const script = window.document.createElement("script");
script.textContent = readFileSync(BUNDLE, "utf8");
window.document.head.appendChild(script);
script.remove();

// ---- 1) الإقلاع ----
await waitFor(() => text().trim().length > 0, { label: "التطبيق يفتح", timeout: 15000 });
check("التطبيق بيقلع ويرسم الشاشة", true, `${text().trim().length} حرف`);

await waitFor(() => window.location.pathname === "/login" || /كلمة السر/.test(text()), { label: "شاشة الدخول" });
check("بيوجّه على شاشة الدخول", /كلمة السر/.test(text()));
check("فيه خانات اسم مستخدم وكلمة سر", $$("input").length >= 2, `${$$("input").length} خانة`);
check("فيه زرار تسجيل حساب جديد", /سجّل|تسجيل/.test(text()));

// ---- 2) دخول المالك ----
await login("abden.younes", "Qn&112233#Do");
await waitFor(() => window.location.pathname.startsWith("/admin"), { label: "الدخول كمالك", timeout: 12000 });
check("👑 المالك دخل → لوحة التحكم", true);

await waitFor(() => $$("a[href]").length > 2, { label: "القائمة" });
check("لوحة التحكم فيها بيانات", text().length > 300, `${text().length} حرف`);

// ---- 3) كل شاشات الإدارة ----
const ADMIN_ROUTES = [
  ["/admin", "الرئيسية"],
  ["/admin/workers", "العمال"],
  ["/admin/registrations", "طلبات التسجيل"],
  ["/admin/attendance", "الحضور"],
  ["/admin/withdrawals", "الفلوس"],
  ["/admin/sites", "المواقع"],
  ["/admin/projects", "المشاريع"],
  ["/admin/settlements", "التسويات"],
  ["/admin/audit", "سجل التعديلات"],
  ["/admin/settings", "الإعدادات"],
  ["/admin/developer", "صفحة المطوّر"],
];
console.log("\n--- 💼 شاشات الإدارة ---");
for (const [route, label] of ADMIN_ROUTES) {
  const errCountBefore = errors.length;
  setPath(route);
  try {
    await waitFor(() => window.location.pathname === route, { timeout: 4000, label: route });
    await sleep(500);
    const t = text();
    const crashed = /Cannot read|Application error|خطأ غير متوقع/i.test(t);
    const ok = t.trim().length > 50 && !crashed && errors.length === errCountBefore;
    check(`${label}`, ok, ok ? `${t.trim().length} حرف` : (errors[errors.length - 1] || t).slice(0, 150).replace(/\s+/g, " "));
  } catch (e) {
    check(`${label}`, false, e.message);
  }
}

// ---- 4) خروج ودخول عامل ----
console.log("\n--- 👷 شاشات العامل ---");
const outBtn = buttonByText(/^خروج$/);
if (outBtn) {
  click(outBtn);
  await waitFor(() => window.location.pathname === "/login", { timeout: 8000, label: "الخروج" });
}
await login("worker01", "Qn&112233#Do");
await waitFor(() => window.location.pathname.startsWith("/worker"), { label: "الدخول كعامل", timeout: 12000 });
check("👷 العامل دخل → شاشة العمال", true);

await sleep(700);
const homeBefore = text();
check("شاشة العامل الرئيسية بتعرض بياناته", homeBefore.length > 200, `${homeBefore.length} حرف`);
check("أزرار الحضور والفلوس موجودة", !!buttonByText(/نزلت النهاردة/), "زر: نزلت النهاردة");

// ---- 5) تسجيل حضور ----
const errBeforeAtt = errors.length;
const attBtn = buttonByText(/نزلت النهاردة/);
if (attBtn) {
  click(attBtn);
  try {
    await waitFor(() => /✓ نزلت|نزلت خلاص|المواقع اللي سجّلتها|تم/i.test(text()), { timeout: 9000, label: "تسجيل الحضور" });
    check("📅 تسجيل الحضور نجح", errors.length === errBeforeAtt, text().includes("نزلت") ? "الشاشة اتحدّثت" : "");
  } catch (e) {
    check("📅 تسجيل الحضور نجح", false, e.message + " | " + (errors[errors.length - 1] || "").slice(0, 120));
  }
}

// ---- 6) أخذ فلوس (مبلغ صغير — المفروض يعدّي) ----
await sleep(600);
const moneyBtn = buttonByText(/خدت فلوس/);
if (moneyBtn) {
  const errBefore = errors.length;
  click(moneyBtn);
  await sleep(500);
  const amountInput = findAmountInput();
  if (amountInput) {
    setValue(amountInput, "100");
    await sleep(250);
    const okBtn = buttonByText(/^تم$/);
    if (okBtn) {
      click(okBtn);
      try {
        await waitFor(() => !/جاري التسجيل/.test(text()) && !$(".modal"), { timeout: 9000, label: "تسجيل الفلوس" });
        check("💵 أخذ فلوس (100 ج) اتسجّل", errors.length === errBefore);
      } catch (e) {
        check("💵 أخذ فلوس (100 ج) اتسجّل", false, e.message);
      }
    } else check("💵 أخذ فلوس (100 ج) اتسجّل", false, "مفيش زرار «تم»");
  } else check("💵 أخذ فلوس (100 ج) اتسجّل", false, "مفيش خانة المبلغ");
} else {
  check("💵 أخذ فلوس (100 ج) اتسجّل", false, "زر «خدت فلوس» مش ظاهر (يمكن الحضور مسجّلش)");
}

// ---- 7) القاعدة: ما ياخدش أكتر من استحقاقه ----
await sleep(500);
const moneyBtn2 = buttonByText(/خدت فلوس/);
if (moneyBtn2) {
  const errBefore = errors.length;
  click(moneyBtn2);
  await sleep(500);
  const amt = findAmountInput();
  if (amt) {
    setValue(amt, "999999");
    await sleep(250);
    const okBtn = buttonByText(/^تم$/);
    if (okBtn) {
      click(okBtn);
      await sleep(1500);
      const t = text();
      const rejected = /أكتر|أكبر|مش مسموح|استحقاق|متبقي|الحد|كافي|ما ينفعش|خطأ|مرفوض/i.test(t);
      check("🛡️ رفض مبلغ أكبر من استحقاقه", rejected && errors.length === errBefore, rejected ? "ظهر رسالة رفض واضحة" : "⚠️ مفيش رسالة رفض!");
    }
  }
} else {
  check("🛡️ رفض مبلغ أكبر من استحقاقه", false, "زر «خدت فلوس» مش ظاهر");
}

// ---- 8) كشف الحساب ----
setPath("/worker/statement");
await sleep(900);
check("📄 كشف الحساب بيفتح", text().length > 150 && errors.length === 0, `${text().length} حرف`);

// ============================================================
console.log("\n" + "=".repeat(64));
const failed = results.filter((r) => !r.ok);
console.log(`📊 النتيجة: ${results.length - failed.length}/${results.length} نجح`);
if (errors.length) {
  console.log(`\n⚠️ ${errors.length} خطأ وقت التشغيل:`);
  [...new Set(errors)].slice(0, 10).forEach((e) => console.log("   • " + e.split("\n")[0].slice(0, 220)));
}
if (failed.length) {
  console.log("\n❌ اللي فشل:");
  failed.forEach((f) => console.log(`   • ${f.name}${f.extra ? " — " + f.extra : ""}`));
}
console.log("=".repeat(64) + "\n");
process.exit(failed.length ? 1 : 0);
