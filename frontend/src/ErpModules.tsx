import { useCallback, useEffect, useState } from "react";
import {
  Badge, DataTable, EmptyState, Field, Icon, Modal, PanelHead, Select, StatCard, useUi,
  type Column,
} from "./ui";
import {
  api, downloadCsv, errorText, fmtDateTime, jsonInit, money, moneyRound, transferLabels,
  type Dealer, type Motorcycle, type Payment, type Role, type StockTransfer,
} from "./utils";

export function DealersPage({ role }: { role: Role }) {
  const { toast } = useUi();
  const isAdmin = role === "Admin";
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [perf, setPerf] = useState<{ id: number; name: string; saleCount: number; units: number; revenue: number; grossProfit: number; commission: number; receivable: number }[]>([]);
  const [editing, setEditing] = useState<Dealer | "new" | null>(null);
  const [form, setForm] = useState({ code: "", name: "", city: "", phone: "", taxNumber: "", address: "", commissionPercent: "0", creditLimit: "0" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await api("/dealers");
    if (r.ok) setDealers(await r.json());
    if (isAdmin) {
      const p = await api("/reports/dealer-performance");
      if (p.ok) setPerf(await p.json());
    }
  }, [isAdmin]);
  useEffect(() => { void load(); }, [load]);

  function open(d: Dealer | "new") {
    setForm(d === "new"
      ? { code: "", name: "", city: "", phone: "", taxNumber: "", address: "", commissionPercent: "8", creditLimit: "0" }
      : { code: d.code, name: d.name, city: d.city, phone: d.phone ?? "", taxNumber: d.taxNumber ?? "", address: d.address ?? "", commissionPercent: String(d.commissionPercent), creditLimit: String(d.creditLimit) });
    setEditing(d);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        code: form.code.trim(), name: form.name.trim(), city: form.city.trim(), phone: form.phone.trim() || null,
        taxNumber: form.taxNumber.trim() || null, address: form.address.trim() || null,
        commissionPercent: Number(form.commissionPercent) || 0, creditLimit: Number(form.creditLimit) || 0, isActive: true,
      };
      const isNew = editing === "new";
      const r = await api(isNew ? "/dealers" : `/dealers/${(editing as Dealer).id}`, jsonInit(isNew ? "POST" : "PUT", body));
      if (!r.ok) throw new Error(await errorText(r, "Bayi kaydedilemedi."));
      toast("success", isNew ? "Bayi oluşturuldu." : "Bayi güncellendi.");
      setEditing(null);
      await load();
    } catch (err) { toast("error", err instanceof Error ? err.message : "Bayi kaydedilemedi."); }
    finally { setSaving(false); }
  }

  const columns: Column<Dealer>[] = [
    { key: "code", header: "Kod", sort: (d) => d.code, render: (d) => <span className="cell-title">{d.code}</span> },
    { key: "name", header: "Bayi", sort: (d) => d.name, render: (d) => <>{d.name}{d.isHeadquarters && <span className="cell-sub">Merkez</span>}</> },
    { key: "city", header: "Şehir", render: (d) => d.city || "—" },
    { key: "comm", header: "Komisyon", align: "right", sort: (d) => d.commissionPercent, render: (d) => `%${d.commissionPercent}` },
    { key: "limit", header: "Kredi limiti", align: "right", render: (d) => d.creditLimit > 0 ? money(d.creditLimit) : "—" },
    { key: "st", header: "Durum", render: (d) => <Badge tone={d.isActive ? "success" : "danger"}>{d.isActive ? "Aktif" : "Pasif"}</Badge> },
    ...(isAdmin ? [{ key: "a", header: "", align: "right" as const, render: (d: Dealer) => <button type="button" className="icon-btn" title="Düzenle" onClick={() => open(d)}><Icon name="edit" /></button> }] : []),
  ];

  return (
    <>
      {isAdmin && perf.length > 0 && (
        <div className="stat-grid">
          <StatCard icon="building" tone="blue" label="Bayi sayısı" value={dealers.length} />
          <StatCard icon="cart" tone="green" label="Bayi cirosu" value={moneyRound(perf.reduce((t, p) => t + p.revenue, 0))} />
          <StatCard icon="wallet" tone="amber" label="Komisyon tahakkuku" value={moneyRound(perf.reduce((t, p) => t + p.commission, 0))} />
          <StatCard icon="chart" tone="violet" label="Açık alacak" value={moneyRound(perf.reduce((t, p) => t + p.receivable, 0))} />
        </div>
      )}
      <section className="panel">
        <PanelHead title="Bayi Ağı" description="Merkez depo ve bağlı bayiler. Konsinye sevk stok yerini değiştirir; toptan sevk muhasebe kaydı üretir."
          actions={isAdmin ? <button type="button" className="btn btn-primary" onClick={() => open("new")}><Icon name="plus" /> Yeni Bayi</button> : undefined} />
        <DataTable columns={columns} rows={dealers} rowKey={(d) => d.id} empty={<EmptyState icon="building" title="Bayi kaydı yok" />} />
      </section>
      {isAdmin && perf.length > 0 && (
        <section className="panel">
          <PanelHead title="Bayi Performansı" />
          <DataTable columns={[
            { key: "n", header: "Bayi", render: (p) => p.name },
            { key: "s", header: "Satış", align: "right", render: (p) => p.saleCount },
            { key: "u", header: "Adet", align: "right", render: (p) => p.units },
            { key: "r", header: "Ciro", align: "right", render: (p) => money(p.revenue) },
            { key: "g", header: "Brüt kâr", align: "right", render: (p) => money(p.grossProfit) },
            { key: "c", header: "Komisyon", align: "right", render: (p) => money(p.commission) },
            { key: "a", header: "Alacak", align: "right", render: (p) => money(p.receivable) },
          ]} rows={perf} rowKey={(p) => p.id} />
        </section>
      )}
      {editing && (
        <ModalForm title={editing === "new" ? "Yeni Bayi" : "Bayiyi Düzenle"} onClose={() => setEditing(null)} saving={saving} formId="dealer-form">
          <form id="dealer-form" className="form-grid cols-2" onSubmit={(e) => void save(e)}>
            <Field label="Kod"><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required disabled={editing !== "new"} /></Field>
            <Field label="Unvan"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
            <Field label="Şehir"><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
            <Field label="Telefon"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Vergi no"><input value={form.taxNumber} onChange={(e) => setForm({ ...form, taxNumber: e.target.value })} /></Field>
            <Field label="Komisyon %"><input type="number" min="0" max="100" step="0.1" value={form.commissionPercent} onChange={(e) => setForm({ ...form, commissionPercent: e.target.value })} /></Field>
            <Field label="Kredi limiti (TL)" className="span-all"><input type="number" min="0" step="0.01" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} /></Field>
            <Field label="Adres" className="span-all"><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          </form>
        </ModalForm>
      )}
    </>
  );
}

