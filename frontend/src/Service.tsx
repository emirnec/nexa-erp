import { useCallback, useEffect, useRef, useState } from "react";
import {
  Badge, DataTable, EmptyState, Field, Icon, Modal, PanelHead, Select, StatCard, useUi,
  type Column,
} from "./ui";
import {
  api, errorText, fmtDateTime, jsonInit, money, moneyRound, type Customer, type Motorcycle,
  type Part, type Role, type ServiceOrder,
} from "./utils";

type DraftItem = {
  key: number;
  kind: string;
  description: string;
  quantity: string;
  unitPrice: string;
  unitCost: string;
  partId: string;
};

const emptyItem = (key: number): DraftItem => ({
  key, kind: "Labor", description: "", quantity: "1", unitPrice: "", unitCost: "", partId: "",
});

const statusLabels: Record<string, string> = {
  Open: "Açık", InProgress: "Devam ediyor", Ready: "Hazır", Invoiced: "Faturalandı", Cancelled: "İptal",
};

const statusTone = (status: string): "success" | "warning" | "info" | "danger" | "neutral" =>
  status === "Invoiced" ? "success" : status === "Ready" ? "info" : status === "Cancelled" ? "danger" : status === "InProgress" ? "warning" : "neutral";

export function PartsPage({ role }: { role: Role }) {
  const { toast } = useUi();
  const isAdmin = role === "Admin";
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ code: "", name: "", stockQuantity: "0", purchaseCost: "", salePrice: "" });
  const [saving, setSaving] = useState(false);
  const [stockPart, setStockPart] = useState<Part | null>(null);
  const [stockForm, setStockForm] = useState({ movementType: "PurchaseIn", quantity: "1", unitCost: "", note: "" });

  const load = useCallback(async () => {
    const response = await api("/parts?includeInactive=true");
    if (response.ok) setParts(await response.json());
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const response = await api("/parts", jsonInit("POST", {
        code: form.code.trim(), name: form.name.trim(), stockQuantity: Number(form.stockQuantity) || 0,
        purchaseCost: Number(form.purchaseCost) || 0, salePrice: Number(form.salePrice) || 0, isActive: true,
      }));
      if (!response.ok) throw new Error(await errorText(response, "Parça kaydedilemedi."));
      toast("success", "Parça kartı oluşturuldu.");
      setForm({ code: "", name: "", stockQuantity: "0", purchaseCost: "", salePrice: "" });
      await load();
    } catch (error) { toast("error", error instanceof Error ? error.message : "Parça kaydedilemedi."); }
    finally { setSaving(false); }
  }

  async function adjustStock(e: React.FormEvent) {
    e.preventDefault();
    if (!stockPart) return;
    setSaving(true);
    try {
      const response = await api(`/parts/${stockPart.id}/stock`, jsonInit("POST", {
        quantity: Number(stockForm.quantity) || 0, unitCost: Number(stockForm.unitCost) || 0,
        note: stockForm.note.trim() || null, movementType: stockForm.movementType,
      }));
      if (!response.ok) throw new Error(await errorText(response, "Parça stoğu güncellenemedi."));
      toast("success", "Parça stoğu güncellendi.");
      setStockPart(null);
      await load();
    } catch (error) { toast("error", error instanceof Error ? error.message : "Parça stoğu güncellenemedi."); }
    finally { setSaving(false); }
  }

  const columns: Column<Part>[] = [
    { key: "code", header: "Kod", sort: (p) => p.code, render: (p) => <span className="cell-title">{p.code}</span> },
    { key: "name", header: "Parça", sort: (p) => p.name, render: (p) => p.name },
    { key: "stock", header: "Stok", align: "right", sort: (p) => p.stockQuantity, render: (p) => <Badge tone={p.stockQuantity <= 2 ? "warning" : "success"}>{p.stockQuantity}</Badge> },
    { key: "cost", header: "Maliyet", align: "right", render: (p) => money(p.purchaseCost) },
    { key: "price", header: "Satış", align: "right", render: (p) => money(p.salePrice) },
    { key: "status", header: "Durum", render: (p) => <Badge tone={p.isActive ? "success" : "neutral"}>{p.isActive ? "Aktif" : "Pasif"}</Badge> },
    ...(isAdmin ? [{ key: "actions", header: "", align: "right" as const, render: (p: Part) => (
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setStockPart(p); setStockForm({ movementType: "PurchaseIn", quantity: "1", unitCost: String(p.purchaseCost), note: "" }); }}>
        <Icon name="plus" size={14} /> Stok
      </button>) }] : []),
  ];

  return (
    <>
      <section className="panel">
        <PanelHead title="Yedek Parça Stoğu" description="Servis iş emrinde kullanılan parçalar buradan yönetilir. Fatura kesildiğinde parça stoğu otomatik düşer." />
        {loading ? <div className="skeleton" style={{ height: 120 }} /> : <DataTable columns={columns} rows={parts} rowKey={(p) => p.id}
          empty={<EmptyState icon="package" title="Parça kaydı yok" text="Servis için ilk parçayı ekleyin." />} />}
      </section>

      {isAdmin && (
        <section className="panel">
          <PanelHead title="Yeni Parça" />
          <form className="form-grid cols-2" onSubmit={(e) => void create(e)}>
            <Field label="Parça kodu"><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required placeholder="FRN-001" /></Field>
            <Field label="Parça adı"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
            <Field label="Açılış stoğu"><input type="number" min="0" step="1" value={form.stockQuantity} onChange={(e) => setForm({ ...form, stockQuantity: e.target.value })} /></Field>
            <Field label="Alış maliyeti (TL)"><input type="number" min="0" step="0.01" value={form.purchaseCost} onChange={(e) => setForm({ ...form, purchaseCost: e.target.value })} /></Field>
            <Field label="Satış fiyatı (TL)"><input type="number" min="0" step="0.01" value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} /></Field>
            <div className="form-actions span-all"><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Kaydediliyor…" : "Parçayı Kaydet"}</button></div>
          </form>
        </section>
      )}

      {stockPart && (
        <Modal title={`${stockPart.code} — Stok Hareketi`} onClose={() => setStockPart(null)} footer={<>
          <button type="button" className="btn btn-ghost" onClick={() => setStockPart(null)}>Vazgeç</button>
          <button type="submit" form="part-stock-form" className="btn btn-primary" disabled={saving}>{saving ? "Kaydediliyor…" : "Kaydet"}</button>
        </>}>
          <form id="part-stock-form" className="form-grid" onSubmit={(e) => void adjustStock(e)}>
            <Field label="Hareket"><Select value={stockForm.movementType} onChange={(value) => setStockForm({ ...stockForm, movementType: value })}
              options={[{ value: "PurchaseIn", label: "Satın alma girişi" }, { value: "ManualIn", label: "Manuel giriş" }, { value: "ManualOut", label: "Manuel çıkış" }]} /></Field>
            <Field label="Adet"><input type="number" min="1" step="1" value={stockForm.quantity} onChange={(e) => setStockForm({ ...stockForm, quantity: e.target.value })} required /></Field>
            <Field label="Birim maliyet"><input type="number" min="0" step="0.01" value={stockForm.unitCost} onChange={(e) => setStockForm({ ...stockForm, unitCost: e.target.value })} /></Field>
            <Field label="Not"><input value={stockForm.note} onChange={(e) => setStockForm({ ...stockForm, note: e.target.value })} /></Field>
          </form>
        </Modal>
      )}
    </>
  );
}

