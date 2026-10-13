import type { ReactNode } from "react";

export type AppIconName =
  | "layoutDashboard"
  | "userPlus"
  | "calendarCheck"
  | "circleCheck"
  | "circleX"
  | "shieldAlert"
  | "archive"
  | "folderOpen"
  | "download"
  | "lockKeyhole"
  | "trash2"
  | "rotateCcw"
  | "hardHat"
  | "building2"
  | "wallet"
  | "fileMinus"
  | "receiptCheck"
  | "shieldCheck"
  | "settings"
  | "wrench"
  | "home"
  | "banknote"
  | "clipboardList"
  | "bell"
  | "mapPin"
  | "printer"
  | "activity"
  | "clock"
  | "database"
  | "eye"
  | "eyeOff"
  | "idCard"
  | "inbox"
  | "pencil"
  | "search"
  | "userRound"
  | "users"
  | "wifiOff"
  | "x";

const ICONS: Record<AppIconName, ReactNode> = {
  layoutDashboard: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="5" rx="1.5" />
      <rect x="13" y="10" width="8" height="11" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
    </>
  ),
  userPlus: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6M16 11h6" />
    </>
  ),
  calendarCheck: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18m-12 5 2 2 5-5" />
    </>
  ),
  circleCheck: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.5 2.5L16 9" />
    </>
  ),
  circleX: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6m0-6-6 6" />
    </>
  ),
  shieldAlert: (
    <>
      <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" />
      <path d="M12 8v4m0 4h.01" />
    </>
  ),
  archive: (
    <>
      <path d="M3 4h18v4H3zM5 8v12h14V8" />
      <path d="M10 12h4" />
    </>
  ),
  folderOpen: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v1" />
      <path d="m2 17 2-6a2 2 0 0 1 2-1.5h16l-2 8a2 2 0 0 1-2 1.5H4a2 2 0 0 1-2-2Z" />
    </>
  ),
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5M12 15V3" />
    </>
  ),
  lockKeyhole: (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4M12 15v2" />
    </>
  ),
  trash2: (
    <>
      <path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15" />
      <path d="M10 11v6m4-6v6" />
    </>
  ),
  rotateCcw: (
    <>
      <path d="M3 7v5h5M4 12a8 8 0 1 0 2.3-5.6L3 12" />
    </>
  ),
  hardHat: (
    <>
      <path d="M3 20h18M4 20v-3a8 8 0 0 1 16 0v3M12 9v8M4.5 14h15" />
      <path d="M12 4v2" />
    </>
  ),
  building2: (
    <>
      <path d="M3 21h18M5 21V5l7-3 7 3v16" />
      <path d="M9 9h.01M15 9h.01M9 13h.01M15 13h.01M9 17h.01M15 17h.01" />
    </>
  ),
  wallet: (
    <>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H19a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a.5.5 0 0 1 .5-.5Z" />
      <path d="M3 9h18m-5 5h.01" />
    </>
  ),
  fileMinus: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M9 14h6" />
    </>
  ),
  receiptCheck: (
    <>
      <path d="m4 3 2 1.5L8 3l2 1.5L12 3l2 1.5L16 3l2 1.5L20 3v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L8 21l-2-1.5L4 21z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  shieldCheck: (
    <>
      <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  settings: (
    <>
      <path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.6a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.6a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  wrench: (
    <path d="M14.7 6.3a5 5 0 0 0-6.4 6.4L3 18a2.1 2.1 0 0 0 3 3l5.3-5.3a5 5 0 0 0 6.4-6.4L15 12l-3-3z" />
  ),
  home: (
    <>
      <path d="m3 10 9-7 9 7M5 9v12h14V9" />
      <path d="M9 21v-6h6v6" />
    </>
  ),
  banknote: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9h.01M18 15h.01" />
    </>
  ),
  clipboardList: (
    <>
      <path d="M9 4.5h6a1.5 1.5 0 0 0-1.5-1.5h-3A1.5 1.5 0 0 0 9 4.5Z" />
      <rect x="5" y="4" width="14" height="18" rx="2" />
      <path d="M9 11h6M9 15h6M9 19h6" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </>
  ),
  mapPin: (
    <>
      <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  printer: (
    <>
      <path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M6 14h12v7H6zM17 12h.01" />
    </>
  ),
  activity: (
    <>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5" />
      <path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8" />
      <path d="M9.9 5.2A11 11 0 0 1 12 5c6.5 0 10 7 10 7a15 15 0 0 1-3.1 3.8M6.2 6.2C3.4 8 2 12 2 12s3.5 7 10 7c1.3 0 2.5-.3 3.5-.7" />
    </>
  ),
  idCard: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8" cy="11" r="2" />
      <path d="M5.5 16a3 3 0 0 1 5 0M13 10h5M13 14h5" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 4h16l2 10v5H2v-5L4 4Z" />
      <path d="M2 14h5l2 3h6l2-3h5" />
    </>
  ),
  pencil: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  userRound: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M5 21a7 7 0 0 1 14 0" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
    </>
  ),
  wifiOff: (
    <>
      <path d="M1 9a16 16 0 0 1 22 0M5 13a10 10 0 0 1 3-2M9 17a4 4 0 0 1 4 0M12 21h.01" />
      <path d="m2 2 20 20" />
    </>
  ),
  x: <path d="m18 6-12 12M6 6l12 12" />,
};

type AppIconProps = {
  name: AppIconName;
  size?: number;
  className?: string;
};

export default function AppIcon({ name, size = 20, className }: AppIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className ? `app-icon ${className}` : "app-icon"}
      focusable="false"
      height={size}
      width={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICONS[name]}
    </svg>
  );
}