function ModalForm({ title, onClose, saving, formId, children }: { title: string; onClose: () => void; saving: boolean; formId: string; children: React.ReactNode }) {
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Vazgeç</button>
      <button type="submit" form={formId} className="btn btn-primary" disabled={saving}>{saving ? "Kaydediliyor…" : "Kaydet"}</button>
    </>}>{children}</Modal>
  );
}

export function TransfersPage({ motorcycles, role }: { motorcycles: Motorcycle[]; role: Role }) {
  const { toast, confirm } = useUi();
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [rows, setRows] = useState<StockTransfer[]>([]);
  const [inventory, setInventory] = useState<{ dealerId: number; dealer: string; isHeadquarters: boolean; items: { motorcycleId: number; brand: string; model: string; color: string; quantity: number; value: number }[] }[]>([]);
  const [form, setForm] = useState({ motorcycleId: "", fromDealerId: "", toDealerId: "", quantity: "1", transferType: "Consignment", note: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [d, t, inv] = await Promise.all([api("/dealers"), api("/stock-transfers"), api("/inventory")]);
    if (d.ok) setDealers(await d.json());
    if (t.ok) setRows(await t.json());
    if (inv.ok) setInventory(await inv.json());
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fromDealerId || !form.toDealerId) return toast("error", "Kaynak ve hedef şube seçin.");
    if (!form.motorcycleId) return toast("error", "Motosiklet seçin.");
    setSaving(true);
    try {
      const r = await api("/stock-transfers", jsonInit("POST", {
        motorcycleId: Number(form.motorcycleId), fromDealerId: Number(form.fromDealerId), toDealerId: Number(form.toDealerId),
        quantity: Number(form.quantity), transferType: form.transferType, note: form.note || null,
      }));
      if (!r.ok) throw new Error(await errorText(r, "Sevk oluşturulamadı."));
      toast("success", "Sevk taslağı oluştu. Gönder ile stok kaynak lokasyondan düşer.");
      setForm({ ...form, quantity: "1", note: "" });
      await load();
    } catch (err) { toast("error", err instanceof Error ? err.message : "Sevk oluşturulamadı."); }
    finally { setSaving(false); }
  }

  async function act(id: number, action: "ship" | "receive" | "cancel") {
    if (action === "cancel" && !(await confirm({ title: "Sevk iptal", message: "Yoldaki sevkte stok kaynağa iade edilir.", confirmText: "İptal et", danger: true }))) return;
    const r = await api(`/stock-transfers/${id}/${action}`, { method: "POST" });
    if (!r.ok) return toast("error", await errorText(r, "İşlem başarısız."));
    toast("success", action === "ship" ? "Sevk yola çıktı." : action === "receive" ? "Teslim alındı." : "Sevk iptal edildi.");
    await load();
  }

  const columns: Column<StockTransfer>[] = [
    { key: "id", header: "No", render: (t) => `#${t.id}` },
    { key: "m", header: "Ürün", render: (t) => t.motorcycle || `#${t.motorcycleId}` },
    { key: "r", header: "Rota", render: (t) => `${t.fromDealer ?? t.fromDealerId} → ${t.toDealer ?? t.toDealerId}` },
    { key: "q", header: "Adet", align: "center", render: (t) => t.quantity },
    { key: "ty", header: "Tür", render: (t) => t.transferType === "Wholesale" ? "Toptan" : "Konsinye" },
    { key: "st", header: "Durum", render: (t) => <Badge tone={t.status === "Received" ? "success" : t.status === "Shipped" ? "info" : t.status === "Cancelled" ? "danger" : "warning"}>{transferLabels[t.status] ?? t.status}</Badge> },
    { key: "a", header: "", align: "right", render: (t) => (
      <div className="row-actions">
        {t.status === "Draft" && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(t.id, "ship")}>Gönder</button>}
        {t.status === "Shipped" && <button type="button" className="btn btn-primary btn-sm" onClick={() => void act(t.id, "receive")}>Teslim al</button>}
        {(t.status === "Draft" || t.status === "Shipped") && role === "Admin" && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(t.id, "cancel")}>İptal</button>}
      </div>) },
  ];

  return (
    <>
      <section className="panel">
        <PanelHead title="Lokasyon Stokları" description="Merkez ve bayi depolarındaki adetler. Satış, bulunduğu lokasyonun stoğundan düşer." />
        <div className="inventory-grid">
          {inventory.map((loc) => (
            <article key={loc.dealerId} className="mini-stat">
              <span>{loc.dealer}{loc.isHeadquarters ? " · Merkez" : ""}</span>
              <strong>{loc.items.reduce((t, i) => t + i.quantity, 0)} adet</strong>
              <small>{money(loc.items.reduce((t, i) => t + i.value, 0))} stok değeri</small>
            </article>
          ))}
        </div>
      </section>
      <div className="split stack">
        <section className="panel">
          <PanelHead title="Yeni Sevk" description="1) Kaynak ve hedef seç  2) Ürün ve adet  3) Gönder  4) Hedefte teslim al." />
          <form className="form-grid cols-2" onSubmit={(e) => void create(e)}>
            <Field label="Kaynak"><Select value={form.fromDealerId} onChange={(v) => setForm({ ...form, fromDealerId: v })} options={dealers.map((d) => ({ value: String(d.id), label: d.name }))} required /></Field>
            <Field label="Hedef"><Select value={form.toDealerId} onChange={(v) => setForm({ ...form, toDealerId: v })} options={dealers.map((d) => ({ value: String(d.id), label: d.name }))} required /></Field>
            <Field label="Motosiklet" className="span-all"><Select value={form.motorcycleId} onChange={(v) => setForm({ ...form, motorcycleId: v })} searchable required
              options={motorcycles.map((m) => ({ value: String(m.id), label: `${m.brand} ${m.model}`, meta: m.color }))} /></Field>
            <Field label="Adet"><input type="number" min="1" step="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required /></Field>
            <Field label="Sevk türü"><Select value={form.transferType} onChange={(v) => setForm({ ...form, transferType: v })} options={[{ value: "Consignment", label: "Konsinye (mülkiyet merkezde)" }, { value: "Wholesale", label: "Toptan (bayiye satış)" }]} /></Field>
            <Field label="Not" className="span-all"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Oluşturuluyor…" : "Taslak oluştur"}</button>
          </form>
        </section>
        <section className="panel">
          <PanelHead title="Yönlendirme" />
          <ol className="guide-list">
            <li><strong>Konsinye:</strong> Stok bayiye gider, muhasebede satış oluşmaz. Bayi sattığında komisyon 331’e işlenir.</li>
            <li><strong>Toptan:</strong> Teslimde 120 Alıcılar / 600 Satış ve maliyet kaydı oluşur.</li>
            <li><strong>Perakende satış:</strong> Satışlar ekranında lokasyon seç; stok o depodan düşer, kasa/banka/cari otomatik yevmiyelenir.</li>
          </ol>
        </section>
      </div>
      <section className="panel">
        <PanelHead title="Sevkler" />
        <DataTable columns={columns} rows={rows} rowKey={(t) => t.id} empty={<EmptyState icon="swap" title="Sevk yok" text="Merkezden bayiye ilk sevki oluştur." />} />
      </section>
    </>
  );
}

