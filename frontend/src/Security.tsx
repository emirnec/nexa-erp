import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge, DataTable, EmptyState, Field, Icon, PanelHead, SearchBox, Select, useUi,
  type Column,
} from "./ui";
import { api, downloadCsv, errorText, fmtDateTime, jsonInit, trLower } from "./utils";

/* ═════════════ Parola değiştirme ═════════════ */

export function PasswordChangeCard({ onChanged, hint }: { onChanged?: () => void; hint?: string }) {
  const { toast } = useUi();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 12) return toast("error", "Yeni parola en az 12 karakter olmalıdır.");
    if (next !== confirm) return toast("error", "Yeni parola ve doğrulama alanı eşleşmiyor.");
    if (next === current) return toast("error", "Yeni parola mevcut paroladan farklı olmalıdır.");
    setBusy(true);
    try {
      const response = await api("/auth/password", jsonInit("POST", { currentPassword: current, newPassword: next }));
      if (!response.ok) throw new Error(await errorText(response, "Parola değiştirilemedi."));
      toast("success", "Parola güncellendi. Güvenlik için yeniden giriş yapın.");
      setCurrent(""); setNext(""); setConfirm("");
      onChanged?.();
    } catch (error) {
      toast("error", error instanceof Error ? error.message : "Parola değiştirilemedi.");
    } finally { setBusy(false); }
  }

  return (
    <form className="form-grid cols-2" onSubmit={(e) => void submit(e)} autoComplete="off">
      <Field label="Mevcut parola" className="span-all">
        <input type={show ? "text" : "password"} value={current} autoComplete="current-password"
          onChange={(e) => setCurrent(e.target.value)} required />
      </Field>
      <Field label="Yeni parola" hint="En az 12 karakter. Tahmin edilmesi zor bir ifade seçin.">
        <input type={show ? "text" : "password"} value={next} autoComplete="new-password" minLength={12}
          onChange={(e) => setNext(e.target.value)} required />
      </Field>
      <Field label="Yeni parola (tekrar)">
        <input type={show ? "text" : "password"} value={confirm} autoComplete="new-password" minLength={12}
          onChange={(e) => setConfirm(e.target.value)} required />
      </Field>
      <label className="checkbox-line span-all">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
        Parolaları göster
      </label>
      {hint && <p className="muted-text span-all" style={{ fontSize: 12.5 }}>{hint}</p>}
      <div className="form-actions span-all">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          <Icon name="key" /> {busy ? "Güncelleniyor…" : "Parolayı Güncelle"}
        </button>
      </div>
    </form>
  );
}

/* ═════════════ Denetim kaydı ═════════════ */

type AuditRow = {
  id: number; username: string; action: string; entity: string;
  entityId: string; details?: string | null; createdAt: string;
};

const ACTION_LABELS: Record<string, string> = {
  create: "Kayıt oluşturma",
  update: "Güncelleme",
  upsert: "Kayıt / güncelleme",
  delete: "Silme",
  "password-change": "Parola değişikliği",
  "password-reset": "Parola sıfırlama",
  login: "Giriş",
};

const toneOf = (action: string): "success" | "danger" | "warning" | "info" | "neutral" => {
  if (action === "delete") return "danger";
  if (action === "create" || action === "upsert") return "success";
  if (action.startsWith("password")) return "warning";
  if (action === "update") return "info";
  return "neutral";
};

export function AuditPage() {
  const { toast } = useUi();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api("/audit");
      if (!response.ok) throw new Error(await errorText(response, "Denetim kaydı alınamadı."));
      setRows(await response.json());
    } catch (error) {
      toast("error", error instanceof Error ? error.message : "Denetim kaydı alınamadı.");
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const actions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.action))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const query = trLower(search.trim());
    return rows.filter((row) =>
      (!action || row.action === action) &&
      (!query || trLower(`${row.username} ${row.entity} ${row.entityId} ${row.details ?? ""}`).includes(query)));
  }, [rows, search, action]);

  const columns: Column<AuditRow>[] = [
    { key: "date", header: "Tarih", sort: (row) => new Date(row.createdAt).getTime(), render: (row) => fmtDateTime(row.createdAt) },
    { key: "user", header: "Kullanıcı", sort: (row) => row.username, render: (row) => <span className="cell-title">{row.username || "sistem"}</span> },
    { key: "action", header: "İşlem", sort: (row) => row.action, render: (row) => <Badge tone={toneOf(row.action)}>{ACTION_LABELS[row.action] ?? row.action}</Badge> },
    { key: "entity", header: "Kayıt", render: (row) => <>{row.entity}{row.entityId ? <span className="cell-sub">#{row.entityId}</span> : null}</> },
    { key: "details", header: "Ayrıntı", render: (row) => row.details || <span className="muted-text">—</span> },
  ];

  return (
    <section className="panel">
      <PanelHead title="İşlem Geçmişi" description="Kritik kayıtların kim tarafından ve ne zaman değiştirildiğini gösterir. Kayıtlar silinemez."
        actions={<>
          <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={loading}><Icon name="refresh" /> Yenile</button>
          <button type="button" className="btn btn-ghost" disabled={filtered.length === 0}
            onClick={() => downloadCsv("islem-gecmisi.csv", [["Tarih", "Kullanıcı", "İşlem", "Kayıt", "No", "Ayrıntı"], ...filtered.map((row) => [fmtDateTime(row.createdAt), row.username, ACTION_LABELS[row.action] ?? row.action, row.entity, row.entityId, row.details ?? ""])])}>
            <Icon name="download" /> CSV
          </button>
        </>} />
      <div className="filter-row">
        <SearchBox value={search} onChange={setSearch} placeholder="Kullanıcı, kayıt veya ayrıntı ara…" />
        <Select value={action} onChange={setAction} ariaLabel="İşlem türü filtresi"
          options={[{ value: "", label: "Tüm işlemler" }, ...actions.map((value) => ({ value, label: ACTION_LABELS[value] ?? value }))]} />
      </div>
      {loading
        ? <div className="skeleton-list"><div className="skeleton" style={{ height: 120 }} /></div>
        : <DataTable columns={columns} rows={filtered} rowKey={(row) => row.id} pageSize={15}
            empty={<EmptyState icon="history" title={rows.length ? "Filtreye uyan kayıt yok" : "Henüz işlem kaydı yok"} text="Satış, stok, kullanıcı ve parola işlemleri burada izlenir." />} />}
    </section>
  );
}
