import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge, DataTable, EmptyState, Field, Icon, MetricNote, Modal, PanelHead, SearchBox, Select, StatCard, useUi,
  type Column, type Option,
} from "./ui";
import {
  api, dateKey, downloadCsv, errorText, fmtDate, fmtDateTime, jsonInit, money, moneyRound, movementLabels, saleName, trLower,
  type Customer, type Motorcycle, type Role, type Sale,
} from "./utils";

/* ═════════════ MÜŞTERİLER ═════════════ */
export function CustomersPage({ customers, role, reload, initialSearch = "" }: { customers: Customer[]; role: Role; reload: () => Promise<void>; initialSearch?: string }) {
  const { toast } = useUi();
  const isAdmin = role === "Admin";
  const [search, setSearch] = useState(initialSearch);
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const [form, setForm] = useState({ fullName: "", phone: "", email: "", notes: "", creditLimit: "0" });
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<{ customer: Customer; sales: Sale[] } | null>(null);
  const [account, setAccount] = useState<{
    customer: Customer; totalOutstanding: number; creditLimit: number; creditAvailable?: number | null;
    sales: { id: number; invoiceNo?: string | null; saleDate: string; totalPrice: number; paidAmount: number; outstanding: number; dueDate?: string | null; isCancelled: boolean }[];
  } | null>(null);

  const rows = useMemo(() => {
    const q = trLower(search.trim());
    return customers.filter((c) => !q || trLower(`${c.fullName} ${c.phone ?? ""} ${c.email ?? ""}`).includes(q));
  }, [customers, search]);

  function openForm(c: Customer | "new") {
    setForm(c === "new" ? { fullName: "", phone: "", email: "", notes: "", creditLimit: "0" } : { fullName: c.fullName, phone: c.phone ?? "", email: c.email ?? "", notes: c.notes ?? "", creditLimit: String(c.creditLimit ?? 0) });
    setEditing(c);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const isNew = editing === "new";
      const body = { fullName: form.fullName.trim(), phone: form.phone.trim() || null, email: form.email.trim() || null, notes: form.notes.trim() || null, creditLimit: isAdmin ? Number(form.creditLimit) || 0 : 0 };
      const r = await api(isNew ? "/customers" : `/customers/${(editing as Customer).id}`, jsonInit(isNew ? "POST" : "PUT", body));
      if (!r.ok) throw new Error(await errorText(r, "Müşteri kaydedilemedi."));
      toast("success", isNew ? "Müşteri kaydedildi." : "Müşteri güncellendi.");
      setEditing(null);
      await reload();
    } catch (err) { toast("error", err instanceof Error ? err.message : "Müşteri kaydedilemedi."); }
    finally { setSaving(false); }
  }

  async function openAccount(c: Customer) {
    const response = await api(`/customers/${c.id}/account`);
    if (!response.ok) return toast("error", await errorText(response, "Cari hesap alınamadı."));
    setAccount(await response.json());
  }

  async function openHistory(c: Customer) {
    const r = await api(`/customers/${c.id}/sales`);
    if (!r.ok) return toast("error", await errorText(r, "Satış geçmişi alınamadı."));
    setHistory({ customer: c, sales: await r.json() });
  }

  const columns: Column<Customer>[] = [
    { key: "name", header: "Ad soyad", sort: (c) => c.fullName, render: (c) => <span className="cell-title">{c.fullName}</span> },
    { key: "phone", header: "Telefon", render: (c) => c.phone || <span className="muted-text">—</span> },
    { key: "email", header: "E-posta", render: (c) => c.email || <span className="muted-text">—</span> },
    { key: "limit", header: "Kredi limiti", align: "right", sort: (c) => c.creditLimit ?? 0, render: (c) => c.creditLimit && c.creditLimit > 0 ? money(c.creditLimit) : <span className="muted-text">Limit yok</span> },
    { key: "notes", header: "Not", render: (c) => c.notes ? <span title={c.notes}>{c.notes.length > 32 ? `${c.notes.slice(0, 32)}…` : c.notes}</span> : <span className="muted-text">—</span> },
    { key: "actions", header: "", align: "right", render: (c) => (
      <div className="row-actions">
        <button type="button" className="icon-btn" title="Cari hesap" aria-label="Cari hesap" onClick={() => void openAccount(c)}><Icon name="credit-card" /></button>
        <button type="button" className="icon-btn" title="Satış geçmişi" aria-label="Satış geçmişi" onClick={() => void openHistory(c)}><Icon name="history" /></button>
        <button type="button" className="icon-btn" title="Düzenle" aria-label="Düzenle" onClick={() => openForm(c)}><Icon name="edit" /></button>
      </div>) },
  ];

  return (
    <section className="panel">
      <PanelHead title="Müşteriler" description="Telefon numarası girilen satışlar eşleşen müşteri kartına otomatik bağlanır."
        actions={<>
          <button type="button" className="btn btn-ghost" disabled={rows.length === 0} onClick={() => downloadCsv("musteriler.csv", [["Ad soyad", "Telefon", "E-posta", "Not"], ...rows.map((c) => [c.fullName, c.phone ?? "", c.email ?? "", c.notes ?? ""])])}><Icon name="download" /> CSV</button>
          <button type="button" className="btn btn-primary" onClick={() => openForm("new")}><Icon name="plus" /> Yeni Müşteri</button>
        </>} />
      <div className="filter-row"><SearchBox value={search} onChange={setSearch} placeholder="İsim, telefon veya e-posta ara…" /></div>
      <DataTable columns={columns} rows={rows} rowKey={(c) => c.id}
        empty={<EmptyState icon="users" title={customers.length ? "Eşleşen müşteri yok" : "Henüz müşteri kaydı yok"} text={customers.length ? undefined : "İlk satışta veya “Yeni Müşteri” ile kart oluşur."} />} />

      {editing && (
        <Modal title={editing === "new" ? "Yeni Müşteri" : "Müşteriyi Düzenle"} onClose={() => setEditing(null)}
          footer={<><button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Vazgeç</button>
            <button type="submit" form="customer-form" className="btn btn-primary" disabled={saving}>{saving ? "Kaydediliyor…" : "Kaydet"}</button></>}>
          <form id="customer-form" className="form-grid cols-2" onSubmit={(e) => void save(e)}>
            <Field label="Ad soyad" className="span-all"><input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required /></Field>
            <Field label="Telefon"><input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="05xx xxx xx xx" /></Field>
            <Field label="E-posta"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Kredi limiti (TL)" hint={isAdmin ? "0 = limit yok. Vadeli satışlarda açık bakiye bu limiti aşamaz." : "Kredi limitini yalnızca yönetici belirler."}><input type="number" min="0" step="0.01" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} disabled={!isAdmin} /></Field>
            <Field label="Not" className="span-all"><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="İsteğe bağlı" /></Field>
          </form>
        </Modal>
      )}

      {account && (
        <Modal title={`${account.customer.fullName} — Cari Hesap`} size="lg" onClose={() => setAccount(null)}
          footer={<button type="button" className="btn btn-ghost" onClick={() => setAccount(null)}>Kapat</button>}>
          <div className="mini-stats">
            <div className="mini-stat"><span>Açık bakiye</span><strong>{money(account.totalOutstanding)}</strong></div>
            <div className="mini-stat"><span>Kredi limiti</span><strong>{account.creditLimit > 0 ? money(account.creditLimit) : "Limit yok"}</strong></div>
            <div className="mini-stat"><span>Kullanılabilir</span><strong>{account.creditAvailable == null ? "—" : money(account.creditAvailable)}</strong></div>
          </div>
          <DataTable rows={account.sales} rowKey={(s) => s.id} pageSize={8}
            empty={<EmptyState icon="cart" title="Cari hareket yok" />}
            columns={[
              { key: "id", header: "No", render: (s) => `#${s.id}` },
              { key: "d", header: "Tarih", render: (s) => fmtDate(s.saleDate) },
              { key: "t", header: "Tutar", align: "right", render: (s) => money(s.totalPrice) },
              { key: "p", header: "Ödenen", align: "right", render: (s) => money(s.paidAmount) },
              { key: "o", header: "Kalan", align: "right", render: (s) => <span className={s.outstanding > 0 ? "negative-text" : "positive-text"}>{money(s.outstanding)}</span> },
              { key: "v", header: "Vade", render: (s) => s.dueDate ? fmtDate(s.dueDate) : "—" },
            ]} />
        </Modal>
      )}

      {history && (
        <Modal title={`${history.customer.fullName} — Satış Geçmişi`} size="lg" onClose={() => setHistory(null)}
          footer={<button type="button" className="btn btn-ghost" onClick={() => setHistory(null)}>Kapat</button>}>
          {history.sales.length === 0 ? <EmptyState icon="cart" title="Bu müşterinin satışı yok" /> : <>
            <div className="mini-stats">
              <div className="mini-stat"><span>Toplam alışveriş</span><strong>{money(history.sales.filter((s) => !s.isCancelled).reduce((t, s) => t + s.totalPrice, 0))}</strong></div>
              <div className="mini-stat"><span>Satış adedi</span><strong>{history.sales.filter((s) => !s.isCancelled).length}</strong></div>
            </div>
            <DataTable rows={history.sales} rowKey={(s) => s.id} pageSize={6} rowClass={(s) => (s.isCancelled ? "row-cancelled" : "")} columns={[
              { key: "id", header: "No", render: (s: Sale) => `#${s.id}` },
              { key: "d", header: "Tarih", render: (s: Sale) => fmtDate(s.saleDate) },
              { key: "m", header: "Motosiklet", render: (s: Sale) => saleName(s, []) },
              { key: "q", header: "Adet", align: "center", render: (s: Sale) => s.quantity },
              { key: "t", header: "Tutar", align: "right", render: (s: Sale) => money(s.totalPrice) },
              { key: "s", header: "Durum", render: (s: Sale) => s.isCancelled ? <Badge tone="danger">İptal</Badge> : <Badge tone="success">Aktif</Badge> },
            ]} />
          </>}
        </Modal>
      )}
    </section>
  );
}