export function PaymentsPage({ role }: { role: Role }) {
  const { toast } = useUi();
  const [rows, setRows] = useState<Payment[]>([]);
  const [form, setForm] = useState({ direction: "In", method: "Cash", amount: "", counterparty: "", note: "", saleId: "" });
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => { const r = await api("/payments"); if (r.ok) setRows(await r.json()); }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await api("/payments", jsonInit("POST", {
        direction: form.direction, method: form.method, amount: Number(form.amount),
        counterparty: form.counterparty || null, note: form.note || null, saleId: form.saleId ? Number(form.saleId) : null,
      }));
      if (!r.ok) throw new Error(await errorText(r, "Kayıt alınamadı."));
      toast("success", "Tahsilat/tediye ve yevmiye kaydı oluştu.");
      setForm({ ...form, amount: "", note: "", saleId: "" });
      await load();
    } catch (err) { toast("error", err instanceof Error ? err.message : "Kayıt alınamadı."); }
    finally { setSaving(false); }
  }

  const inSum = rows.filter((p) => p.direction === "In").reduce((t, p) => t + p.amount, 0);
  const outSum = rows.filter((p) => p.direction === "Out").reduce((t, p) => t + p.amount, 0);

  return (
    <>
      <div className="stat-grid">
        <StatCard icon="wallet" tone="green" label="Tahsilat" value={moneyRound(inSum)} />
        <StatCard icon="wallet" tone="red" label="Tediye" value={moneyRound(outSum)} />
        <StatCard icon="bank" tone="blue" label="Net kasa/banka hareketi" value={moneyRound(inSum - outSum)} />
      </div>
      <div className="split stack">
        <section className="panel">
          <PanelHead title="Yeni Hareket" description="Satış fişine bağlarsan açık bakiye (120 Alıcılar) kapanır." />
          <form className="form-grid cols-2" onSubmit={(e) => void save(e)}>
            <Field label="Yön"><Select value={form.direction} onChange={(v) => setForm({ ...form, direction: v })} options={[{ value: "In", label: "Tahsilat (giriş)" }, { value: "Out", label: "Tediye (çıkış)" }]} /></Field>
            <Field label="Kasa / banka"><Select value={form.method} onChange={(v) => setForm({ ...form, method: v })} options={[{ value: "Cash", label: "Kasa" }, { value: "Bank", label: "Banka" }, { value: "Card", label: "Kart" }]} /></Field>
            <Field label="Tutar (TL)"><input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required /></Field>
            <Field label="Satış no (isteğe bağlı)"><input value={form.saleId} onChange={(e) => setForm({ ...form, saleId: e.target.value })} placeholder="Örn. 12" /></Field>
            <Field label="Karşı taraf" className="span-all"><input value={form.counterparty} onChange={(e) => setForm({ ...form, counterparty: e.target.value })} /></Field>
            <Field label="Açıklama" className="span-all"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Kaydediliyor…" : "Kaydet"}</button>
          </form>
        </section>
        <section className="panel">
          <PanelHead title="Kayıtlar" actions={<button type="button" className="btn btn-ghost" onClick={() => downloadCsv("kasa.csv", [["Tarih", "Yön", "Yöntem", "Tutar", "Karşı taraf"], ...rows.map((p) => [fmtDateTime(p.paymentDate), p.direction, p.method, p.amount, p.counterparty ?? ""])])}><Icon name="download" /> CSV</button>} />
          <DataTable columns={[
            { key: "d", header: "Tarih", render: (p) => fmtDateTime(p.paymentDate) },
            { key: "y", header: "Yön", render: (p) => <Badge tone={p.direction === "In" ? "success" : "danger"}>{p.direction === "In" ? "Tahsilat" : "Tediye"}</Badge> },
            { key: "m", header: "Yöntem", render: (p) => p.method === "Bank" ? "Banka" : p.method === "Card" ? "Kart" : "Kasa" },
            { key: "a", header: "Tutar", align: "right", render: (p) => money(p.amount) },
            { key: "c", header: "Karşı taraf", render: (p) => p.counterparty || p.saleId ? `#${p.saleId ?? ""} ${p.counterparty ?? ""}` : "—" },
          ]} rows={rows} rowKey={(p) => p.id} empty={<EmptyState icon="wallet" title="Hareket yok" />} />
        </section>
      </div>
      {role === "Staff" && <p className="muted-text">Personel tahsilat girebilir; mizan ve bilanço yalnızca yöneticidedir.</p>}
    </>
  );
}

