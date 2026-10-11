import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import type { Site, Project } from "../../lib/types";
import { Modal } from "../../components/Modal";

export default function Sites() {
  const [sites, setSites] = useState<Site[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [editing, setEditing] = useState<Site | null>(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    const [{ data: s }, { data: p }] = await Promise.all([
      supabase.from("sites").select("*").order("name"),
      supabase.from("projects").select("*").order("name"),
    ]);
    setSites((s ?? []) as Site[]);
    setProjects((p ?? []) as Project[]);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <div className="flex-between mb">
        <h2>المواقع</h2>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          + إضافة موقع
        </button>
      </div>

      {msg && <div className="alert success">{msg}</div>}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>الموقع</th>
                <th>المشروع</th>
                <th>العنوان</th>
                <th>الحالة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.id}>
                  <td>
                    <b>{s.name}</b>
                  </td>
                  <td className="muted">
                    {projects.find((p) => p.id === s.project_id)?.name ?? "—"}
                  </td>
                  <td className="muted small">{s.address ?? "—"}</td>
                  <td>
                    {s.is_active ? (
                      <span className="badge green">شغال</span>
                    ) : (
                      <span className="badge gray">متوقف</span>
                    )}
                  </td>
                  <td>
                    <button className="btn btn-sm" onClick={() => setEditing(s)}>
                      تعديل
                    </button>
                  </td>
                </tr>
              ))}
              {sites.length === 0 && (
                <tr>
                  <td colSpan={5} className="center muted">
                    مفيش مواقع
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {adding && (
        <SiteForm
          projects={projects}
          onClose={() => setAdding(false)}
          onDone={async () => {
            setAdding(false);
            setMsg("تم الإضافة ✅");
            await load();
          }}
        />
      )}

      {editing && (
        <SiteForm
          site={editing}
          projects={projects}
          onClose={() => setEditing(null)}
          onDone={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </>
  );
}

function SiteForm({
  site,
  projects,
  onClose,
  onDone,
}: {
  site?: Site;
  projects: Project[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(site?.name ?? "");
  const [projectId, setProjectId] = useState(site?.project_id ?? "");
  const [address, setAddress] = useState(site?.address ?? "");
  const [active, setActive] = useState(site?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setErr("");
    if (!name.trim()) return setErr("اكتب اسم الموقع");
    if (!projectId) return setErr("اختر المشروع");
    setBusy(true);
    const payload = {
      name: name.trim(),
      project_id: projectId,
      address: address.trim() || null,
      is_active: active,
    };
    const { error } = site
      ? await supabase.from("sites").update(payload).eq("id", site.id)
      : await supabase.from("sites").insert(payload);
    setBusy(false);
    if (error) return setErr(error.message);
    onDone();
  }

  return (
    <Modal title={site ? "تعديل موقع" : "إضافة موقع"} onClose={onClose}>
      {err && <div className="alert error">{err}</div>}
      <label className="field">
        <span>اسم الموقع</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>المشروع</span>
        <select
          className="input"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">— اختر —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>العنوان</span>
        <input
          className="input"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </label>
      <label className="field">
        <span>الحالة</span>
        <select
          className="input"
          value={active ? "1" : "0"}
          onChange={(e) => setActive(e.target.value === "1")}
        >
          <option value="1">شغال</option>
          <option value="0">متوقف</option>
        </select>
      </label>
      <button className="btn btn-primary btn-block" onClick={save} disabled={busy}>
        حفظ
      </button>
    </Modal>
  );
}
