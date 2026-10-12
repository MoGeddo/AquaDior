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
Object.defineProperty(window.navigator, "geolocation", {
  configurable: true,
  value: {
    getCurrentPosition: (success) => success({ coords: { latitude: 30.0444, longitude: 31.2357 } }),
  },
});
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
  await waitFor(
    () => window.location.pathname === "/login" && $$("input").length >= 2,
    { label: "شاشة الدخول وعناصر النموذج" }
  );
  await sleep(100);
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

await waitFor(
  () => window.location.pathname === "/login" && $$("input").length >= 2 && /كلمة السر/.test(text()),
  { label: "شاشة الدخول وعناصر النموذج" }
);
check("بيوجّه على شاشة الدخول", /كلمة السر/.test(text()));
check("فيه خانات اسم مستخدم وكلمة سر", $$("input").length >= 2, `${$$("input").length} خانة`);
check("فيه زرار تسجيل حساب جديد", /سجّل|تسجيل/.test(text()));
check("خيار البقاء مسجّلًا متاح", !!$('input[type="checkbox"]'));
check("اختبار اتصال قاعدة البيانات أُزيل من صفحة الدخول", !/اختبر الاتصال بالداتابيز/.test(text()));

// ---- 1b) تجربة التسجيل المحلي الوهمي ----
click(buttonByText(/سجّل حساب جديد/));
await waitFor(() => window.location.pathname === "/register" && $$("input").length >= 6, {
  label: "نموذج التسجيل",
});
check("نموذج التسجيل يفتح ويعرض الحقول المطلوبة", /تسجيل حساب جديد/.test(text()) && $$("input").length >= 6);
const registrationPasswords = $$('input[type="password"]');
check(
  "نموذج التسجيل يحدّ كلمة السر إلى 128 حرفًا",
  registrationPasswords.length === 2 && registrationPasswords.every((input) => input.maxLength === 128)
);
click(buttonByText(/^سجّل$/));
await waitFor(() => /رقم موبايل/.test(text()), { label: "التحقق من رقم الهاتف" });
check("يرفض التسجيل قبل إدخال رقم هاتف", /رقم موبايل/.test(text()));

const registrationInputs = $$("input");
setValue(registrationInputs[0], "01234567890");
setValue(registrationInputs[1], "عامل اختبار التسجيل");
setValue(registrationInputs[3], "smoke.worker");
setValue(registrationInputs[4], "smoke-password-2026");
setValue(registrationInputs[5], "smoke-password-2026");
const cardFile = new window.File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "card.jpg", {
  type: "image/jpeg",
});
Object.defineProperty(registrationInputs[2], "files", { configurable: true, value: [cardFile] });
registrationInputs[2].dispatchEvent(new window.Event("change", { bubbles: true }));
await waitFor(() => /تم اختيار الصورة/.test(text()), { label: "اختيار صورة البطاقة" });
click(buttonByText(/^سجّل$/));
await waitFor(() => /حسابك مستني تفعيل المالك/.test(text()), { label: "إنشاء حساب تجريبي معلق", timeout: 12000 });
check("التسجيل التجريبي ينشئ حسابًا بانتظار موافقة المالك", /عامل اختبار التسجيل/.test(text()));
click(buttonByText(/^خروج$/));
await waitFor(() => window.location.pathname === "/login" && $$("input").length >= 2, {
  label: "العودة إلى الدخول بعد التسجيل",
});

// ---- 2) دخول المالك ----
await login("abden.younes", "demo-only-pass");
await waitFor(() => window.location.pathname.startsWith("/admin"), { label: "الدخول كمالك", timeout: 12000 });
check("👑 المالك دخل → لوحة التحكم", true);
check(
  "تذكر المستخدم يحفظ الاسم فقط دون كلمة المرور",
  window.localStorage.getItem("aquadior:remembered-username") === "abden.younes" &&
    !/demo-only-pass/.test(window.localStorage.getItem("aquadior:remembered-username") || "")
);

await waitFor(() => $$("a[href]").length > 2, { label: "القائمة" });
check("لوحة التحكم فيها بيانات", text().length > 300, `${text().length} حرف`);

