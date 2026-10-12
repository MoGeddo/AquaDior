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
const geolocationCalls = { count: 0 };
Object.defineProperty(window.navigator, "geolocation", {
  configurable: true,
  value: {
    getCurrentPosition: (success) => {
      geolocationCalls.count += 1;
      success({ coords: { latitude: 30.0444, longitude: 31.2357 } });
    },
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
function setNetworkOnline(online) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: online });
  window.dispatchEvent(new window.Event(online ? "online" : "offline"));
}
async function readPendingOperations() {
  return new Promise((resolve, reject) => {
    const open = window.indexedDB.open("ommal-app");
    open.onerror = () => reject(open.error || new Error("تعذر فتح طابور العمل بلا إنترنت"));
    open.onsuccess = () => {
      const database = open.result;
      if (!database.objectStoreNames.contains("queue")) {
        database.close();
        resolve([]);
        return;
      }
      const transaction = database.transaction("queue", "readonly");
      const request = transaction.objectStore("queue").getAll();
      request.onerror = () => { database.close(); reject(request.error || new Error("تعذر قراءة طابور العمل بلا إنترنت")); };
      request.onsuccess = () => { database.close(); resolve(request.result ?? []); };
    };
  });
}
async function seedLegacyGpsAttendanceOperation() {
  return new Promise((resolve, reject) => {
    const open = window.indexedDB.open("ommal-app", 2);
    open.onupgradeneeded = () => {
      const database = open.result;
      if (database.objectStoreNames.contains("queue")) return;
      const queue = database.createObjectStore("queue", { keyPath: "id", autoIncrement: true });
      queue.createIndex("table", "table");
      queue.createIndex("created_at", "created_at");
      queue.createIndex("owner_id", "owner_id");
      queue.createIndex("tries", "tries");
    };
    open.onerror = () => reject(open.error || new Error("تعذر تجهيز طابور الترحيل التجريبي"));
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction("queue", "readwrite");
      const request = transaction.objectStore("queue").add({
        table: "rpc",
        op: "insert",
        payload: {
          fn: "register_attendance_multi",
          args: {
            p_worker_id: "legacy-queue-worker",
            p_project_ids: ["legacy-queue-project"],
            p_lat: 30.0444,
            p_lng: 31.2357,
          },
        },
        created_at: Date.now(),
        owner_id: "legacy-queue-worker",
        tries: 0,
      });
      let operationId;
      request.onerror = () => { database.close(); reject(request.error || new Error("تعذر إضافة عينة الطابور")); };
      request.onsuccess = () => { operationId = request.result; };
      transaction.onerror = () => { database.close(); reject(transaction.error || new Error("تعذر حفظ عينة الطابور")); };
      transaction.oncomplete = () => { database.close(); resolve(operationId); };
    };
  });
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

const queueSanitized = new Promise((resolve) => window.addEventListener("queue-updated", resolve, { once: true }));
const legacyGpsOperationId = await seedLegacyGpsAttendanceOperation();
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
const queuePrivacyReady = await Promise.race([queueSanitized.then(() => true), sleep(5000).then(() => false)]);
const legacyGpsOperation = (await readPendingOperations()).find((operation) => operation.id === legacyGpsOperationId);
const legacyGpsArgs = legacyGpsOperation?.payload?.args ?? {};
check(
  "ترقية التطبيق تزيل إحداثيات GPS القديمة من طابور الحضور",
  queuePrivacyReady && !!legacyGpsOperation && !("p_lat" in legacyGpsArgs) && !("p_lng" in legacyGpsArgs),
);

// ---- 1b) تجربة التسجيل المحلي الوهمي ----
click(buttonByText(/سجّل حساب جديد/));
await waitFor(() => window.location.pathname === "/register" && $$("input").length >= 6, {
  label: "نموذج التسجيل",
});
check("نموذج التسجيل يفتح ويعرض الحقول المطلوبة", /تسجيل حساب جديد/.test(text()) && $$("input").length >= 6);
check(
  "التسجيل يطلب اسم مستخدم ولا يطلب بريدًا أو يعرض النطاق الداخلي",
  $$('input[type="email"]').length === 0 && !/@ommal\.app/i.test(text()) && /بدون بريد إلكتروني/.test(text())
);
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
  ["/admin/deductions", "الخصومات"],
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
    if (route === "/admin/settings") {
      check("خيار تسجيل موقع الحضور أزيل من الإعدادات", !t.includes("تسجيل موقع الحضور (GPS)"));
    }
  } catch (e) {
    check(`${label}`, false, e.message);
  }
}
setPath("/admin/sites");
await waitFor(() => window.location.pathname === "/admin/projects", { label: "تحويل رابط المواقع القديم" });
check("رابط المواقع القديم يوجّه إلى المشاريع/المواقع", true);

