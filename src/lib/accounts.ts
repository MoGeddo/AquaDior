/**
 * حسابات الإدارة — كل واحد ليه يوزر نيم وباسورد،
 * والدور بيتعرف من اسم المستخدم لوحده.
 * القيم دي بتتقدر تتغيّر من ملف .env من غير ما تلمس الكود.
 */
export type AccountKind = "owner" | "developer";

export interface AccountDef {
  kind: AccountKind;
  label: string;
  icon: string;
  name: string;
  username: string;
  password: string;
}

const PASS = (import.meta.env.VITE_ADMIN_PASSWORD as string) || "Qn&112233#Do";

export const ACCOUNTS: AccountDef[] = [
  {
    kind: "owner",
    label: "مالك",
    icon: "👑",
    name: "عابدين يونس",
    username: (import.meta.env.VITE_OWNER_USERNAME as string) || "abden.younes",
    password:
      (import.meta.env.VITE_OWNER_PASSWORD as string) || PASS,
  },
  {
    kind: "owner",
    label: "مالك",
    icon: "👑",
    name: "محمود عبدين",
    username:
      (import.meta.env.VITE_MANAGER_USERNAME as string) || "mahmoud.abdin",
    password:
      (import.meta.env.VITE_MANAGER_PASSWORD as string) || PASS,
  },
  {
    kind: "developer",
    label: "مطوّر",
    icon: "🛠️",
    name: "Mostafa Geddo",
    username:
      (import.meta.env.VITE_DEV_USERNAME as string) || "MostafaGeddo",
    password: (import.meta.env.VITE_DEV_PASSWORD as string) || PASS,
  },
];

export const DEV_ACCOUNT = ACCOUNTS[2];
