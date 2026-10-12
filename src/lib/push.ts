import { Capacitor } from "@capacitor/core";

const RAW_APP_ID = (import.meta.env.VITE_ONESIGNAL_APP_ID as string | undefined)?.trim() ?? "";
const APP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(RAW_APP_ID)
  ? RAW_APP_ID
  : "";
const ENABLED_PREFIX = "aquadior:push-enabled:";
const ACTIVE_USER_KEY = "aquadior:push-active-user";

type NativeOneSignal = typeof import("@onesignal/capacitor-plugin").default;
type WebOneSignal = typeof import("react-onesignal").default;
type PushClient =
  | { kind: "native"; sdk: NativeOneSignal }
  | { kind: "web"; sdk: WebOneSignal };

let nativeClientPromise: Promise<NativeOneSignal> | null = null;
let webClientPromise: Promise<WebOneSignal> | null = null;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function preferenceKey(userId: string) {
  return `${ENABLED_PREFIX}${userId}`;
}

function setConsent(client: PushClient, granted: boolean) {
  if (client.kind === "native") client.sdk.setConsentGiven(granted);
  else return client.sdk.setConsentGiven(granted);
}

async function getClient(): Promise<PushClient> {
  if (!APP_ID) throw new Error("إشعارات الهاتف غير مهيأة بعد؛ يلزم إعداد OneSignal أولًا.");

  if (isNative()) {
    if (!nativeClientPromise) {
      nativeClientPromise = import("@onesignal/capacitor-plugin").then(async ({ default: sdk }) => {
        sdk.setConsentRequired(true);
        await sdk.initialize(APP_ID);
        return sdk;
      });
    }
    try {
      return { kind: "native", sdk: await nativeClientPromise };
    } catch (error) {
      nativeClientPromise = null;
      throw error;
    }
  }

  if (!webClientPromise) {
    webClientPromise = import("react-onesignal").then(async ({ default: sdk }) => {
      await sdk.setConsentRequired(true);
      await sdk.init({
        appId: APP_ID,
        autoRegister: false,
        autoResubscribe: true,
        allowLocalhostAsSecureOrigin: true,
        serviceWorkerPath: "/onesignal/OneSignalSDKWorker.js",
        serviceWorkerUpdaterPath: "/onesignal/OneSignalSDKUpdaterWorker.js",
        serviceWorkerParam: { scope: "/onesignal/" },
        notificationClickHandlerMatch: "origin",
        notificationClickHandlerAction: "navigate",
      });
      return sdk;
    });
  }
  try {
    return { kind: "web", sdk: await webClientPromise };
  } catch (error) {
    webClientPromise = null;
    throw error;
  }
}

export function externalPushConfigured(): boolean {
  return Boolean(APP_ID);
}

export function externalPushIsNative(): boolean {
  return isNative();
}

export function externalPushEnabledLocally(userId: string): boolean {
  try {
    return storage()?.getItem(preferenceKey(userId)) === "true";
  } catch {
    return false;
  }
}

/** Prepare the provider without showing a permission prompt. */
export async function prepareExternalPush(): Promise<void> {
  if (!APP_ID) return;
  await getClient();
}

async function logIn(client: PushClient, userId: string): Promise<void> {
  await client.sdk.login(userId);
}

async function logOut(client: PushClient): Promise<void> {
  if (client.kind === "native") await client.sdk.logout();
  else await client.sdk.logout();
}

async function optIn(client: PushClient): Promise<void> {
  if (client.kind === "native") await client.sdk.User.pushSubscription.optIn();
  else await client.sdk.User.PushSubscription.optIn();
}

async function optOut(client: PushClient): Promise<void> {
  if (client.kind === "native") await client.sdk.User.pushSubscription.optOut();
  else await client.sdk.User.PushSubscription.optOut();
}

/** Called only from the user's explicit enable action. */
export async function enableExternalPush(userId: string): Promise<void> {
  const client = await getClient();

  if (client.kind === "web" && !client.sdk.Notifications.isPushSupported()) {
    throw new Error("الإشعارات غير مدعومة في هذا المتصفح. على iPhone ثبّت التطبيق على الشاشة الرئيسية أو استخدم نسخة TestFlight.");
  }

  // The app's explicit opt-in is also the consent gate for sending a device ID to OneSignal.
  await setConsent(client, true);
  const granted = client.kind === "native"
    ? await client.sdk.Notifications.requestPermission(true)
    : await client.sdk.Notifications.requestPermission();
  if (!granted) {
    await setConsent(client, false);
    throw new Error("لم يتم السماح بالإشعارات. فعّلها من إعدادات الهاتف ثم حاول مرة أخرى.");
  }

  await logIn(client, userId);
  await optIn(client);
  try {
    storage()?.setItem(preferenceKey(userId), "true");
    storage()?.setItem(ACTIVE_USER_KEY, userId);
  } catch {
    // The provider session still works for this app session if browser storage is unavailable.
  }
}

/** Restore the opted-in identity for this device, and never leave the previous account targeted. */
export async function syncExternalPushIdentity(userId: string | null): Promise<void> {
  if (!APP_ID) return;
  let activeUserId: string | null = null;
  try {
    activeUserId = storage()?.getItem(ACTIVE_USER_KEY) ?? null;
  } catch {
    return;
  }

  const optedIn = Boolean(userId && externalPushEnabledLocally(userId));
  if (!optedIn) {
    if (!activeUserId) return;
    try {
      const client = await getClient();
      await optOut(client);
      await logOut(client);
      await setConsent(client, false);
      storage()?.removeItem(ACTIVE_USER_KEY);
    } catch (error) {
      console.warn("Could not clear external notification identity", error);
    }
    return;
  }

  try {
    const client = await getClient();
    await setConsent(client, true);
    const permissionGranted = client.kind === "native"
      ? await client.sdk.Notifications.hasPermission()
      : client.sdk.Notifications.permission;
    if (!permissionGranted) {
      await logOut(client);
      await setConsent(client, false);
      storage()?.removeItem(ACTIVE_USER_KEY);
      return;
    }
    await logIn(client, userId!);
    await optIn(client);
    storage()?.setItem(ACTIVE_USER_KEY, userId!);
  } catch (error) {
    console.warn("Could not restore external notification identity", error);
  }
}

export async function disableExternalPush(userId: string): Promise<void> {
  if (!APP_ID) return;
  const client = await getClient();
  await optOut(client);
  await logOut(client);
  await setConsent(client, false);
  try {
    storage()?.removeItem(preferenceKey(userId));
    if (storage()?.getItem(ACTIVE_USER_KEY) === userId) storage()?.removeItem(ACTIVE_USER_KEY);
  } catch {
    // The provider opt-out has already been applied.
  }
}

export async function getExternalPushEnabled(userId: string): Promise<boolean | null> {
  if (!APP_ID || !externalPushEnabledLocally(userId)) return false;
  try {
    const client = await getClient();
    if (client.kind === "native") {
      return (await client.sdk.Notifications.hasPermission()) &&
        (await client.sdk.User.pushSubscription.getOptedInAsync());
    }
    return client.sdk.Notifications.permission && client.sdk.User.PushSubscription.optedIn === true;
  } catch {
    return null;
  }
}