// ---- 3b) أدوات الحذف تظهر للمطوّر فقط ----
setPath("/admin/workers");
await waitFor(
  () => window.location.pathname === "/admin/workers" && $$("input").some((input) => input.placeholder.includes("ابحث بالاسم أو الموبايل")),
  { label: "قائمة العمال للمالك" }
);
check("زر حذف العامل مخفي عن المالك", !buttonByText(/🗑 حذف/));
setPath("/admin/projects");
await waitFor(() => window.location.pathname === "/admin/projects" && /إزاي الأرشفة بتشتغل/.test(text()), { label: "قائمة المشاريع للمالك" });
check("الحذف النهائي للمشروع مخفي عن المالك", !buttonByText(/حذف نهائي/));

setPath("/admin/workers");
await waitFor(() => window.location.pathname === "/admin/workers" && !!buttonByText(/إضافة عامل/), { label: "إضافة عامل بلا تعيين مشروع" });
click(buttonByText(/إضافة عامل/));
await waitFor(() => $('[role="dialog"]') && /العامل يختار المشروع أو المشاريع بنفسه/.test(text()), { label: "نموذج إضافة العامل دون تعيين" });
check("المالك لا يختار مشروعًا عند إضافة العامل", !$('[role="dialog"] select') && !/مشروع\/الموقع الأول/.test($('[role="dialog"]')?.textContent || ""));
click($('[role="dialog"] [aria-label="إغلاق النافذة"]'));

await waitFor(() => $$("tbody tr").some((row) => row.textContent?.includes("عامل اختبار آلي")), { label: "صف العامل لاختبار عدم التعيين" });
const ownerWorkerRow = $$("tbody tr").find((row) => row.textContent?.includes("عامل اختبار آلي"));
const ownerEditButton = [...(ownerWorkerRow?.querySelectorAll("button") ?? [])].find((button) => /تفاصيل/.test(button.textContent || ""));
if (ownerEditButton) {
  click(ownerEditButton);
  await waitFor(() => $('[role="dialog"]') && /المشاريع المفتوحة متاحة لكل العمال/.test(text()), { label: "تفاصيل العامل دون تعيين" });
  const editDialog = $('[role="dialog"]');
  const nonStatusOptions = [...(editDialog?.querySelectorAll("select option") ?? [])].filter((option) => !["1", "0"].includes(option.value));
  check("تعديل العامل لا يعيّن مشاريع؛ كل المشاريع المفتوحة متاحة للجميع", /المشاريع المفتوحة متاحة لكل العمال/.test(editDialog?.textContent || "") && nonStatusOptions.length === 0 && !/المشاريع\/المواقع المعيّنة/.test(editDialog?.textContent || ""));
  click($('[role="dialog"] [aria-label="إغلاق النافذة"]'));
} else {
  check("تعديل العامل لا يعيّن مشاريع؛ كل المشاريع المفتوحة متاحة للجميع", false, "زر التفاصيل غير ظاهر");
}

setPath("/admin/registrations");
await waitFor(() => window.location.pathname === "/admin/registrations" && /طلبات التسجيل الجديدة/.test(text()) && $$("tbody tr").some((row) => row.textContent?.includes("عامل اختبار التسجيل")), { label: "طلب تسجيل لاختبار التفعيل دون تعيين" });
const pendingSmokeRow = $$("tbody tr").find((row) => row.textContent?.includes("عامل اختبار التسجيل"));
const activateSmokeButton = [...(pendingSmokeRow?.querySelectorAll("button") ?? [])].find((button) => /فعّل/.test(button.textContent || ""));
if (activateSmokeButton) {
  click(activateSmokeButton);
  await waitFor(() => $('[role="dialog"]') && /العامل يختار بنفسه من المشاريع المفتوحة/.test(text()), { label: "اعتماد عامل بلا تعيين" });
  check("اعتماد التسجيل يحدد اليومية فقط ولا يطلب مشروعًا", !$('[role="dialog"] select') && !/المشروع\/الموقع الأول/.test($('[role="dialog"]')?.textContent || ""));
  click($('[role="dialog"] [aria-label="إغلاق النافذة"]'));
} else {
  check("اعتماد التسجيل يحدد اليومية فقط ولا يطلب مشروعًا", false, "زر التفعيل غير ظاهر");
}

