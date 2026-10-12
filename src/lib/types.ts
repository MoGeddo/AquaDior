export type Role = "owner" | "manager" | "developer" | "worker";

export type ProfileStatus = "pending" | "active" | "rejected" | "suspended";

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  username: string | null;
  role: Role;
  daily_wage: number;
  is_active: boolean;
  // حقول التسجيل الأولى
  status: ProfileStatus;
  id_card_url: string | null;
  approved_by: string | null;
  approved_at: string | null;
  reject_reason: string | null;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "closed";
  start_date: string | null;
  end_date: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
}

export interface Attendance {
  id: string;
  worker_id: string;
  project_id: string | null;
  work_date: string;
  daily_wage_snapshot: number | null;
  source: "worker" | "admin";
  lat: number | null;
  lng: number | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface AttendanceProject {
  attendance_id: string;
  project_id: string;
  project?: Pick<Project, "id" | "name" | "status">;
}

export type WithdrawalStatus = "pending" | "approved" | "rejected";

export interface Withdrawal {
  id: string;
  worker_id: string;
  project_id: string | null;
  amount: number;
  note: string | null;
  status: WithdrawalStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

export interface Deduction {
  id: string;
  worker_id: string;
  project_id: string | null;
  amount: number;
  reason: string;
  created_by: string | null;
  created_at: string;
  voided_at?: string | null;
  voided_by?: string | null;
  void_reason?: string | null;
}

export interface Settlement {
  id: string;
  worker_id: string;
  project_id: string | null;
  days_worked: number;
  daily_wage: number;
  total_earned: number;
  total_withdrawn: number;
  total_deductions: number;
  net_amount: number;
  status: "draft" | "confirmed" | "paid";
  worker_ack_at: string | null;
  confirmed_by: string | null;
  paid_at: string | null;
  client_request_id?: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string | null;
  type: string;
  title: string;
  body: string | null;
  data: any;
  is_read: boolean;
  created_at: string;
}

export interface WorkerBalance {
  worker_id: string;
  full_name: string;
  phone: string | null;
  role: Role;
  daily_wage: number;
  is_active: boolean;
  days_worked: number;
  earned: number;
  withdrawn_approved: number;
  withdrawn_pending: number;
  deducted: number;
  balance: number;
  available: number;
  settled_paid: number;
}

export interface AppSettings {
  auto_approve_limit: number;
  absence_deduction: number;
  day_lock_time: string;
  gps_enabled: boolean;
  currency: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  auto_approve_limit: 500,
  absence_deduction: 50,
  day_lock_time: "00:00",
  gps_enabled: true,
  currency: "ج.م",
};
