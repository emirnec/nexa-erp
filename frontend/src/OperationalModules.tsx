import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Badge, DataTable, EmptyState, Field, Icon, Modal, PanelHead, SearchBox, Select,
  StatCard, Tabs, useUi, type Column,
} from "./ui";
import { useNow } from "./useNow";
import {
  api, downloadCsv, errorText, fmtDate, fmtDateTime, jsonInit, money, trLower,
  type Customer, type Dealer, type Motorcycle,
} from "./utils";

export type ModuleKey = "calendar" | "service" | "parts" | "purchasing" | "tradein" | "crm" | "finance" | "automation";

type Workflow = {
  id: number; module: string; title: string; status: string;
  description?: string | null; referenceNo?: string | null; amount?: number | null;
  quantity?: number | null; dueAt?: string | null; payload: string;
  customerId?: number | null; motorcycleId?: number | null; dealerId?: number | null;
  createdAt: string; updatedAt: string;
};

type FieldKey = "customer" | "motorcycle" | "dealer" | "amount" | "quantity" | "dueAt" | "reference" | "description";

type ModuleMeta = {
  label: string; desc: string; icon: string; fields: FieldKey[];
  titlePlaceholder: string; amountLabel?: string; quantityLabel?: string; referenceLabel?: string;
  adminOnly?: boolean;
};

const MODULE_META: Record<ModuleKey, ModuleMeta> = {
  calendar: {
    label: "Takvim ve Görevler", icon: "calendar", desc: "Randevu, teslimat, arama ve hatırlatma görevleri",
    fields: ["dueAt", "dealer", "description"], titlePlaceholder: "Örn. Ahmet Bey teslimat randevusu",
  },
  service: {
    label: "Servis Yönetimi", icon: "wrench", desc: "Servis kabul, bakım, arıza ve iş emri kayıtları",
    fields: ["customer", "motorcycle", "dealer", "dueAt", "amount", "description"],
    titlePlaceholder: "Örn. 10.000 km periyodik bakım", amountLabel: "İşçilik / parça tutarı (₺)",
  },
  parts: {
    label: "Yedek Parça", icon: "package", desc: "Parça kodu, stok ve fiyat kayıtları", adminOnly: true,
    fields: ["reference", "quantity", "amount", "description"], titlePlaceholder: "Örn. Hava filtresi",
    referenceLabel: "Parça kodu", quantityLabel: "Adet", amountLabel: "Birim fiyat (₺)",
  },
  purchasing: {
    label: "Satın Alma", icon: "shopping-cart", desc: "Tedarikçi siparişi, mal kabul ve maliyet", adminOnly: true,
    fields: ["reference", "quantity", "amount", "dueAt", "description"], titlePlaceholder: "Örn. Lastik siparişi",
    referenceLabel: "Sipariş / irsaliye no", quantityLabel: "Adet", amountLabel: "Sipariş tutarı (₺)",
  },
  tradein: {
    label: "Takas ve İkinci El", icon: "repeat", desc: "İkinci el araç, ekspertiz ve takas değerlemesi", adminOnly: true,
    fields: ["customer", "motorcycle", "amount", "description"], titlePlaceholder: "Örn. 2021 model takas değerlemesi",
    amountLabel: "Takas değeri (₺)",
  },
  crm: {
    label: "Müşteri İlişkileri", icon: "users", desc: "Müşteri talebi, teklif ve satış takibi",
    fields: ["customer", "amount", "dueAt", "description"], titlePlaceholder: "Örn. filo teklifi görüşmesi",
    amountLabel: "Teklif tutarı (₺)",
  },
  finance: {
    label: "Cari ve Finans", icon: "credit-card", desc: "Ödeme planı, taksit ve cari takip kayıtları", adminOnly: true,
    fields: ["customer", "reference", "amount", "dueAt", "description"], titlePlaceholder: "Örn. 12 taksit ödeme planı",
    referenceLabel: "Sözleşme / plan no", amountLabel: "Tutar (₺)",
  },
  automation: {
    label: "Otomasyon Merkezi", icon: "workflow", desc: "Hatırlatma, plan talebi ve otomasyon görevleri", adminOnly: true,
    fields: ["reference", "dueAt", "description"], titlePlaceholder: "Örn. bakım hatırlatma kuralı",
    referenceLabel: "Kural / referans kodu",
  },
};