const ownerOutBtn = buttonByText(/^خروج$/);
if (ownerOutBtn) {
  click(ownerOutBtn);
  await waitFor(() => window.location.pathname === "/login", { timeout: 8000, label: "خروج المالك" });
}
await login("mostafageddo", "demo-only-pass");
await waitFor(() => window.location.pathname.startsWith("/admin"), { label: "الدخول كمطوّر", timeout: 12000 });
setPath("/admin/workers");
await waitFor(
  () => window.location.pathname === "/admin/workers" && /الحذف النهائي للعامل متاح/.test(text()),
  { label: "قائمة العمال للمطوّر" }
);
check("زر حذف العامل ظاهر للمطوّر", !!buttonByText(/🗑 حذف/));
const registrationWorkerRow = $$("tbody tr").find((row) => row.textContent?.includes("عامل اختبار التسجيل"));
const registrationDeleteButton = [...(registrationWorkerRow?.querySelectorAll("button") ?? [])]
  .find((button) => /🗑 حذف/.test(button.textContent || ""));
if (registrationDeleteButton) {
  click(registrationDeleteButton);
  await waitFor(
    () => !$$("tbody tr").some((row) => row.textContent?.includes("عامل اختبار التسجيل")),
    { label: "حذف عامل بلا سجلات من شاشة المطوّر" }
  );
  check("المطوّر يحذف عاملًا بلا سجل من داخل التطبيق", true);
} else {
  check("المطوّر يحذف عاملًا بلا سجل من داخل التطبيق", false, "لم يظهر زر الحذف في صف عامل التسجيل");
}
setPath("/admin/projects");
await waitFor(
  () => window.location.pathname === "/admin/projects" && /الحذف النهائي للمشروع متاح/.test(text()),
  { label: "قائمة المشاريع للمطوّر" }
);
check("الحذف النهائي للمشروع ظاهر للمطوّر", !!buttonByText(/حذف نهائي/));

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

const workerNotificationsButton = $('button[aria-label^="الإشعارات"]');
check("زر مركز إشعارات العامل ظاهر", !!workerNotificationsButton);
if (workerNotificationsButton) {
  click(workerNotificationsButton);
  await waitFor(() => /مشروع مفتوح للعاملين/.test(text()), { label: "عرض إشعار المشروع المفتوح للعامل" });
  check("العامل يرى أن المشروع المفتوح متاح دون تعيين فردي", /مشروع اختبار آلي/.test(text()));
  check("زر Push الخارجي لا يتفعّل قبل إعداد المزود", text().includes("تنتظر ربط حساب OneSignal") && !buttonByText(/تفعيل إشعارات الهاتف/));
  const markNotificationRead = $('[aria-label^="تعليم"]');
  if (markNotificationRead) {
    click(markNotificationRead);
    await waitFor(() => /كل الإشعارات مقروءة/.test(text()), { label: "تعليم إشعار العامل كمقروء" });
    check("العامل يستطيع تعليم الإشعار كمقروء", true);
  } else {
    check("العامل يستطيع تعليم الإشعار كمقروء", false, "زر تعليم كمقروء غير ظاهر");
  }
  const closeNotificationCenter = buttonByText(/^✕$/);
  if (closeNotificationCenter) click(closeNotificationCenter);
}

await sleep(700);
const homeBefore = text();
check("شاشة العامل الرئيسية بتعرض بياناته", homeBefore.length > 200, `${homeBefore.length} حرف`);
check("أزرار الحضور والفلوس موجودة", !!buttonByText(/نزلت النهاردة/), "زر: نزلت النهاردة");
check(
  "العامل يرى كل المشاريع النشطة بلا صفوف تعيين",
  window.__smokeDemoDB?.worker_projects?.length === 0 &&
    ["مشروع اختبار آلي", "موقع اختبار آلي ثانٍ", "موقع اختبار آلي ثالث", "موقع اختبار آلي رابع"].every((name) => text().includes(name))
);