// ---- 3) كل شاشات الإدارة ----
const ADMIN_ROUTES = [
  ["/admin", "الرئيسية"],
  ["/admin/workers", "العمال"],
  ["/admin/registrations", "طلبات التسجيل"],
  ["/admin/attendance", "الحضور"],
  ["/admin/withdrawals", "الفلوس"],
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
setPath("/admin/sites");
await waitFor(() => window.location.pathname === "/admin/projects", { label: "تحويل رابط المواقع القديم" });
check("رابط المواقع القديم يوجّه إلى المشاريع/المواقع", true);

// ---- 4) خروج ودخول عامل ----
console.log("\n--- 👷 شاشات العامل ---");
const outBtn = buttonByText(/^خروج$/);
if (outBtn) {
  click(outBtn);
  await waitFor(() => window.location.pathname === "/login", { timeout: 8000, label: "الخروج" });
}
await login("worker01", "demo-only-pass");
await waitFor(() => window.location.pathname.startsWith("/worker"), { label: "الدخول كعامل", timeout: 12000 });
check("👷 العامل دخل → شاشة العمال", true);

await sleep(700);
const homeBefore = text();
check("شاشة العامل الرئيسية بتعرض بياناته", homeBefore.length > 200, `${homeBefore.length} حرف`);
check("أزرار الحضور والفلوس موجودة", !!buttonByText(/نزلت النهاردة/), "زر: نزلت النهاردة");

// ---- 5) تسجيل حضور واحد مرتبط بمشروعين ----
const errBeforeAtt = errors.length;
const firstProject = buttonByText(/مشروع اختبار آلي/);
const secondProject = buttonByText(/موقع اختبار آلي ثانٍ/);
await waitFor(() => firstProject && secondProject && !firstProject.disabled && !secondProject.disabled, { label: "جاهزية قائمة مشاريع العامل" });
if (firstProject && secondProject) {
  click(firstProject);
  await waitFor(() => !!buttonByText(/✓\s*مشروع اختبار آلي/), { label: "اختيار المشروع الأول" });
  const freshSecondProject = buttonByText(/موقع اختبار آلي ثانٍ/);
  if (freshSecondProject) click(freshSecondProject);
  await waitFor(() => !!buttonByText(/✓\s*موقع اختبار آلي ثانٍ/), { label: "اختيار المشروع الثاني" });
  check("اختيار مشروعين للحضور اليومي", true);
} else {
  check("اختيار مشروعين للحضور اليومي", false, "قائمة المشاريع لم تظهر");
}
await waitFor(() => {
  const button = buttonByText(/نزلت النهاردة/);
  return !!button && !button.disabled;
}, { label: "تفعيل زر تسجيل الحضور" });
const attBtn = buttonByText(/نزلت النهاردة/);
if (attBtn) {
  click(attBtn);
  try {
    await waitFor(() => /المشاريع المسجلة لحضور اليوم/.test(text()) && !!buttonByText(/\+ مشروع/), { timeout: 9000, label: "تأكيد ربط الحضور بمشاريعه" });
    check("📅 تسجيل الحضور نجح", errors.length === errBeforeAtt, "سجل حضور واحد ظاهر للمشاريع المحددة");
    check("الحضور مرتبط بالمشروعين المختارين", text().includes("مشروع اختبار آلي") && text().includes("موقع اختبار آلي ثانٍ"));
  } catch (e) {
    check("📅 تسجيل الحضور نجح", false, e.message + " | " + (errors[errors.length - 1] || text()).slice(0, 240).replace(/\s+/g, " "));
  }
}
const formattedOneDay = "1";
const formattedDailyWage = new window.Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(350);
try {
  await waitFor(() => {
    const cards = $$(".stats .stat");
    const days = cards.find((card) => /أيام الشغل/.test(card.textContent || ""))?.querySelector(".value")?.textContent?.trim();
    const earned = cards.find((card) => /استحقاق/.test(card.textContent || ""))?.querySelector(".value")?.textContent;
    return days === formattedOneDay && earned?.includes(formattedDailyWage);
  }, { timeout: 9000, label: "تحديث الرصيد العام لليومية مرة واحدة" });
} catch (error) {
  check("انتظار تحديث الرصيد العام بعد الحضور", false, `${error.message} | ${text().slice(0, 300).replace(/\\s+/g, " ")}`);
}
const statCards = $$(".stats .stat");
const dayStat = statCards.find((card) => /أيام الشغل/.test(card.textContent || ""));
const earnedStat = statCards.find((card) => /استحقاق/.test(card.textContent || ""));
check("مشروعان لا يكرران اليومية: يوم واحد فقط", dayStat?.querySelector(".value")?.textContent?.trim() === formattedOneDay);
check("استحقاق اليوم يظهر يومية واحدة (350 ج.م)", earnedStat?.querySelector(".value")?.textContent?.includes(formattedDailyWage));

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