const STATUS: Record<string, { label: string; tone: "neutral" | "info" | "warning" | "success" | "danger" }> = {
  Open: { label: "Açık", tone: "info" },
  InProgress: { label: "Devam ediyor", tone: "warning" },
  Waiting: { label: "Beklemede", tone: "warning" },
  Completed: { label: "Tamamlandı", tone: "success" },
  Cancelled: { label: "İptal", tone: "danger" },
};

const CLOSED = ["Completed", "Cancelled"];

type FormState = {
  title: string; status: string; description: string; referenceNo: string;
  customerId: string; motorcycleId: string; dealerId: string;
  amount: string; quantity: string; dueAt: string; payload: string;
};

const EMPTY_FORM: FormState = {
  title: "", status: "Open", description: "", referenceNo: "",
  customerId: "", motorcycleId: "", dealerId: "",
  amount: "", quantity: "", dueAt: "", payload: "{}",
};

function toInputDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dueState(value?: string | null, status?: string) {
  if (!value || (status && CLOSED.includes(status))) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const diff = date.getTime() - Date.now();
  if (diff < 0) return { label: "Gecikti", tone: "danger" as const };
  if (diff < 86_400_000) return { label: "Bugün", tone: "warning" as const };
  return null;
}

export function OperationalModules({ module, role }: { module: ModuleKey; role: string }) {
  const meta = MODULE_META[module];
  const readOnly = meta.adminOnly === true && role !== "Admin";
  const { toast, confirm } = useUi();
  const [rows, setRows] = useState<Workflow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [motorcycles, setMotorcycles] = useState<Motorcycle[]>([]);
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [workflowResponse, customerResponse, motorcycleResponse, dealerResponse] = await Promise.all([
        api(`/workflows/${module}`), api("/customers"), api("/motorcycles"), api("/dealers"),
      ]);
      if (!workflowResponse.ok) throw new Error(await errorText(workflowResponse, "Kayıtlar alınamadı."));
      setRows(await workflowResponse.json());
      if (customerResponse.ok) setCustomers(await customerResponse.json());
      if (motorcycleResponse.ok) setMotorcycles(await motorcycleResponse.json());
      if (dealerResponse.ok) setDealers(await dealerResponse.json());
    } catch (error) {
      toast("error", error instanceof Error ? error.message : "Kayıtlar alınamadı.");
    } finally { setLoading(false); }
  }, [module, toast]);

  useEffect(() => { void load(); }, [load]);

  const customerName = (id?: number | null) => customers.find((item) => item.id === id)?.fullName;
  const motorcycleName = (id?: number | null) => {
    const item = motorcycles.find((moto) => moto.id === id);
    return item ? `${item.brand} ${item.model}` : undefined;
  };
  const dealerName = (id?: number | null) => dealers.find((item) => item.id === id)?.name;

  const now = useNow();
  const stats = useMemo(() => {
    const open = rows.filter((row) => !CLOSED.includes(row.status));
    const overdue = now > 0 ? open.filter((row) => row.dueAt && new Date(row.dueAt).getTime() < now) : [];
    const completed = rows.filter((row) => row.status === "Completed");
    const amount = rows.reduce((sum, row) => sum + (row.amount ?? 0), 0);
    return { open: open.length, overdue: overdue.length, completed: completed.length, amount };
  }, [rows, now]);

  const filtered = useMemo(() => {
    const query = trLower(search.trim());
    return rows.filter((row) => {
      const matchesQuery = !query || trLower(`${row.title} ${row.description ?? ""} ${row.referenceNo ?? ""} ${customerName(row.customerId) ?? ""} ${motorcycleName(row.motorcycleId) ?? ""}`).includes(query);
      const matchesStatus = statusFilter === "all"
        || (statusFilter === "open" && !CLOSED.includes(row.status))
        || (statusFilter === "overdue" && now > 0 && !CLOSED.includes(row.status) && !!row.dueAt && new Date(row.dueAt).getTime() < now)
        || row.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [rows, search, statusFilter, customers, motorcycles, dealers, now]);

  const tabs = useMemo(() => ([
    { value: "all", label: "Tümü", count: rows.length },
    { value: "open", label: "Açık", count: stats.open },
    { value: "overdue", label: "Geciken", count: stats.overdue },
    { value: "Completed", label: "Tamamlanan", count: stats.completed },
  ]), [rows.length, stats]);

  function openNew() {
    setForm({ ...EMPTY_FORM, status: "Open", payload: "{}" });
    setEditing("new");
  }

  function openEdit(row: Workflow) {
    setForm({
      title: row.title, status: row.status, description: row.description ?? "",
      referenceNo: row.referenceNo ?? "", customerId: row.customerId ? String(row.customerId) : "",
      motorcycleId: row.motorcycleId ? String(row.motorcycleId) : "",
      dealerId: row.dealerId ? String(row.dealerId) : "",
      amount: row.amount != null ? String(row.amount) : "",
      quantity: row.quantity != null ? String(row.quantity) : "",
      dueAt: toInputDate(row.dueAt), payload: row.payload || "{}",
    });
    setEditing(row.id);
  }

  function bodyFor(statusOverride?: string, row?: Workflow) {
    const amountValue = form.amount === "" ? null : Number(form.amount);
    const quantityValue = form.quantity === "" ? null : Number(form.quantity);
    let parsed: unknown;
    try { parsed = JSON.parse(form.payload || "{}"); } catch { parsed = null; }
    return {
      module,
      title: (row?.title ?? form.title).trim(),
      status: statusOverride ?? (row?.status ?? form.status),
      description: (row?.description ?? form.description).trim() || null,
      referenceNo: (row?.referenceNo ?? form.referenceNo).trim() || null,
      customerId: row?.customerId ?? (form.customerId ? Number(form.customerId) : null),
      motorcycleId: row?.motorcycleId ?? (form.motorcycleId ? Number(form.motorcycleId) : null),
      dealerId: row?.dealerId ?? (form.dealerId ? Number(form.dealerId) : null),
      amount: row ? row.amount ?? null : amountValue,
      quantity: row ? row.quantity ?? null : quantityValue,
      dueAt: row?.dueAt ?? (form.dueAt ? new Date(form.dueAt).toISOString() : null),
      payload: JSON.stringify(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}),
    };
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form.title.trim()) return toast("error", "Başlık zorunludur.");
    if (form.amount !== "" && (!Number.isFinite(Number(form.amount)) || Number(form.amount) < 0)) return toast("error", "Tutar sıfır veya daha büyük olmalıdır.");
    if (form.quantity !== "" && (!Number.isInteger(Number(form.quantity)) || Number(form.quantity) < 0)) return toast("error", "Adet sıfır veya daha büyük bir tam sayı olmalıdır.");
    let parsed: unknown;
    try { parsed = JSON.parse(form.payload || "{}"); } catch { return toast("error", "Teknik ek alanlar geçerli JSON olmalıdır."); }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return toast("error", "Teknik ek alanlar bir JSON nesnesi olmalıdır.");
    setSaving(true);
    try {
      const response = await api(editing === "new" ? "/workflows" : `/workflows/${module}/${editing}`, jsonInit(editing === "new" ? "POST" : "PUT", bodyFor()));
      if (!response.ok) throw new Error(await errorText(response, "Kayıt kaydedilemedi."));
      toast("success", editing === "new" ? "Kayıt oluşturuldu." : "Kayıt güncellendi.");
      setEditing(null);
      await load();
    } catch (error) {
      toast("error", error instanceof Error ? error.message : "Kayıt kaydedilemedi.");
    } finally { setSaving(false); }
  }

  async function quickComplete(row: Workflow) {
    const response = await api(`/workflows/${module}/${row.id}`, jsonInit("PUT", { ...row, status: "Completed" }));
    if (!response.ok) return toast("error", await errorText(response, "Durum güncellenemedi."));
    toast("success", "Kayıt tamamlandı olarak işaretlendi.");
    await load();
  }

  async function remove(row: Workflow) {
    if (!(await confirm({ title: "Kaydı sil", message: `“${row.title}” kaydı kalıcı olarak silinecek. Bu işlem geri alınamaz.`, confirmText: "Sil", danger: true }))) return;
    try {
      const response = await api(`/workflows/${module}/${row.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await errorText(response, "Kayıt silinemedi."));
      toast("success", "Kayıt silindi.");
      await load();
    } catch (error) {
      toast("error", error instanceof Error ? error.message : "Kayıt silinemedi.");
    }
  }

  function exportCsv() {
    downloadCsv(`${module}-kayitlari.csv`, [
      ["Başlık", "Durum", "Müşteri", "Ürün", "Şube", "Referans", "Vade", "Tutar", "Adet", "Açıklama"],
      ...filtered.map((row) => [
        row.title, STATUS[row.status]?.label ?? row.status, customerName(row.customerId) ?? "",
        motorcycleName(row.motorcycleId) ?? "", dealerName(row.dealerId) ?? "", row.referenceNo ?? "",
        row.dueAt ? fmtDateTime(row.dueAt) : "", row.amount ?? "", row.quantity ?? "", row.description ?? "",
      ]),
    ]);
  }

  const columns: Column<Workflow>[] = [
    {
      key: "title", header: "Kayıt", sort: (row) => row.title,
      render: (row) => <><span className="cell-title">{row.title}</span>{row.description && <span className="table-subtext">{row.description}</span>}</>,
    },
    {
      key: "related", header: "İlgili",
      render: (row) => {
        const values = [customerName(row.customerId), motorcycleName(row.motorcycleId), dealerName(row.dealerId)].filter(Boolean);
        return values.length ? values.join(" · ") : <span className="muted-text">—</span>;
      },
    },
    { key: "ref", header: "Referans", render: (row) => row.referenceNo || <span className="muted-text">—</span> },
    {
      key: "due", header: "Vade", sort: (row) => (row.dueAt ? new Date(row.dueAt).getTime() : Number.MAX_SAFE_INTEGER),
      render: (row) => {
        if (!row.dueAt) return <span className="muted-text">—</span>;
        const state = dueState(row.dueAt, row.status);
        return <>{fmtDate(row.dueAt)}{state && <span className="cell-sub"><Badge tone={state.tone}>{state.label}</Badge></span>}</>;
      },
    },
    { key: "amount", header: "Tutar", align: "right", sort: (row) => row.amount ?? 0, render: (row) => row.amount != null ? money(row.amount) : <span className="muted-text">—</span> },
    {
      key: "status", header: "Durum",
      render: (row) => { const state = STATUS[row.status] ?? { label: row.status || "Bilinmiyor", tone: "neutral" as const }; return <Badge tone={state.tone}>{state.label}</Badge>; },
    },
    {
      key: "actions", header: "", align: "right",
      render: (row) => (
        <div className="row-actions">
          {!CLOSED.includes(row.status) && <button type="button" className="icon-btn" title="Tamamlandı olarak işaretle" aria-label="Tamamlandı olarak işaretle" onClick={() => void quickComplete(row)}><Icon name="check" /></button>}
          <button type="button" className="icon-btn" title="Düzenle" aria-label="Düzenle" onClick={() => openEdit(row)}><Icon name="edit" /></button>
          {role === "Admin" && <button type="button" className="icon-btn danger" title="Sil" aria-label="Sil" onClick={() => void remove(row)}><Icon name="trash" /></button>}
        </div>
      ),
    },
  ];

  const customerOptions = [{ value: "", label: "Müşteri seçme" }, ...customers.map((item) => ({ value: String(item.id), label: item.fullName, meta: item.phone ?? "" }))];
  const motorcycleOptions = [{ value: "", label: "Ürün seçme" }, ...motorcycles.map((item) => ({ value: String(item.id), label: `${item.brand} ${item.model}`, meta: item.color }))];
  const dealerOptions = [{ value: "", label: "Şube seçme" }, ...dealers.map((item) => ({ value: String(item.id), label: item.name, meta: item.city }))];

  return (
    <div className="page-stack">
      <div className="stat-grid">
        <StatCard icon={meta.icon} tone="blue" label="Toplam kayıt" value={rows.length} hint={meta.label} />
        <StatCard icon="clock" tone="amber" label="Açık iş" value={stats.open} hint="Tamamlanmayı bekleyen" />
        <StatCard icon="alert" tone={stats.overdue > 0 ? "red" : "green"} label="Geciken" value={stats.overdue} hint="Vadesi geçen kayıt" />
        {meta.fields.includes("amount")
          ? <StatCard icon="wallet" tone="violet" label="Toplam tutar" value={money(stats.amount)} hint="Kayıtlardaki tutar toplamı" />
          : <StatCard icon="check-circle" tone="green" label="Tamamlanan" value={stats.completed} hint="Kapatılan kayıt" />}
      </div>

      <section className="panel">
        <PanelHead title={meta.label} description={`${meta.desc}. Kayıtlar işletmeye ve şubeye göre izole edilir.`}
          actions={<>
            <button type="button" className="btn btn-ghost" onClick={exportCsv} disabled={filtered.length === 0}><Icon name="download" /> CSV</button>
            <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={loading}><Icon name="refresh" /> Yenile</button>
            {!readOnly && <button type="button" className="btn btn-primary" onClick={openNew}><Icon name="plus" /> Yeni Kayıt</button>}
          </>} />

        {readOnly && <div className="callout callout-info"><Icon name="info" /><div>Bu modül yalnızca yönetici tarafından düzenlenebilir. Kayıtları görüntüleyebilirsiniz.</div></div>}

        <Tabs tabs={tabs} value={statusFilter} onChange={setStatusFilter} ariaLabel={`${meta.label} durum filtreleri`} />
        <div className="filter-row">
          <SearchBox value={search} onChange={setSearch} placeholder="Başlık, müşteri, ürün veya referans ara…" />
          <Select value={statusFilter} onChange={setStatusFilter} ariaLabel="Durum"
            options={[{ value: "all", label: "Tüm durumlar" }, { value: "open", label: "Açık kayıtlar" }, { value: "overdue", label: "Gecikenler" }, ...Object.entries(STATUS).map(([value, state]) => ({ value, label: state.label }))]} />
        </div>

        {loading
          ? <div className="skeleton-list"><div className="skeleton" style={{ height: 120 }} /></div>
          : <DataTable columns={columns} rows={filtered} rowKey={(row) => row.id} pageSize={12}
              empty={<EmptyState icon={meta.icon} title={rows.length ? "Filtreye uyan kayıt yok" : "Henüz kayıt yok"} text={readOnly ? "Bu modülde görüntülenecek kayıt bulunmuyor." : "“Yeni Kayıt” ile ilk kaydı oluşturabilirsiniz."} />} />}
      </section>

      {editing !== null && (
        <Modal title={editing === "new" ? `Yeni ${meta.label} Kaydı` : `${meta.label} Kaydını Düzenle`} size="lg" onClose={() => setEditing(null)}
          footer={<>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Vazgeç</button>
            <button type="submit" form="workflow-form" className="btn btn-primary" disabled={saving}>{saving ? "Kaydediliyor…" : "Kaydet"}</button>
          </>}>
          <form id="workflow-form" className="form-grid cols-2" onSubmit={(e) => void save(e)}>
            <Field label="Başlık" className="span-all">
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={180} required placeholder={meta.titlePlaceholder} />
            </Field>
            <Field label="Durum">
              <Select value={form.status} onChange={(value) => setForm({ ...form, status: value })}
                options={Object.entries(STATUS).map(([value, state]) => ({ value, label: state.label }))} />
            </Field>
            {meta.fields.includes("reference") && (
              <Field label={meta.referenceLabel ?? "Referans / belge no"}>
                <input value={form.referenceNo} onChange={(e) => setForm({ ...form, referenceNo: e.target.value })} maxLength={80} placeholder="Varsa belge numarası" />
              </Field>
            )}
            {meta.fields.includes("dueAt") && (
              <Field label="Tarih / hatırlatıcı">
                <input type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
              </Field>
            )}
            {meta.fields.includes("customer") && (
              <Field label="Müşteri">
                <Select value={form.customerId} onChange={(value) => setForm({ ...form, customerId: value })} options={customerOptions} searchable />
              </Field>
            )}
            {meta.fields.includes("motorcycle") && (
              <Field label="Ürün / araç">
                <Select value={form.motorcycleId} onChange={(value) => setForm({ ...form, motorcycleId: value })} options={motorcycleOptions} searchable />
              </Field>
            )}
            {meta.fields.includes("dealer") && role === "Admin" && (
              <Field label="Şube / lokasyon">
                <Select value={form.dealerId} onChange={(value) => setForm({ ...form, dealerId: value })} options={dealerOptions} />
              </Field>
            )}
            {meta.fields.includes("amount") && (
              <Field label={meta.amountLabel ?? "Tutar (₺)"}>
                <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0,00" />
              </Field>
            )}
            {meta.fields.includes("quantity") && (
              <Field label={meta.quantityLabel ?? "Adet"}>
                <input type="number" min="0" step="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="0" />
              </Field>
            )}
            {meta.fields.includes("description") && (
              <Field label="Açıklama / not" className="span-all">
                <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={2000} placeholder="Müşteri talebi, yapılan işlem veya not…" />
              </Field>
            )}
            <details className="span-all" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <summary className="muted-text" style={{ cursor: "pointer", fontSize: 12.5 }}>Teknik ek alanlar (isteğe bağlı)</summary>
              <div style={{ marginTop: 10 }}>
                <Field label="JSON nesnesi" hint="Yalnızca ileri düzey kullanım içindir. Boş bırakırsanız {} kaydedilir.">
                  <textarea rows={3} value={form.payload} onChange={(e) => setForm({ ...form, payload: e.target.value })} spellCheck={false} className="code-input" />
                </Field>
              </div>
            </details>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ═════════════ Katalog yönetimi ═════════════ */

type CatalogItem = {
  id: number; motorcycleId: number; publicDescription: string; imageUrls: string;
  isPublished: boolean; brand: string; model: string; price: number; stockQuantity: number;
};

function parseImages(raw?: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string" && /^https?:\/\//i.test(value)) : [];
  } catch { return []; }
}

export function CatalogManagement({ motorcycles }: { motorcycles: Motorcycle[] }) {
  const { toast, confirm } = useUi();
  const [rows, setRows] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState("");
  const [description, setDescription] = useState("");
  const [imagesText, setImagesText] = useState("");
  const [published, setPublished] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api("/catalog");
      if (!response.ok) throw new Error(await errorText(response, "Katalog kayıtları alınamadı."));
      setRows(await response.json());
    } catch (error) {
      toast("error", error instanceof Error ? error.message : "Katalog kayıtları alınamadı.");
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const tenantSlug = localStorage.getItem("mca_tenant") || "";
  const filtered = useMemo(() => {
    const query = trLower(search.trim());
    return rows.filter((row) => !query || trLower(`${row.brand} ${row.model}`).includes(query));
  }, [rows, search]);
  const publishedCount = rows.filter((row) => row.isPublished).length;
  const selectedMoto = motorcycles.find((moto) => String(moto.id) === selected);
  const imageList = imagesText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  function reset() {
    setEditingId(null); setSelected(""); setDescription(""); setImagesText(""); setPublished(false);
  }

  function edit(row: CatalogItem) {
    setEditingId(row.id);
    setSelected(String(row.motorcycleId));
    setDescription(row.publicDescription || "");
    setImagesText(parseImages(row.imageUrls).join("\n"));
    setPublished(row.isPublished);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!selected) return toast("error", "Önce bir envanter ürünü seçin.");
    const invalid = imageList.find((url) => {
      try { const parsed = new URL(url); return !["http:", "https:"].includes(parsed.protocol); } catch { return true; }
    });
    if (invalid) return toast("error", `Geçersiz görsel bağlantısı: ${invalid}`);
    setBusy(true);
    try {
      const existing = editingId ?? rows.find((row) => row.motorcycleId === Number(selected))?.id ?? null;
      const body = { motorcycleId: Number(selected), publicDescription: description.trim(), imageUrls: JSON.stringify(imageList), isPublished: published };
      const response = await api(existing ? `/catalog/${existing}` : "/catalog", jsonInit(existing ? "PUT" : "POST", body));
      if (!response.ok) throw new Error(await errorText(response, "Katalog kaydı kaydedilemedi."));
      toast("success", published ? "Ürün katalogda yayınlandı." : "Katalog kaydı taslak olarak kaydedildi.");
      reset();
      await load();
    } catch (error) {
      toast("error", error instanceof Error ? error.message : "Katalog kaydı kaydedilemedi.");
    } finally { setBusy(false); }
  }

  async function remove(row: CatalogItem) {
    if (!(await confirm({ title: "Katalog kaydını sil", message: `${row.brand} ${row.model} katalog kaydı silinecek. Envanter kaydı korunur.`, confirmText: "Sil", danger: true }))) return;
    try {
      const response = await api(`/catalog/${row.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await errorText(response, "Katalog kaydı silinemedi."));
      if (editingId === row.id) reset();
      toast("success", "Katalog kaydı silindi.");
      await load();
    } catch (error) {
      toast("error", error instanceof Error ? error.message : "Katalog kaydı silinemedi.");
    }
  }

  const columns: Column<CatalogItem>[] = [
    {
      key: "product", header: "Ürün", sort: (row) => `${row.brand} ${row.model}`,
      render: (row) => <><span className="cell-title">{row.brand} {row.model}</span><span className="table-subtext">{row.publicDescription || "Açıklama eklenmemiş"}</span></>,
    },
    { key: "price", header: "Fiyat", align: "right", sort: (row) => Number(row.price), render: (row) => money(Number(row.price)) },
    { key: "stock", header: "Stok", align: "center", sort: (row) => row.stockQuantity, render: (row) => row.stockQuantity },
    { key: "images", header: "Görsel", align: "center", render: (row) => parseImages(row.imageUrls).length },
    { key: "status", header: "Durum", render: (row) => <Badge tone={row.isPublished ? "success" : "neutral"}>{row.isPublished ? "Yayında" : "Taslak"}</Badge> },
    {
      key: "actions", header: "", align: "right",
      render: (row) => <div className="row-actions">
        <button type="button" className="icon-btn" title="Düzenle" aria-label="Düzenle" onClick={() => edit(row)}><Icon name="edit" /></button>
        <button type="button" className="icon-btn danger" title="Sil" aria-label="Sil" onClick={() => void remove(row)}><Icon name="trash" /></button>
      </div>,
    },
  ];

  return (
    <div className="page-stack">
      <div className="stat-grid">
        <StatCard icon="book" tone="blue" label="Katalog kaydı" value={rows.length} hint="Envanterden seçilen ürün" />
        <StatCard icon="check-circle" tone="green" label="Yayında" value={publishedCount} hint="Müşteriye görünen" />
        <StatCard icon="file" tone="amber" label="Taslak" value={rows.length - publishedCount} hint="Henüz yayınlanmadı" />
        <StatCard icon="external" tone="violet" label="Katalog" value="Açık" hint="Girişsiz erişim" />
      </div>

      <section className="panel">
        <PanelHead title={editingId ? "Katalog kaydını düzenle" : "Kataloğa ürün ekle"}
          description="Envanterdeki ürünleri seçin, açıklama ve fotoğraf ekleyin, ardından müşteri kataloğunda yayınlayın."
          actions={<a className="btn btn-ghost" href={`/catalog${tenantSlug ? `?tenant=${encodeURIComponent(tenantSlug)}` : ""}`} target="_blank" rel="noreferrer"><Icon name="external" /> Müşteri kataloğu</a>} />
        <form className="form-grid" onSubmit={(e) => void save(e)}>
          <Field label="Envanter ürünü" className="span-all">
            <Select value={selected} onChange={setSelected} searchable required placeholder="Envanterden ürün seç"
              options={motorcycles.map((moto) => ({ value: String(moto.id), label: `${moto.brand} ${moto.model}`, meta: `${moto.color} · ${money(moto.price)}` }))} />
          </Field>
          <Field label="Müşteriye açık açıklama" className="span-all">
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000}
              placeholder="Öne çıkan özellikler, garanti ve teslimat bilgileri…" />
          </Field>
          <Field label="Fotoğraf bağlantıları" className="span-all" hint="Her satıra bir adet http/https görsel bağlantısı yazın.">
            <textarea rows={3} value={imagesText} onChange={(e) => setImagesText(e.target.value)} spellCheck={false}
              placeholder={"https://ornek.com/urun-on.jpg\nhttps://ornek.com/urun-yan.jpg"} />
          </Field>
          {imageList.length > 0 && (
            <div className="catalog-preview span-all">
              {imageList.slice(0, 6).map((url, index) => (
                <img key={`${url}-${index}`} src={url} alt={`Önizleme ${index + 1}`} referrerPolicy="no-referrer"
                  onError={(event) => { event.currentTarget.style.opacity = ".25"; }} />
              ))}
            </div>
          )}
          <label className="checkbox-line span-all">
            <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
            Ürünü müşterilerin görebileceği katalogda yayınla
          </label>
          {selectedMoto && (
            <div className="callout callout-info span-all">
              <Icon name="bike" />
              <div><strong>{selectedMoto.brand} {selectedMoto.model}</strong> · {selectedMoto.engineCapacityCc} cc · {money(selectedMoto.price)} · stok {selectedMoto.stockQuantity}</div>
            </div>
          )}
          <div className="form-actions span-all">
            <button type="submit" className="btn btn-primary" disabled={busy || loading || !selected}>{busy ? "Kaydediliyor…" : editingId ? "Değişiklikleri kaydet" : "Katalog kaydını kaydet"}</button>
            {editingId && <button type="button" className="btn btn-ghost" onClick={reset} disabled={busy}>Vazgeç</button>}
          </div>
        </form>
      </section>

      <section className="panel">
        <PanelHead title="Katalog kayıtları" description={`${publishedCount} ürün yayında · ${rows.length - publishedCount} taslak`}
          actions={<button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={loading}><Icon name="refresh" /> Yenile</button>} />
        <div className="filter-row"><SearchBox value={search} onChange={setSearch} placeholder="Model ara…" /></div>
        {loading
          ? <div className="skeleton-list"><div className="skeleton" style={{ height: 110 }} /></div>
          : <DataTable columns={columns} rows={filtered} rowKey={(row) => row.id}
              empty={<EmptyState icon="book" title={rows.length ? "Eşleşen kayıt yok" : "Henüz katalog kaydı yok"} text="Yukarıdaki formdan ilk ürünü ekleyin." />} />}
      </section>
    </div>
  );
}