export function ServicePage({ role }: { role: Role }) {
  const { toast } = useUi();
  const isAdmin = role === "Admin";
  const nextKey = useRef(1);
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [motorcycles, setMotorcycles] = useState<Motorcycle[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ customerId: "", motorcycleId: "", complaint: "", diagnosis: "", notes: "", dueDate: "" });
  const [items, setItems] = useState<DraftItem[]>([emptyItem(0)]);
  const [saving, setSaving] = useState(false);
  const [invoice, setInvoice] = useState<ServiceOrder | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("Cash");

  const load = useCallback(async () => {
    const [o, c, m, p] = await Promise.all([api("/service-orders"), api("/customers"), api("/motorcycles"), api("/parts")]);
    if (o.ok) setOrders(await o.json());
    if (c.ok) setCustomers(await c.json());
    if (m.ok) setMotorcycles(await m.json());
    if (p.ok) setParts(await p.json());
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const openCount = orders.filter((o) => o.status === "Open").length;
  const activeCount = orders.filter((o) => o.status === "InProgress" || o.status === "Ready").length;
  const invoicedTotal = orders.filter((o) => o.status === "Invoiced").reduce((t, o) => t + o.total, 0);
  const draftLines = items.filter((i) => i.description.trim());
  const draftLaborTotal = draftLines.filter((i) => i.kind === "Labor").reduce((t, i) => t + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);
  const draftPartsTotal = draftLines.filter((i) => i.kind === "Part").reduce((t, i) => t + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);
  const selectedCustomer = customers.find((c) => String(c.id) === form.customerId);
  const selectedMotorcycle = motorcycles.find((m) => String(m.id) === form.motorcycleId);

  function updateItem(key: number, patch: Partial<DraftItem>) {
    setItems((rows) => rows.map((row) => row.key === key ? { ...row, ...patch } : row));
  }

  function pickPart(key: number, partId: string) {
    const part = parts.find((p) => String(p.id) === partId);
    updateItem(key, part
      ? { partId, description: part.name, unitPrice: String(part.salePrice), unitCost: String(part.purchaseCost) }
      : { partId, description: "", unitPrice: "", unitCost: "" });
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const payloadItems = items.filter((i) => i.description.trim()).map((i) => ({
      kind: i.kind, description: i.description.trim(), quantity: Number(i.quantity) || 1,
      unitPrice: Number(i.unitPrice) || 0, unitCost: Number(i.unitCost) || 0,
      partId: i.kind === "Part" && i.partId ? Number(i.partId) : null,
    }));
    if (!payloadItems.length) return toast("error", "En az bir işçilik veya parça satırı ekleyin.");
    setSaving(true);
    try {
      const response = await api("/service-orders", jsonInit("POST", {
        customerId: form.customerId ? Number(form.customerId) : null,
        motorcycleId: form.motorcycleId ? Number(form.motorcycleId) : null,
        complaint: form.complaint.trim() || null, diagnosis: form.diagnosis.trim() || null,
        notes: form.notes.trim() || null, dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
        items: payloadItems,
      }));
      if (!response.ok) throw new Error(await errorText(response, "Servis iş emri oluşturulamadı."));
      toast("success", "Servis iş emri açıldı.");
      setForm({ customerId: "", motorcycleId: "", complaint: "", diagnosis: "", notes: "", dueDate: "" });
      setItems([emptyItem(nextKey.current++)]);
      await load();
    } catch (error) { toast("error", error instanceof Error ? error.message : "Servis iş emri oluşturulamadı."); }
    finally { setSaving(false); }
  }

  async function act(order: ServiceOrder, action: "start" | "ready" | "cancel") {
    const response = await api(`/service-orders/${order.id}/${action}`, { method: "POST" });
    if (!response.ok) return toast("error", await errorText(response, "İşlem başarısız."));
    toast("success", action === "start" ? "İş emri başlatıldı." : action === "ready" ? "İş emri hazır." : "İş emri iptal edildi.");
    await load();
  }

  async function doInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!invoice) return;
    setSaving(true);
    try {
      const response = await api(`/service-orders/${invoice.id}/invoice`, jsonInit("POST", { paymentMethod }));
      if (!response.ok) throw new Error(await errorText(response, "Fatura kesilemedi."));
      toast("success", `Servis faturası kesildi: ${money(invoice.total)}`);
      setInvoice(null);
      await load();
    } catch (error) { toast("error", error instanceof Error ? error.message : "Fatura kesilemedi."); }
    finally { setSaving(false); }
  }

  const columns: Column<ServiceOrder>[] = [
    { key: "no", header: "No", sort: (o) => o.id, render: (o) => <span className="cell-title">{o.orderNo}</span> },
    { key: "date", header: "Açılış", sort: (o) => new Date(o.openedAt).getTime(), render: (o) => fmtDateTime(o.openedAt) },
    { key: "customer", header: "Müşteri", render: (o) => <>{o.customer || "—"}{o.motorcycle && <span className="cell-sub">{o.motorcycle}</span>}</> },
    { key: "complaint", header: "Şikâyet", render: (o) => o.complaint || <span className="muted-text">—</span> },
    { key: "total", header: "Tutar", align: "right", sort: (o) => o.total, render: (o) => o.total > 0 ? money(o.total) : <span className="muted-text">—</span> },
    { key: "status", header: "Durum", render: (o) => <Badge tone={statusTone(o.status)}>{statusLabels[o.status] ?? o.status}</Badge> },
    { key: "actions", header: "", align: "right", render: (o) => (
      <div className="row-actions">
        {o.status === "Open" && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(o, "start")}>Başlat</button>}
        {o.status === "InProgress" && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(o, "ready")}>Hazır</button>}
        {o.status === "Ready" && <button type="button" className="btn btn-primary btn-sm" onClick={() => { setInvoice(o); setPaymentMethod("Cash"); }}>Faturala</button>}
        {isAdmin && o.status !== "Invoiced" && o.status !== "Cancelled" && <button type="button" className="icon-btn danger" title="İptal" onClick={() => void act(o, "cancel")}><Icon name="x" size={15} /></button>}
      </div>) },
  ];

  return (
    <>
      <div className="stat-grid">
        <StatCard icon="wrench" tone="blue" label="Açık iş emri" value={openCount} />
        <StatCard icon="clock" tone="amber" label="Aktif servis" value={activeCount} />
        <StatCard icon="check" tone="green" label="Faturalanan" value={moneyRound(invoicedTotal)} />
        <StatCard icon="package" tone="violet" label="Parça kalemi" value={orders.reduce((t, o) => t + o.items.filter((i) => i.kind === "Part").length, 0)} />
      </div>

      <div className="split stack">
        <section className="panel">
          <PanelHead title="Yeni Servis İş Emri" description="Müşteri ve aracı seç, işçilik/parça kalemlerini ekle. Parça stoğu fatura kesildiğinde düşülür." />
          <form id="service-order-form" className="form-grid cols-2" onSubmit={(e) => void create(e)}>
          <Field label="Müşteri"><Select value={form.customerId} onChange={(value) => setForm({ ...form, customerId: value })}
            options={[{ value: "", label: "Müşteri seç (opsiyonel)" }, ...customers.map((c) => ({ value: String(c.id), label: c.fullName, meta: c.phone ?? "" }))]} searchable /></Field>
          <Field label="Motosiklet"><Select value={form.motorcycleId} onChange={(value) => setForm({ ...form, motorcycleId: value })}
            options={[{ value: "", label: "Araç seç (opsiyonel)" }, ...motorcycles.map((m) => ({ value: String(m.id), label: `${m.brand} ${m.model}`, meta: m.color }))]} searchable /></Field>
          <Field label="Şikâyet"><input value={form.complaint} onChange={(e) => setForm({ ...form, complaint: e.target.value })} placeholder="Fren sesi, yağ değişimi…" /></Field>
          <Field label="Teşhis"><input value={form.diagnosis} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} /></Field>
          <Field label="Teslim / vade"><input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
          <Field label="Not"><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <div className="span-all">
            <div className="service-lines">
              <div className="service-line-head" aria-hidden="true">
                <span>Açıklama</span><span>Tür</span><span>Adet</span><span>Fiyat</span><span>Maliyet</span><span />
              </div>
              {items.map((item) => (
                <div className="service-line" key={item.key}>
                  <div className="service-line-main">
                    <input value={item.description} onChange={(e) => updateItem(item.key, { description: e.target.value })} placeholder="İşçilik veya parça" aria-label="Kalem açıklaması" />
                    {item.kind === "Part" && (
                      <Select value={item.partId} onChange={(value) => pickPart(item.key, value)}
                        options={[{ value: "", label: "Stoktan parça seç" }, ...parts.filter((p) => p.stockQuantity > 0).map((p) => ({ value: String(p.id), label: `${p.code} · ${p.name}`, meta: `Stok: ${p.stockQuantity}` }))]} searchable />
                    )}
                  </div>
                  <select value={item.kind} onChange={(e) => updateItem(item.key, { kind: e.target.value, partId: "" })} aria-label="Kalem türü">
                    <option value="Labor">İşçilik</option><option value="Part">Parça</option>
                  </select>
                  <input type="number" min="1" step="1" value={item.quantity} onChange={(e) => updateItem(item.key, { quantity: e.target.value })} aria-label="Adet" />
                  <input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(e) => updateItem(item.key, { unitPrice: e.target.value })} placeholder="Fiyat" aria-label="Birim fiyat" />
                  <input type="number" min="0" step="0.01" value={item.unitCost} onChange={(e) => updateItem(item.key, { unitCost: e.target.value })} placeholder="Maliyet" aria-label="Birim maliyet" />
                  <button type="button" className="icon-btn danger" aria-label="Satırı kaldır" onClick={() => setItems((rows) => rows.filter((r) => r.key !== item.key))}><Icon name="x" size={15} /></button>
                </div>
              ))}
              <div className="extra-editor-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setItems((rows) => [...rows, emptyItem(nextKey.current++)])}><Icon name="plus" size={15} /> Kalem ekle</button>
                <span className="muted-text">Toplam: <strong>{money(draftLaborTotal + draftPartsTotal)}</strong></span>
              </div>
            </div>
          </div>
        </form>
        </section>

        <section className="panel">
          <PanelHead title="Servis Özeti" />
          <div className="summary-box">
            <div className="summary-row"><span>Müşteri</span><strong>{selectedCustomer?.fullName ?? "Seçilmedi"}</strong></div>
            <div className="summary-row"><span>Araç</span><strong>{selectedMotorcycle ? `${selectedMotorcycle.brand} ${selectedMotorcycle.model}` : "Seçilmedi"}</strong></div>
            <div className="summary-row"><span>Kalem</span><strong>{draftLines.length} satır</strong></div>
            <div className="summary-row"><span>İşçilik</span><strong>{money(draftLaborTotal)}</strong></div>
            <div className="summary-row"><span>Parça</span><strong>{money(draftPartsTotal)}</strong></div>
            <div className="summary-total"><span>Toplam</span><strong>{money(draftLaborTotal + draftPartsTotal)}</strong></div>
          </div>
          <div className="callout callout-info" style={{ marginTop: 14 }}>
            <Icon name="alert" />
            <div>Parça stoğu iş emri açılırken değil, <strong>fatura kesilirken</strong> düşülür. Böylece iş emri düzenlenirken stok kilitlenmez.</div>
          </div>
          <button type="submit" form="service-order-form" className="btn btn-primary btn-block" style={{ marginTop: 16 }} disabled={saving}>
            {saving ? "Oluşturuluyor…" : "İş Emrini Aç"}
          </button>
        </section>
      </div>

      <section className="panel">
        <PanelHead title="Servis İş Emirleri" description={`${orders.length} kayıt`} />
        {loading ? <div className="skeleton" style={{ height: 120 }} />
          : <DataTable columns={columns} rows={orders} rowKey={(o) => o.id} empty={<EmptyState icon="wrench" title="Servis iş emri yok" />} />}
      </section>

      {invoice && (
        <Modal title={`${invoice.orderNo} — Fatura`} onClose={() => setInvoice(null)} footer={<>
          <button type="button" className="btn btn-ghost" onClick={() => setInvoice(null)}>Vazgeç</button>
          <button type="submit" form="service-invoice-form" className="btn btn-primary" disabled={saving}>{saving ? "Kesiliyor…" : "Faturayı Kes"}</button>
        </>}>
          <form id="service-invoice-form" className="form-grid" onSubmit={(e) => void doInvoice(e)}>
            <div className="summary-box span-all">
              <div className="summary-row"><span>İşçilik</span><strong>{money(invoice.totalLabor)}</strong></div>
              <div className="summary-row"><span>Parça</span><strong>{money(invoice.totalParts)}</strong></div>
              <div className="summary-total"><span>Toplam</span><strong>{money(invoice.total)}</strong></div>
            </div>
            <Field label="Ödeme yöntemi"><Select value={paymentMethod} onChange={setPaymentMethod}
              options={[{ value: "Cash", label: "Nakit" }, { value: "Card", label: "Kart" }, { value: "Credit", label: "Vadeli (cari)" }]} /></Field>
          </form>
        </Modal>
      )}
    </>
  );
}