/* ═════════════ STOK ═════════════ */
type Movement = { id: number; motorcycleId: number; motorcycle?: Motorcycle; movementType: string; quantity: number; unitCost: number; note?: string | null; createdAt: string };
const OUT_TYPES = ["ManualOut", "SaleOut"];

export function StockPage({ motorcycles, role, reloadMotorcycles }: { motorcycles: Motorcycle[]; role: Role; reloadMotorcycles: () => Promise<void> }) {
  const { toast } = useUi();
  const isAdmin = role === "Admin";
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [motoId, setMotoId] = useState("");
  const [type, setType] = useState(isAdmin ? "PurchaseIn" : "ManualIn");
  const [qty, setQty] = useState("1");
  const [cost, setCost] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [filterMoto, setFilterMoto] = useState("");
  const [filterType, setFilterType] = useState("");

  const load = useCallback(async () => {
    const r = await api("/stock-movements");
    if (r.ok) setMovements(await r.json());
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const moto = motorcycles.find((m) => String(m.id) === motoId);
  const motoOptions: Option[] = motorcycles.map((m) => ({ value: String(m.id), label: `${m.brand} ${m.model} · ${m.color}`, meta: `Stok: ${m.stockQuantity}` }));
  const typeOptions: Option[] = [
    ...(isAdmin ? [{ value: "PurchaseIn", label: "Satın alma girişi (maliyetli)" }] : []),
    { value: "ManualIn", label: "Diğer stok girişi" }, { value: "ManualOut", label: "Manuel stok çıkışı" },
  ];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!motoId) return toast("error", "Motosiklet seçin.");
    const quantity = Number(qty);
    if (!Number.isInteger(quantity) || quantity <= 0) return toast("error", "Adet sıfırdan büyük bir tam sayı olmalı.");
    if (type === "ManualOut" && moto && quantity > moto.stockQuantity) return toast("error", `Yetersiz stok. Mevcut: ${moto.stockQuantity}`);
    setSaving(true);
    try {
      const r = await api("/stock-movements", jsonInit("POST", { motorcycleId: Number(motoId), movementType: type, quantity, unitCost: type === "PurchaseIn" ? Number(cost) || 0 : 0, note: note.trim() || null }));
      if (!r.ok) throw new Error(await errorText(r, "Stok hareketi kaydedilemedi."));
      toast("success", "Stok hareketi kaydedildi.");
      setQty("1"); setNote(""); setCost("");
      await Promise.all([load(), reloadMotorcycles()]);
    } catch (err) { toast("error", err instanceof Error ? err.message : "Stok hareketi kaydedilemedi."); }
    finally { setSaving(false); }
  }

  const rows = movements.filter((m) => (!filterMoto || String(m.motorcycleId) === filterMoto) && (!filterType || m.movementType === filterType));
  const tone = (t: string) => (t === "SaleOut" ? "info" : t === "ManualOut" ? "warning" : t === "SaleReturn" ? "neutral" : "success") as "info" | "warning" | "neutral" | "success";

  const columns: Column<Movement>[] = [
    { key: "d", header: "Tarih", sort: (m) => new Date(m.createdAt).getTime(), render: (m) => fmtDateTime(m.createdAt) },
    { key: "m", header: "Motosiklet", render: (m) => m.motorcycle ? `${m.motorcycle.brand} ${m.motorcycle.model}` : `#${m.motorcycleId}` },
    { key: "t", header: "Tür", render: (m) => <Badge tone={tone(m.movementType)}>{movementLabels[m.movementType] ?? m.movementType}</Badge> },
    { key: "q", header: "Adet", align: "right", sort: (m) => m.quantity, render: (m) => <span className={OUT_TYPES.includes(m.movementType) ? "negative-text" : "positive-text"}>{OUT_TYPES.includes(m.movementType) ? "−" : "+"}{m.quantity}</span> },
    ...(isAdmin ? [{ key: "c", header: "Birim maliyet", align: "right" as const, render: (m: Movement) => m.unitCost > 0 ? money(m.unitCost) : <span className="muted-text">—</span> }] : []),
    { key: "n", header: "Açıklama", render: (m) => m.note || <span className="muted-text">—</span> },
  ];

  return (
    <>
      <div className="split stack">
        <section className="panel">
          <PanelHead title="Stok Giriş / Çıkış" description="Maliyetli giriş, ağırlıklı ortalama alış maliyetini günceller." />
          <form id="stock-form" className="form-grid cols-2" onSubmit={(e) => void submit(e)}>
            <Field label="Motosiklet" className="span-all"><Select value={motoId} onChange={setMotoId} options={motoOptions} placeholder="Motosiklet seç" required searchable /></Field>
            <Field label="Hareket türü"><Select value={type} onChange={setType} options={typeOptions} /></Field>
            <Field label="Adet" hint={moto ? `Mevcut stok: ${moto.stockQuantity}` : undefined}><input type="number" min="1" step="1" value={qty} onChange={(e) => setQty(e.target.value)} required /></Field>
            {/* Maliyet alanı her zaman aynı yerde durur; hareket türü değişince
                formun yeniden dizilmesini önlemek için yalnızca devre dışı kalır. */}
            {isAdmin && (
              <Field label="Birim alış maliyeti (TL)" hint="Alış girişinde ağırlıklı ortalama maliyeti günceller.">
                <input type="number" min="0.01" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="130000" disabled={type !== "PurchaseIn"} required={type === "PurchaseIn"} />
              </Field>
            )}
            <Field label="Açıklama" className={isAdmin ? "" : "span-all"}><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Örn. Tedarikçi faturası no" /></Field>
          </form>
          <button type="submit" form="stock-form" className="btn btn-primary" style={{ marginTop: 18 }} disabled={saving}>{saving ? "Kaydediliyor…" : "Stok Hareketini Kaydet"}</button>
        </section>
        <section className="panel">
          <PanelHead title="Güncel Stok" description="Modellere göre mevcut adetler" />
          {motorcycles.length === 0 ? <EmptyState icon="box" title="Kayıtlı model yok" /> : (
            <ul className="list-plain">
              {[...motorcycles].sort((a, b) => a.stockQuantity - b.stockQuantity).slice(0, 8).map((m) => (
                <li key={m.id}><div className="grow"><strong>{m.brand} {m.model}</strong><small>{m.color}</small></div>
                  <Badge tone={m.stockQuantity === 0 ? "danger" : m.stockQuantity <= 2 ? "warning" : "success"}>{m.stockQuantity} adet</Badge></li>
              ))}
            </ul>)}
        </section>
      </div>

      <section className="panel">
        <PanelHead title="Stok Hareketleri" description={`${rows.length} kayıt`} />
        <div className="filter-row">
          <Select value={filterMoto} onChange={setFilterMoto} searchable ariaLabel="Motosiklet filtresi" options={[{ value: "", label: "Tüm motosikletler" }, ...motoOptions.map(({ value, label }) => ({ value, label }))]} />
          <Select value={filterType} onChange={setFilterType} ariaLabel="Tür filtresi" options={[{ value: "", label: "Tüm hareket türleri" }, ...Object.entries(movementLabels).map(([value, label]) => ({ value, label }))]} />
        </div>
        {loading ? <div className="skeleton" style={{ height: 120 }} /> : <DataTable columns={columns} rows={rows} rowKey={(m) => m.id} empty={<EmptyState icon="history" title="Stok hareketi yok" />} />}
      </section>
    </>
  );
}