// ---- 5) تسجيل حضور واحد مرتبط بأربعة مشاريع بلا تعيين مسبق ----
const errBeforeAtt = errors.length;
const firstProject = buttonByText(/مشروع اختبار آلي/);
const secondProject = buttonByText(/موقع اختبار آلي ثانٍ/);
const thirdProject = buttonByText(/موقع اختبار آلي ثالث/);
const fourthProject = buttonByText(/موقع اختبار آلي رابع/);
await waitFor(() => firstProject && secondProject && thirdProject && fourthProject && !firstProject.disabled && !secondProject.disabled && !thirdProject.disabled && !fourthProject.disabled, { label: "جاهزية جميع المشاريع المفتوحة للعامل" });
if (firstProject && secondProject && thirdProject && fourthProject) {
  click(firstProject);
  await waitFor(() => !!buttonByText(/✓\s*مشروع اختبار آلي/), { label: "اختيار المشروع الأول" });
  const freshSecondProject = buttonByText(/موقع اختبار آلي ثانٍ/);
  if (freshSecondProject) click(freshSecondProject);
  await waitFor(() => !!buttonByText(/✓\s*موقع اختبار آلي ثانٍ/), { label: "اختيار المشروع الثاني" });
  const freshThirdProject = buttonByText(/موقع اختبار آلي ثالث/);
  if (freshThirdProject) click(freshThirdProject);
  await waitFor(() => !!buttonByText(/✓\s*موقع اختبار آلي ثالث/), { label: "اختيار المشروع الثالث" });
  const freshFourthProject = buttonByText(/موقع اختبار آلي رابع/);
  if (freshFourthProject) click(freshFourthProject);
  await waitFor(() => !!buttonByText(/✓\s*موقع اختبار آلي رابع/), { label: "اختيار المشروع الرابع" });
  check("العامل يختار أكثر من 3 مشاريع بلا حدّ ثابت", true);
} else {
  check("العامل يختار أكثر من 3 مشاريع بلا حدّ ثابت", false, "قائمة المشاريع لم تظهر كاملة");
}
await waitFor(() => {
  const button = buttonByText(/نزلت النهاردة/);
  return !!button && !button.disabled;
}, { label: "تفعيل زر تسجيل الحضور" });
const attBtn = buttonByText(/نزلت النهاردة/);
if (attBtn) {
  // Simulate an offline worker. Attendance must queue only work/project data,
  // without requesting the device location or attaching coordinates.
  setNetworkOnline(false);
  click(attBtn);
  try {
    await waitFor(() => /الحضور محفوظ على الجهاز وبانتظار تحقق الخادم/.test(text()), { timeout: 9000, label: "حفظ الحضور دون إنترنت" });
    const pendingOps = await readPendingOperations();
    const attendanceOp = pendingOps.find((op) => op.table === "rpc" && op.payload?.fn === "register_attendance_multi");
    const queuedArgs = attendanceOp?.payload?.args ?? {};
    check("طلب الحضور لا يحتوي إحداثيات GPS في طابور المزامنة", !("p_lat" in queuedArgs) && !("p_lng" in queuedArgs));
    check("تسجيل الحضور لا يطلب إذن الموقع", geolocationCalls.count === 0);
    setNetworkOnline(true);
    await waitFor(() => window.__smokeDemoDB?.attendance?.some((row) => row.lat === null && row.lng === null), { timeout: 9000, label: "مزامنة حضور بلا إحداثيات بعد عودة الإنترنت" });
    check("سجل الحضور بعد المزامنة لا يحتوي إحداثيات", window.__smokeDemoDB?.attendance?.some((row) => row.lat === null && row.lng === null));
    await waitFor(() => /المشاريع المسجلة لحضور اليوم/.test(text()) && !!buttonByText(/\+ مشروع/), { timeout: 9000, label: "تأكيد مزامنة الحضور وربطه بالمشاريع" });
    check("📅 تسجيل الحضور نجح", errors.length === errBeforeAtt, "سجل حضور واحد تزامن بعد عودة الاتصال");
    check("الحضور مرتبط بالمشاريع الأربعة المختارة", ["مشروع اختبار آلي", "موقع اختبار آلي ثانٍ", "موقع اختبار آلي ثالث", "موقع اختبار آلي رابع"].every((name) => text().includes(name)));
  } catch (e) {
    setNetworkOnline(true);
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
check("أربعة مشاريع لا تكرر اليومية: يوم واحد فقط", dayStat?.querySelector(".value")?.textContent?.trim() === formattedOneDay);
check("استحقاق اليوم يظهر يومية واحدة (350 ج.م)", earnedStat?.querySelector(".value")?.textContent?.includes(formattedDailyWage));

const workerOutForOnlineAttendance = buttonByText(/^خروج$/);
if (workerOutForOnlineAttendance) {
  click(workerOutForOnlineAttendance);
  await waitFor(() => window.location.pathname === "/login", { label: "الخروج لاختبار الحضور المتصل" });
}
await login("worker02", "demo-only-pass");
await waitFor(() => window.location.pathname.startsWith("/worker"), { label: "الدخول للعامل لاختبار الاتصال" });
await waitFor(() => {
  const project = buttonByText(/مشروع اختبار آلي/);
  return !!project && !project.disabled;
}, { label: "قائمة المشاريع للحضور المتصل" });
const onlineProject = buttonByText(/مشروع اختبار آلي/);
if (onlineProject && onlineProject.getAttribute("aria-pressed") !== "true") click(onlineProject);
await waitFor(() => {
  const attendanceButton = buttonByText(/نزلت النهاردة/);
  return !!attendanceButton && !attendanceButton.disabled;
}, { label: "اختيار مشروع للحضور المتصل" });
click(buttonByText(/نزلت النهاردة/));
await waitFor(() => /اتسجّل حضورك النهاردة/.test(text()), { timeout: 9000, label: "تسجيل حضور متصل" });
const onlineAttendanceArgs = window.__smokeDemoDB?.lastAttendanceRpcArgs?.args ?? {};
check("الحضور المتصل لا يطلب إذن الموقع", geolocationCalls.count === 0);
check("طلب الحضور المتصل لا يحتوي إحداثيات", !("p_lat" in onlineAttendanceArgs) && !("p_lng" in onlineAttendanceArgs));
check("الحضور المتصل لا يخزن إحداثيات", window.__smokeDemoDB?.attendance?.some((row) => row.worker_id === "smoke-worker-online" && row.lat === null && row.lng === null));

const onlineWorkerOut = buttonByText(/^خروج$/);
if (onlineWorkerOut) {
  click(onlineWorkerOut);
  await waitFor(() => window.location.pathname === "/login", { label: "العودة للعامل الأساسي بعد اختبار الاتصال" });
}
await login("worker01", "demo-only-pass");
await waitFor(() => window.location.pathname.startsWith("/worker"), { label: "العودة للعامل الأساسي" });

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

// ---- 9) الحماية: لا يُحذف عامل أو مشروع لهما تاريخ ----
const workerOutBtn = buttonByText(/^خروج$/);
if (workerOutBtn) {
  click(workerOutBtn);
  await waitFor(() => window.location.pathname === "/login", { timeout: 8000, label: "خروج العامل بعد الاختبار" });
}
await login("mostafageddo", "demo-only-pass");
await waitFor(() => window.location.pathname.startsWith("/admin"), { label: "العودة للمطوّر", timeout: 12000 });
setPath("/admin/workers");
await waitFor(
  () => window.location.pathname === "/admin/workers" && /الحذف النهائي للعامل متاح/.test(text()),
  { label: "قائمة العمال لاختبار حماية التاريخ" }
);
const attendedWorkerRow = $$("tbody tr").find((row) => row.textContent?.includes("عامل اختبار آلي"));
const attendedWorkerDeleteButton = [...(attendedWorkerRow?.querySelectorAll("button") ?? [])]
  .find((button) => /🗑 حذف/.test(button.textContent || ""));
if (attendedWorkerDeleteButton) {
  click(attendedWorkerDeleteButton);
  await waitFor(() => /لا يمكن حذف العامل/.test(text()), { label: "منع حذف عامل له تاريخ" });
  check("الحذف يرفض عاملًا لديه حضور/مال ويحفظه", !!attendedWorkerRow?.textContent?.includes("عامل اختبار آلي"));
} else {
  check("الحذف يرفض عاملًا لديه حضور/مال ويحفظه", false, "لم يظهر صف العامل للاختبار");
}
setPath("/admin/projects");
await waitFor(
  () => window.location.pathname === "/admin/projects" && /الحذف النهائي للمشروع متاح/.test(text()),
  { label: "قائمة المشاريع لاختبار حماية التاريخ" }
);
const attendedProjectRow = $$("tbody tr").find((row) => row.textContent?.includes("مشروع اختبار آلي"));
const attendedProjectDeleteButton = [...(attendedProjectRow?.querySelectorAll("button") ?? [])]
  .find((button) => /حذف نهائي/.test(button.textContent || ""));
if (attendedProjectDeleteButton) {
  click(attendedProjectDeleteButton);
  await waitFor(() => /لا يمكن حذف المشروع/.test(text()), { label: "منع حذف مشروع له تاريخ" });
  check("الحذف يرفض مشروعًا مرتبطًا بحضور ويحفظه", !!attendedProjectRow?.textContent?.includes("مشروع اختبار آلي"));
} else {
  check("الحذف يرفض مشروعًا مرتبطًا بحضور ويحفظه", false, "لم يظهر صف المشروع للاختبار");
}

// ---- 10) الخصم: قيد إداري، سجل مراجعة، وإشعار للعامل ----
setPath("/admin/workers");
await waitFor(() => window.location.pathname === "/admin/workers" && $$("tbody tr").some((row) => row.textContent?.includes("عامل اختبار آلي")), { label: "العامل لإضافة خصم آلي" });
const deductionWorkerRow = $$("tbody tr").find((row) => row.textContent?.includes("عامل اختبار آلي"));
const detailsButton = [...(deductionWorkerRow?.querySelectorAll("button") ?? [])].find((button) => /تفاصيل/.test(button.textContent || ""));
if (detailsButton) {
  click(detailsButton);
  await waitFor(() => $('[role="dialog"]') && /المشاريع المفتوحة متاحة لكل العمال/.test(text()), { label: "فتح تفاصيل العامل بلا تعيين مشاريع" });
  const deductionTab = [...($('[role="dialog"]')?.querySelectorAll("button") ?? [])].find((button) => /^خصم$/.test(button.textContent || ""));
  if (deductionTab) {
    click(deductionTab);
    await waitFor(() => $('[role="dialog"] .input-big'), { label: "حقول الخصم" });
    const modal = $('[role="dialog"]');
    const amountInput = modal?.querySelector(".input-big");
    const reasonInput = [...(modal?.querySelectorAll("input") ?? [])].find((input) => input !== amountInput);
    if (amountInput && reasonInput) {
      setValue(amountInput, "25");
      setValue(reasonInput, "خصم اختبار آلي");
      click([...modal.querySelectorAll("button")].find((button) => /تأكيد تسجيل الخصم/.test(button.textContent || "")));
      await waitFor(() => !$('[role="dialog"]'), { label: "حفظ خصم العامل" });
      check("الإدارة تسجل الخصم من تفاصيل العامل بعد تأكيد", true);
    } else check("الإدارة تسجل الخصم من تفاصيل العامل بعد تأكيد", false, "حقول الخصم غير ظاهرة");
  } else check("الإدارة تسجل الخصم من تفاصيل العامل بعد تأكيد", false, "تبويب الخصم غير ظاهر");
} else check("الإدارة تسجل الخصم من تفاصيل العامل بعد تأكيد", false, "زر تفاصيل العامل غير ظاهر");

setPath("/admin/deductions");
await waitFor(() => window.location.pathname === "/admin/deductions" && /سجل الخصومات/.test(text()), { label: "سجل خصومات الإدارة" });
check("سجل الخصومات يعرض العامل والسبب والمبلغ", /خصم اختبار آلي/.test(text()) && /عامل اختبار آلي/.test(text()));

const reverseButton = buttonByText(/إلغاء\/تصحيح الخصم/);
if (reverseButton) {
  click(reverseButton);
  await waitFor(() => $('[role="dialog"]') && /سيُعاد مبلغ/.test(text()), { label: "تأكيد إلغاء الخصم" });
  const reverseReason = $('[aria-label="سبب إلغاء الخصم"]');
  if (reverseReason) {
    setValue(reverseReason, "تصحيح قيد اختبار آلي");
    click(buttonByText(/تأكيد الإلغاء/));
    await waitFor(() => /تم إلغاء خصم/.test(text()) && /ملغي/.test(text()), { label: "حفظ تصحيح الخصم" });
    check("تصحيح الخصم يحفظ القيد كملغي مع السبب بدل حذفه", /تصحيح قيد اختبار آلي/.test(text()));
  } else check("تصحيح الخصم يحفظ القيد كملغي مع السبب بدل حذفه", false, "حقل سبب الإلغاء غير ظاهر");
} else check("تصحيح الخصم يحفظ القيد كملغي مع السبب بدل حذفه", false, "زر الإلغاء غير ظاهر");

// Add the correct entry after reversing the intentionally mistaken one; the
// worker's final payable balance must still be 350 - 100 - 25 = 225.
setPath("/admin/workers");
await waitFor(() => window.location.pathname === "/admin/workers" && $$("tbody tr").some((row) => row.textContent?.includes("عامل اختبار آلي")), { label: "إعادة تسجيل الخصم الصحيح" });
const correctedWorkerRow = $$("tbody tr").find((row) => row.textContent?.includes("عامل اختبار آلي"));
const correctedDetails = [...(correctedWorkerRow?.querySelectorAll("button") ?? [])].find((button) => /تفاصيل/.test(button.textContent || ""));
if (correctedDetails) {
  click(correctedDetails);
  await waitFor(() => $('[role="dialog"]') && /المشاريع المفتوحة متاحة لكل العمال/.test(text()), { label: "إعادة فتح تفاصيل العامل بلا تعيين مشاريع" });
  const correctedDeductionTab = [...($('[role="dialog"]')?.querySelectorAll("button") ?? [])].find((button) => /^خصم$/.test(button.textContent || ""));
  if (correctedDeductionTab) {
    click(correctedDeductionTab);
    await waitFor(() => $('[role="dialog"] .input-big'), { label: "حقول الخصم الصحيح" });
    const modal = $('[role="dialog"]');
    const amountInput = modal?.querySelector(".input-big");
    const reasonInput = [...(modal?.querySelectorAll("input") ?? [])].find((input) => input !== amountInput);
    if (amountInput && reasonInput) {
      setValue(amountInput, "25");
      setValue(reasonInput, "خصم صحيح بعد التصحيح");
      click([...modal.querySelectorAll("button")].find((button) => /تأكيد تسجيل الخصم/.test(button.textContent || "")));
      await waitFor(() => !$('[role="dialog"]'), { label: "حفظ الخصم الصحيح" });
      check("الإدارة تسجّل القيد الصحيح الجديد منفصلًا", true);
    } else check("الإدارة تسجّل القيد الصحيح الجديد منفصلًا", false, "حقول الخصم غير ظاهرة");
  } else check("الإدارة تسجّل القيد الصحيح الجديد منفصلًا", false, "تبويب الخصم غير ظاهر");
} else check("الإدارة تسجّل القيد الصحيح الجديد منفصلًا", false, "زر تفاصيل العامل غير ظاهر");

setPath("/admin/deductions");
await waitFor(() => /خصم صحيح بعد التصحيح/.test(text()) && /ملغي/.test(text()), { label: "مراجعة الخصم المصحح" });
check("سجل الإدارة يحتفظ بالخصم الملغي والجديد", /خصم اختبار آلي/.test(text()) && /خصم صحيح بعد التصحيح/.test(text()));

const developerOutForDeduction = buttonByText(/^خروج$/);
if (developerOutForDeduction) {
  click(developerOutForDeduction);
  await waitFor(() => window.location.pathname === "/login", { label: "خروج المطوّر بعد تسجيل الخصم" });
}
await login("worker01", "demo-only-pass");
await waitFor(() => window.location.pathname.startsWith("/worker"), { label: "العامل يراجع الخصم" });
const workerBellForDeduction = $('button[aria-label^="الإشعارات"]');
if (workerBellForDeduction) {
  click(workerBellForDeduction);
  await waitFor(() => /تم تسجيل خصم على حسابك/.test(text()) && /تم إلغاء خصم من حسابك/.test(text()) && /خصم صحيح بعد التصحيح/.test(text()), { label: "إشعارات الخصم والتصحيح للعامل" });
  const deductionArticle = $$(".notification-item").find((article) => article.textContent?.includes("خصم صحيح بعد التصحيح"));
  const reversalArticle = $$(".notification-item").find((article) => article.textContent?.includes("تم إلغاء خصم من حسابك"));
  check("العامل يستقبل إشعار الخصم الصحيح والتصحيح مع المبلغ والسبب", !!deductionArticle && /25/.test(deductionArticle.textContent || "") && !!reversalArticle && /تصحيح قيد اختبار آلي/.test(reversalArticle.textContent || ""));
  const readButton = deductionArticle?.querySelector(".notification-read");
  if (readButton) {
    click(readButton);
    await waitFor(() => !deductionArticle?.querySelector(".notification-read"), { label: "تعليم إشعار الخصم كمقروء" });
  }
  const closeBell = buttonByText(/^✕$/);
  if (closeBell) click(closeBell);
}
setPath("/worker/statement");
await waitFor(() => window.location.pathname === "/worker/statement" && /خصومات/.test(text()), { label: "كشف العامل بعد الخصم" });
click(buttonByText(/خصومات/));
await waitFor(() => /خصم اختبار آلي/.test(text()) && /خصم صحيح بعد التصحيح/.test(text()) && /ملغي/.test(text()), { label: "ظهور الخصم والتصحيح في كشف العامل" });
check("كشف العامل يحفظ الخصم الملغي وسبب التصحيح ويعرض القيد الصحيح", /تصحيح قيد اختبار آلي/.test(text()) && /خصم صحيح بعد التصحيح/.test(text()));

const workerOutAfterDeduction = buttonByText(/^خروج$/);
if (workerOutAfterDeduction) {
  click(workerOutAfterDeduction);
  await waitFor(() => window.location.pathname === "/login", { label: "خروج العامل بعد مراجعة الخصم" });
}
await login("mostafageddo", "demo-only-pass");
await waitFor(() => window.location.pathname.startsWith("/admin"), { label: "عودة المطوّر للتسوية" });
setPath("/admin/settlements");
await waitFor(() => window.location.pathname === "/admin/settlements" && /صرف كامل الرصيد/.test(text()), { label: "إظهار الرصيد القابل للتسوية" });
const settleButton = buttonByText(/تسجيل صرف الرصيد/);
const formattedSettlementAmount = new window.Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(225);
if (settleButton) {
  click(settleButton);
  await waitFor(() => /تم تسجيل وصرف/.test(text()) && /اتصرف/.test(text()), { label: "صرف الرصيد العام ذريًا" });
  check("التسوية تسجل 225 جنيهًا وتظهر في سجل الصرف", text().includes(formattedSettlementAmount) && /اتصرف/.test(text()));
} else check("التسوية تسجل 225 جنيهًا وتظهر في سجل الصرف", false, "زر التسوية غير ظاهر");
setPath("/admin/workers");
await waitFor(() => window.location.pathname === "/admin/workers" && $$("tbody tr").some((row) => row.textContent?.includes("عامل اختبار آلي")), { label: "تحديث رصيد العامل بعد التسوية" });
const settledWorkerRow = $$("tbody tr").find((row) => row.textContent?.includes("عامل اختبار آلي"));
const formattedZeroBalance = new window.Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(0);
check("صرف التسوية يخفض الرصيد العام للعامل إلى صفر", settledWorkerRow?.querySelectorAll("td")[8]?.textContent?.includes(formattedZeroBalance));

const developerOutAfterSettlement = buttonByText(/^خروج$/);
if (developerOutAfterSettlement) {
  click(developerOutAfterSettlement);
  await waitFor(() => window.location.pathname === "/login", { label: "خروج المطوّر بعد التسوية" });
}
await login("worker01", "demo-only-pass");
await waitFor(() => window.location.pathname.startsWith("/worker"), { label: "العامل يراجع التسوية" });
const workerBellAfterSettlement = $('button[aria-label^="الإشعارات"]');
if (workerBellAfterSettlement) {
  click(workerBellAfterSettlement);
  await waitFor(() => /تم تسجيل صرف مستحقاتك/.test(text()), { label: "إشعار التسوية للعامل" });
  check("العامل يتلقى إشعارًا بعد التسوية", /225/.test(text()));
  const closeBellAfterSettlement = buttonByText(/^✕$/);
  if (closeBellAfterSettlement) click(closeBellAfterSettlement);
}
setPath("/worker/statement");
await waitFor(() => window.location.pathname === "/worker/statement" && buttonByText(/تسويات/), { label: "كشف العامل بعد التسوية" });
click(buttonByText(/تسويات/));
await waitFor(() => /اتصرف/.test(text()), { label: "كشف التسويات للعامل" });
  check("كشف العامل يعرض التسوية المصروفة", text().includes(formattedSettlementAmount) && /اتصرف/.test(text()));

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