type Journal = { id: number; entryDate: string; description: string; source: string; isReversed: boolean; debit: number; credit: number; lines: { code?: string; name?: string; debit: number; credit: number; memo?: string }[] };
type SheetRow = { code: string; name: string; amount: number };

export function LedgerPage() {
  const { toast } = useUi();
  const [journals, setJournals] = useState<Journal[]>([]);
  const [accounts, setAccounts] = useState<{ code: string; name: string; type: string }[]>([]);
  const [open, setOpen] = useState<Journal | null>(null);
  const [manual, setManual] = useState(false);
  const [desc, setDesc] = useState("");
  const [lines, setLines] = useState([{ code: "100", debit: "", credit: "" }, { code: "120", debit: "", credit: "" }]);

  const load = useCallback(async () => {
    const [j, a] = await Promise.all([api("/journals"), api("/accounts")]);
    if (j.ok) setJournals(await j.json());
    if (a.ok) setAccounts(await a.json());
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    const r = await api("/journals", jsonInit("POST", {
      description: desc, lines: lines.map((l) => ({ code: l.code, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })),
    }));
    if (!r.ok) return toast("error", await errorText(r, "Yevmiye kaydedilemedi."));
    toast("success", "Mahsup fişi kaydedildi.");
    setManual(false); setDesc(""); await load();
  }

  return (
    <>
      <section className="panel">
        <PanelHead title="Hesap Planı" description="Tek düzen hesap planının ön muhasebe özeti. Satış, alış, gider ve kasa hareketleri bu hesaplara otomatik işlenir." />
        <div className="account-chips">{accounts.map((a) => <span key={a.code} className="badge badge-neutral">{a.code} {a.name}</span>)}</div>
      </section>
      <section className="panel">
        <PanelHead title="Yevmiye Defteri" actions={<button type="button" className="btn btn-primary" onClick={() => setManual(true)}><Icon name="plus" /> Mahsup fişi</button>} />
        <DataTable columns={[
          { key: "id", header: "Fiş", render: (j) => `#${j.id}` },
          { key: "d", header: "Tarih", render: (j) => fmtDateTime(j.entryDate) },
          { key: "s", header: "Kaynak", render: (j) => j.source },
          { key: "desc", header: "Açıklama", render: (j) => j.description },
          { key: "b", header: "Borç", align: "right", render: (j) => money(j.debit) },
          { key: "a", header: "Alacak", align: "right", render: (j) => money(j.credit) },
          { key: "x", header: "", align: "right", render: (j) => <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(j)}>Satırlar</button> },
        ]} rows={journals} rowKey={(j) => j.id} rowClass={(j) => j.isReversed ? "row-cancelled" : ""}
          empty={<EmptyState icon="book" title="Yevmiye boş" text="İlk satış veya gider kaydı otomatik fiş üretir." />} />
      </section>
      {open && (
        <Modal title={`Fiş #${open.id}`} onClose={() => setOpen(null)} size="lg">
          <table className="data-table"><thead><tr><th>Hesap</th><th className="align-right">Borç</th><th className="align-right">Alacak</th></tr></thead>
            <tbody>{open.lines.map((l, i) => <tr key={i}><td>{l.code} {l.name}<span className="cell-sub">{l.memo}</span></td><td className="align-right">{money(l.debit)}</td><td className="align-right">{money(l.credit)}</td></tr>)}</tbody></table>
        </Modal>
      )}
      {manual && (
        <Modal title="Mahsup Fişi" onClose={() => setManual(false)} size="lg" footer={<>
          <button type="button" className="btn btn-ghost" onClick={() => setManual(false)}>Vazgeç</button>
          <button type="submit" form="journal-form" className="btn btn-primary">Kaydet</button>
        </>}>
          <form id="journal-form" onSubmit={(e) => void post(e)} className="form-grid">
            <Field label="Açıklama" className="span-all"><input value={desc} onChange={(e) => setDesc(e.target.value)} required /></Field>
            {lines.map((l, i) => (
              <div key={i} className="form-grid cols-2 span-all" style={{ gridColumn: "1 / -1" }}>
                <Field label="Hesap"><Select value={l.code} onChange={(v) => setLines(lines.map((x, n) => n === i ? { ...x, code: v } : x))} options={accounts.map((a) => ({ value: a.code, label: `${a.code} ${a.name}` }))} /></Field>
                <Field label="Borç"><input type="number" step="0.01" value={l.debit} onChange={(e) => setLines(lines.map((x, n) => n === i ? { ...x, debit: e.target.value } : x))} /></Field>
                <Field label="Alacak"><input type="number" step="0.01" value={l.credit} onChange={(e) => setLines(lines.map((x, n) => n === i ? { ...x, credit: e.target.value } : x))} /></Field>
              </div>
            ))}
          </form>
        </Modal>
      )}
    </>
  );
}