/* ═════════════ GİDERLER ═════════════ */
type Expense = { id: number; category: string; description: string; amount: number; expenseDate: string };
const CATEGORIES = ["Kira", "Maaş", "Elektrik / Su / İnternet", "Reklam", "Bakım / Onarım", "Vergi / Resmî", "Diğer"];

export function ExpensesPage({ role }: { role: Role }) {
  const { toast, confirm } = useUi();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("Kira");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(dateKey(new Date()));
  const [saving, setSaving] = useState(false);
  const [filterCat, setFilterCat] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    const r = await api("/expenses");
    if (r.ok) setExpenses(await r.json());
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await api("/expenses", jsonInit("POST", { category, description: description.trim(), amount: Number(amount), expenseDate: new Date(`${date}T12:00:00`).toISOString() }));
      if (!r.ok) throw new Error(await errorText(r, "Gider kaydedilemedi."));
      toast("success", "Gider kaydedildi.");
      setDescription(""); setAmount("");
      await load();
    } catch (err) { toast("error", err instanceof Error ? err.message : "Gider kaydedilemedi."); }
    finally { setSaving(false); }
  }

  async function remove(x: Expense) {
    if (!(await confirm({ title: "Gider silinsin mi?", message: `“${x.description}” (${money(x.amount)}) kaydı silinecek.`, confirmText: "Sil", danger: true }))) return;
    const r = await api(`/expenses/${x.id}`, { method: "DELETE" });
    if (r.ok) { toast("success", "Gider silindi."); await load(); } else toast("error", await errorText(r, "Gider silinemedi."));
  }

  const monthKey = dateKey(new Date()).slice(0, 7);
  const monthTotal = expenses.filter((x) => dateKey(x.expenseDate).startsWith(monthKey)).reduce((t, x) => t + x.amount, 0);
  const monthExpenses = expenses.filter((x) => dateKey(x.expenseDate).startsWith(monthKey));
  const byCategory = Object.entries(
    monthExpenses.reduce<Record<string, number>>((g, x) => ({ ...g, [x.category]: (g[x.category] ?? 0) + x.amount }), {}),
  ).sort((a, b) => b[1] - a[1]);

  const rows = expenses.filter((x) => (!filterCat || x.category === filterCat) && (!search || trLower(x.description).includes(trLower(search.trim()))));
  const shownTotal = rows.reduce((t, x) => t + x.amount, 0);

  const columns: Column<Expense>[] = [
    { key: "d", header: "Tarih", sort: (x) => new Date(x.expenseDate).getTime(), render: (x) => fmtDate(x.expenseDate) },
    { key: "c", header: "Kategori", sort: (x) => x.category, render: (x) => <Badge>{x.category}</Badge> },
    { key: "n", header: "Açıklama", render: (x) => x.description },
    { key: "a", header: "Tutar", align: "right", sort: (x) => x.amount, render: (x) => <span className="cell-title">{money(x.amount)}</span> },
    { key: "x", header: "", align: "right", render: (x) => role === "Admin" ? <div className="row-actions"><button type="button" className="icon-btn danger" title="Sil" aria-label="Sil" onClick={() => void remove(x)}><Icon name="trash" /></button></div> : null },
  ];

  return (
    <>
      <div className="split stack">
        <section className="panel">
          <PanelHead title="Yeni Gider" description="İşletme giderleri kârlılık raporuna net sonuç olarak yansır." />
          <form id="expense-form" className="form-grid cols-2" onSubmit={(e) => void submit(e)}>
            <Field label="Kategori"><Select value={category} onChange={setCategory} options={CATEGORIES.map((c) => ({ value: c, label: c }))} /></Field>
            <Field label="Tarih"><input type="date" value={date} max={dateKey(new Date())} onChange={(e) => setDate(e.target.value)} required /></Field>
            <Field label="Açıklama"><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Örn. Kasım ayı kirası" required /></Field>
            <Field label="Tutar (TL)"><input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field>
          </form>
          <button type="submit" form="expense-form" className="btn btn-primary" style={{ marginTop: 18 }} disabled={saving}><Icon name="plus" /> {saving ? "Kaydediliyor…" : "Gider Ekle"}</button>
        </section>
        <section className="panel">
          <PanelHead title="Bu Ay" description={`Toplam ${money(monthTotal)}`} />
          {byCategory.length === 0 ? <EmptyState icon="wallet" title="Bu ay gider yok" /> : (
            <ul className="list-plain">{byCategory.map(([c, v]) => (
              <li key={c}><div className="grow"><strong>{c}</strong><small>%{((v / monthTotal) * 100).toFixed(0)}</small></div><strong>{money(v)}</strong></li>))}</ul>)}
        </section>
      </div>
      <section className="panel">
        <PanelHead title="Gider Kayıtları" description={`${rows.length} kayıt · ${money(shownTotal)}`}
          actions={<button type="button" className="btn btn-ghost" disabled={rows.length === 0} onClick={() => downloadCsv("giderler.csv", [["Tarih", "Kategori", "Açıklama", "Tutar"], ...rows.map((x) => [fmtDate(x.expenseDate), x.category, x.description, x.amount])])}><Icon name="download" /> CSV</button>} />
        <div className="filter-row">
          <SearchBox value={search} onChange={setSearch} placeholder="Açıklama ara…" />
          <Select value={filterCat} onChange={setFilterCat} ariaLabel="Kategori filtresi" options={[{ value: "", label: "Tüm kategoriler" }, ...CATEGORIES.map((c) => ({ value: c, label: c }))]} />
        </div>
        {loading ? <div className="skeleton" style={{ height: 120 }} /> : <DataTable columns={columns} rows={rows} rowKey={(x) => x.id} empty={<EmptyState icon="wallet" title="Gider kaydı yok" />} />}
      </section>
    </>
  );
}

/* ═════════════ KÂRLILIK RAPORU ═════════════ */
type ProfitReport = { revenue: number; costOfGoodsSold: number; grossProfit: number; expenses: number; netProfit: number; saleCount: number; unitsSold: number; grossProfitComplete: boolean; note?: string | null };

export function ReportsPage() {
  const { toast } = useUi();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [report, setReport] = useState<ProfitReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const qs = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
      const r = await api(`/reports/profit${qs ? `?${qs}` : ""}`);
      if (cancelled) return;
      if (r.ok) setReport(await r.json()); else toast("error", await errorText(r, "Rapor alınamadı."));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [from, to, toast]);

  function preset(kind: "month" | "last" | "30" | "all") {
    const now = new Date();
    if (kind === "all") { setFrom(""); setTo(""); }
    else if (kind === "month") { setFrom(dateKey(new Date(now.getFullYear(), now.getMonth(), 1))); setTo(dateKey(now)); }
    else if (kind === "last") { setFrom(dateKey(new Date(now.getFullYear(), now.getMonth() - 1, 1))); setTo(dateKey(new Date(now.getFullYear(), now.getMonth(), 0))); }
    else { const d = new Date(); d.setDate(d.getDate() - 29); setFrom(dateKey(d)); setTo(dateKey(now)); }
  }

  const margin = report && report.revenue > 0 ? (report.grossProfit / report.revenue) * 100 : null;

  return (
    <section className="panel">
      <PanelHead title="Kârlılık Raporu" description="Ciro, satılan ürün maliyeti, brüt kâr, giderler ve net sonuç."
        actions={report && <button type="button" className="btn btn-ghost" onClick={() => downloadCsv("karlilik-raporu.csv", [
          ["Dönem", `${from || "başlangıç"} – ${to || "bugün"}`], ["Ciro", report.revenue], ["Satılan ürün maliyeti", report.costOfGoodsSold],
          ["Brüt kâr", report.grossProfit], ["Giderler", report.expenses], ["Net sonuç", report.netProfit], ["Satış sayısı", report.saleCount], ["Satılan adet", report.unitsSold]])}><Icon name="download" /> CSV</button>} />
      <div className="report-filters">
        <Field label="Başlangıç tarihi"><input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Bitiş tarihi"><input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
        <button type="button" className="btn btn-ghost" onClick={() => preset("month")}>Bu ay</button>
        <button type="button" className="btn btn-ghost" onClick={() => preset("last")}>Geçen ay</button>
        <button type="button" className="btn btn-ghost" onClick={() => preset("30")}>Son 30 gün</button>
        <button type="button" className="btn btn-ghost" onClick={() => preset("all")}>Tümü</button>
      </div>
      {loading && !report ? <div className="skeleton" style={{ height: 90 }} /> : report && <>
        <div className="stat-grid">
          <StatCard icon="cart" tone="blue" label="Ciro" value={moneyRound(report.revenue)} hint={`${report.saleCount} satış · ${report.unitsSold} adet`} />
          <StatCard icon="box" tone="amber" label="Satılan ürün maliyeti" value={moneyRound(report.costOfGoodsSold)} />
          <StatCard icon="trend" tone="green" label="Brüt kâr" value={moneyRound(report.grossProfit)} hint={margin === null ? undefined : `Brüt marj %${margin.toFixed(1)}`} />
          <StatCard icon="wallet" tone="red" label="Giderler" value={moneyRound(report.expenses)} />
          <StatCard icon="chart" tone={report.netProfit >= 0 ? "green" : "red"} label="Net sonuç" value={moneyRound(report.netProfit)} hint={report.netProfit >= 0 ? "Kâr" : "Zarar"} />
        </div>
        {!report.grossProfitComplete && <MetricNote>{report.note || "Bazı eski satışların maliyeti bilinmediği için brüt kâr eksik hesaplanmış olabilir."} Yeni stok girişlerinde alış maliyetini doğru gir.</MetricNote>}
      </>}
    </section>
  );
}