export function BalancePage() {
  const [asOf, setAsOf] = useState("");
  const [sheet, setSheet] = useState<{ assets: SheetRow[]; liabilities: SheetRow[]; equity: SheetRow[]; netIncome: number; totalAssets: number; totalLiabilitiesAndEquity: number; balanced: boolean } | null>(null);
  const [income, setIncome] = useState<{ revenue: number; expenses: number; netIncome: number; rows: { code: string; name: string; type: string; amount: number }[] } | null>(null);
  const [trial, setTrial] = useState<{ rows: { code: string; name: string; type: string; debit: number; credit: number; balance: number }[]; totalDebit: number; totalCredit: number } | null>(null);

  const load = useCallback(async () => {
    const q = asOf ? `?asOf=${asOf}` : "";
    const [b, i, t] = await Promise.all([
      api(`/reports/balance-sheet${q}`),
      api("/reports/income-statement"),
      api(`/reports/trial-balance${q}`),
    ]);
    if (b.ok) setSheet(await b.json());
    if (i.ok) setIncome(await i.json());
    if (t.ok) setTrial(await t.json());
  }, [asOf]);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <div className="report-filters">
        <Field label="Bilanço tarihi"><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>Yenile</button>
      </div>
      {sheet && (
        <>
          <div className="stat-grid">
            <StatCard icon="bank" tone="blue" label="Aktif toplam" value={moneyRound(sheet.totalAssets)} />
            <StatCard icon="building" tone="violet" label="Pasif + özkaynak" value={moneyRound(sheet.totalLiabilitiesAndEquity)} />
            <StatCard icon="trend" tone={sheet.netIncome >= 0 ? "green" : "red"} label="Dönem net kâr/zarar" value={moneyRound(sheet.netIncome)} />
            <StatCard icon="check" tone={sheet.balanced ? "green" : "red"} label="Denk" value={sheet.balanced ? "Evet" : "Hayır"} hint="Aktif = Pasif + Özkaynak + kâr" />
          </div>
          <div className="split split-even stack">
            <section className="panel">
              <PanelHead title="Aktif (Varlıklar)" />
              <BalanceTable rows={sheet.assets} total={sheet.totalAssets} />
            </section>
            <section className="panel">
              <PanelHead title="Pasif ve Özkaynak" />
              <BalanceTable rows={[...sheet.liabilities, ...sheet.equity, { code: "590", name: "Dönem net kârı", amount: sheet.netIncome }]} total={sheet.totalLiabilitiesAndEquity} />
            </section>
          </div>
        </>
      )}
      {income && (
        <section className="panel">
          <PanelHead title="Gelir Tablosu" description={`Hasılat ${money(income.revenue)} · Gider ${money(income.expenses)}`} />
          <DataTable columns={[
            { key: "c", header: "Hesap", render: (r) => `${r.code} ${r.name}` },
            { key: "t", header: "Tür", render: (r) => r.type === "Income" ? "Gelir" : "Gider" },
            { key: "a", header: "Tutar", align: "right", render: (r) => money(r.amount) },
          ]} rows={income.rows} rowKey={(r) => r.code} empty={<EmptyState icon="chart" title="Dönem hareketi yok" />} />
        </section>
      )}
      {trial && (
        <section className="panel">
          <PanelHead title="Mizan" description={`Borç ${money(trial.totalDebit)} · Alacak ${money(trial.totalCredit)}`} />
          <DataTable columns={[
            { key: "c", header: "Kod", render: (r) => r.code },
            { key: "n", header: "Hesap", render: (r) => r.name },
            { key: "d", header: "Borç", align: "right", render: (r) => money(r.debit) },
            { key: "a", header: "Alacak", align: "right", render: (r) => money(r.credit) },
            { key: "b", header: "Bakiye", align: "right", render: (r) => money(r.balance) },
          ]} rows={trial.rows} rowKey={(r) => r.code} />
        </section>
      )}
    </>
  );
}

function BalanceTable({ rows, total }: { rows: SheetRow[]; total: number }) {
  return (
    <table className="data-table">
      <tbody>
        {rows.filter((r) => r.amount !== 0).map((r) => (
          <tr key={r.code + r.name}><td>{r.code} {r.name}</td><td className="align-right">{money(r.amount)}</td></tr>
        ))}
        <tr><td className="cell-title">Toplam</td><td className="align-right cell-title">{money(total)}</td></tr>
      </tbody>
    </table>
  );
}