/* ═════════════ KULLANICILAR ═════════════ */
type AppUser = { id: number; username: string; role: string; isActive: boolean; dealerId?: number | null };

export function UsersPage({ currentUsername, dealers = [] }: { currentUsername: string; dealers?: { id: number; name: string }[] }) {
  const { toast, confirm } = useUi();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", role: "Staff", dealerId: "" });
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [resetUser, setResetUser] = useState<AppUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    const r = await api("/users");
    if (r.ok) setUsers(await r.json());
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (form.role === "Dealer" && !form.dealerId) return toast("error", "Bayi kullanıcısı için şube seçin.");
    setSaving(true);
    try {
      const r = await api("/users", jsonInit("POST", { username: form.username.trim(), password: form.password, role: form.role, dealerId: form.dealerId ? Number(form.dealerId) : null }));
      if (!r.ok) throw new Error(await errorText(r, "Kullanıcı oluşturulamadı."));
      toast("success", "Kullanıcı oluşturuldu.");
      setOpen(false); setForm({ username: "", password: "", role: "Staff", dealerId: "" });
      await load();
    } catch (err) { toast("error", err instanceof Error ? err.message : "Kullanıcı oluşturulamadı."); }
    finally { setSaving(false); }
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resetUser) return;
    if (newPassword.length < 12) return toast("error", "Yeni parola en az 12 karakter olmalıdır.");
    setResetting(true);
    try {
      const response = await api(`/users/${resetUser.id}/password`, jsonInit("POST", { newPassword }));
      if (!response.ok) throw new Error(await errorText(response, "Parola sıfırlanamadı."));
      toast("success", `${resetUser.username} için geçici parola tanımlandı. Kullanıcıya güvenli kanaldan iletin.`);
      setResetUser(null); setNewPassword("");
    } catch (error) {
      toast("error", error instanceof Error ? error.message : "Parola sıfırlanamadı.");
    } finally { setResetting(false); }
  }

  async function toggle(u: AppUser) {
    if (u.isActive && !(await confirm({ title: "Hesap devre dışı bırakılsın mı?", message: `${u.username} artık sisteme giriş yapamayacak.`, confirmText: "Devre dışı bırak", danger: true }))) return;
    const r = await api(`/users/${u.id}/active`, jsonInit("PATCH", { isActive: !u.isActive }));
    if (r.ok) { toast("success", u.isActive ? "Hesap devre dışı bırakıldı." : "Hesap etkinleştirildi."); await load(); }
    else toast("error", await errorText(r, "İşlem başarısız."));
  }

  const rows = users.filter((u) =>
    (!search || trLower(`${u.username} ${u.role}`).includes(trLower(search.trim()))) &&
    (!statusFilter || (statusFilter === "active" && u.isActive) || (statusFilter === "passive" && !u.isActive)));

  const columns: Column<AppUser>[] = [
    { key: "u", header: "Kullanıcı", sort: (u) => u.username, render: (u) => <span className="cell-title">{u.username}{u.username === currentUsername && <span className="cell-sub">Sen</span>}</span> },
    { key: "r", header: "Rol", render: (u) => <Badge tone={u.role === "Admin" ? "info" : u.role === "Dealer" ? "warning" : "neutral"}>{u.role === "Admin" ? "Yönetici" : u.role === "Dealer" ? "Bayi" : "Personel"}</Badge> },
    { key: "d", header: "Şube", render: (u) => dealers.find((dealer) => dealer.id === u.dealerId)?.name || <span className="muted-text">Merkez</span> },
    { key: "s", header: "Durum", render: (u) => <Badge tone={u.isActive ? "success" : "danger"}>{u.isActive ? "Aktif" : "Pasif"}</Badge> },
    { key: "a", header: "", align: "right", render: (u) => u.username === currentUsername ? <span className="muted-text" style={{ fontSize: 12 }}>Mevcut oturum</span> : (
      <div className="row-actions">
        <button type="button" className="icon-btn" title="Parola sıfırla" aria-label="Parola sıfırla" onClick={() => { setResetUser(u); setNewPassword(""); }}><Icon name="key" /></button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void toggle(u)}>{u.isActive ? "Devre dışı bırak" : "Etkinleştir"}</button>
      </div>) },
  ];

  return (
    <>
    <section className="panel">
      <PanelHead title="Kullanıcı ve Yetki Yönetimi" description="Yönetici tüm modülleri kullanır; Personel günlük satış, stok ve müşteri işlemlerini yapar."
        actions={<button type="button" className="btn btn-primary" onClick={() => setOpen(true)}><Icon name="plus" /> Yeni Kullanıcı</button>} />
      <div className="filter-row">
        <SearchBox value={search} onChange={setSearch} placeholder="Kullanıcı adı ara…" />
        <Select value={statusFilter} onChange={setStatusFilter} ariaLabel="Durum filtresi" options={[
          { value: "", label: "Tüm kullanıcılar" }, { value: "active", label: "Aktif hesaplar" }, { value: "passive", label: "Pasif hesaplar" }]} />
      </div>
      {loading ? <div className="skeleton" style={{ height: 100 }} /> : <DataTable columns={columns} rows={rows} rowKey={(u) => u.id} empty={<EmptyState icon="shield" title={users.length ? "Eşleşen kullanıcı yok" : "Kullanıcı yok"} />} />}
      <p className="muted-text" style={{ marginTop: 12, fontSize: 12 }}>Yeni kullanıcı oluştururken belirlediğiniz geçici parolayı kullanıcıya güvenli bir kanaldan iletin; kullanıcı parolasını “Parola değiştir” ile güncelleyebilir.</p>
    </section>

    <section className="panel">
      <PanelHead title="Rol Yetkileri" description="Roller sunucu tarafında da denetlenir; arayüzde gizlenen bir işlem API'den de yapılamaz." />
      <div className="table-wrapper"><table className="data-table"><thead><tr><th>Yetki</th><th>Yönetici</th><th>Personel</th><th>Bayi kullanıcısı</th></tr></thead><tbody>
        {[
          ["Satış ve müşteri işlemleri", "Tam", "Tam", "Kendi şubesi"],
          ["Stok giriş / çıkış", "Tam", "Sınırlı", "Kendi şubesi"],
          ["Satış iptali ve maliyet değişimi", "Tam", "Yok", "Yok"],
          ["Muhasebe, bilanço ve kârlılık", "Tam", "Yok", "Yok"],
          ["Kullanıcı ve işletme yönetimi", "Tam", "Yok", "Yok"],
        ].map((row) => <tr key={row[0]}><td>{row[0]}</td><td>{row[1]}</td><td>{row[2]}</td><td>{row[3]}</td></tr>)}
      </tbody></table></div>
    </section>

      {resetUser && (
        <Modal title={`${resetUser.username} — Parola Sıfırla`} size="sm" onClose={() => setResetUser(null)}
          footer={<>
            <button type="button" className="btn btn-ghost" onClick={() => setResetUser(null)}>Vazgeç</button>
            <button type="submit" form="reset-password-form" className="btn btn-primary" disabled={resetting}>{resetting ? "Sıfırlanıyor…" : "Parolayı sıfırla"}</button>
          </>}>
          <form id="reset-password-form" className="form-grid" onSubmit={(e) => void resetPassword(e)}>
            <Field label="Geçici parola" hint="En az 12 karakter. Kullanıcıya güvenli kanaldan iletin.">
              <input type="password" value={newPassword} minLength={12} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" required />
            </Field>
          </form>
        </Modal>
      )}

      {open && (
        <Modal title="Yeni Kullanıcı" onClose={() => setOpen(false)}
          footer={<><button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Vazgeç</button>
            <button type="submit" form="user-form" className="btn btn-primary" disabled={saving}>{saving ? "Oluşturuluyor…" : "Oluştur"}</button></>}>
          <form id="user-form" className="form-grid cols-2" onSubmit={(e) => void create(e)}>
            <Field label="Kullanıcı adı"><input value={form.username} minLength={3} onChange={(e) => setForm({ ...form, username: e.target.value })} required autoComplete="off" /></Field>
            <Field label="Rol"><Select value={form.role} onChange={(v) => setForm({ ...form, role: v })} options={[{ value: "Staff", label: "Personel" }, { value: "Dealer", label: "Bayi kullanıcısı" }, { value: "Admin", label: "Yönetici" }]} /></Field>
            {form.role === "Dealer" && <Field label="Bayi" className="span-all"><Select value={form.dealerId} onChange={(v) => setForm({ ...form, dealerId: v })} options={dealers.map((d) => ({ value: String(d.id), label: d.name }))} required /></Field>}
            <Field label="Geçici parola" hint="En az 12 karakter; kullanıcıya güvenli kanaldan iletin." className="span-all"><input type="password" value={form.password} minLength={12} autoComplete="new-password" onChange={(e) => setForm({ ...form, password: e.target.value })} required /></Field>
          </form>
        </Modal>
      )}
    </>
  );
}
