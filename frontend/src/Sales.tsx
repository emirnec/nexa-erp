import { useMemo, useRef, useState } from "react";
import {
  Badge, DataTable, EmptyState, Field, Icon, Modal, PanelHead, SearchBox, Select, useUi,
  type Column, type Option,
} from "./ui";
import {
  api, downloadCsv, errorText, fmtDateTime, jsonInit, money, saleName, trLower,
  saleStatusLabels, type Customer, type Dealer, type Motorcycle, type Role, type Sale,
} from "./utils";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const pad2 = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (value?: string | Date) => {
  const d = value ? new Date(value) : new Date();
  const valid = Number.isNaN(d.getTime()) ? new Date() : d;
  return `${valid.getFullYear()}-${pad2(valid.getMonth() + 1)}-${pad2(valid.getDate())}T${pad2(valid.getHours())}:${pad2(valid.getMinutes())}`;
};

type ExtraDraft = { key: number; kind: string; description: string; quantity: string; unitPrice: string; unitCost: string };

const emptyExtra = (key: number): ExtraDraft => ({ key, kind: "Product", description: "", quantity: "1", unitPrice: "", unitCost: "" });
const extrasTotal = (rows: ExtraDraft[]) => rows.reduce((t, r) => t + (Number(r.quantity) || 0) * (Number(r.unitPrice) || 0), 0);
const extrasProfit = (rows: ExtraDraft[]) => rows.reduce((t, r) => t + ((Number(r.unitPrice) || 0) - (Number(r.unitCost) || 0)) * (Number(r.quantity) || 0), 0);
const extrasPayload = (rows: ExtraDraft[]) => rows
  .filter((r) => r.description.trim())
  .map((r) => ({ kind: r.kind, description: r.description.trim(), quantity: Number(r.quantity) || 1, unitPrice: Number(r.unitPrice) || 0, unitCost: Number(r.unitCost) || 0 }));

function printReceipt(sale: Sale, name: string) {
  const w = window.open("", "_blank", "width=440,height=760");
  if (!w) return;
  let cash = sale.cashAmount ?? 0;
  let card = sale.cardAmount ?? 0;
  if (cash === 0 && card === 0 && (sale.paidAmount ?? 0) > 0) {
    if (sale.paymentMethod === "Card" || sale.paymentMethod === "Bank") card = sale.paidAmount ?? 0;
    else cash = sale.paidAmount ?? 0;
  }
  const remaining = Math.max(0, sale.totalPrice - cash - card);
  const extras = sale.extras ?? [];
  const extrasHtml = extras.length
    ? `<hr>${extras.map((e) => `<div class="r"><span>${esc(e.description)} × ${e.quantity}</span><b>${esc(money(e.quantity * e.unitPrice))}</b></div>`).join("")}`
    : "";
  const paymentHtml = [
    cash > 0 ? `<div class="r"><span>Nakit</span><b>${esc(money(cash))}</b></div>` : "",
    card > 0 ? `<div class="r"><span>Kart${(sale.cardInstallments ?? 0) > 1 ? ` (${sale.cardInstallments} taksit)` : " (tek çekim)"}</span><b>${esc(money(card))}</b></div>` : "",
    remaining > 0.005 ? `<div class="r"><span>Açık bakiye</span><b>${esc(money(remaining))}</b></div>` : "",
  ].join("");
  w.document.write(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Satış Fişi #${sale.id}</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;max-width:360px;margin:24px auto;color:#111}h1{font-size:18px;text-align:center;margin:0}
.c{text-align:center;color:#555;font-size:12px;margin:4px 0 16px}hr{border:0;border-top:1px dashed #999;margin:14px 0}
.r{display:flex;justify-content:space-between;gap:10px;font-size:14px;margin:6px 0}.t{font-size:18px;font-weight:700}.f{text-align:center;font-size:12px;color:#666;margin-top:20px}</style></head><body>
<h1>MOTORCYCLE SALES</h1><div class="c">Satış Fişi</div><hr>
<div class="r"><span>Fiş No</span><b>#${sale.id}</b></div>
<div class="r"><span>Tarih</span><b>${esc(fmtDateTime(sale.saleDate))}</b></div>
<div class="r"><span>Müşteri</span><b>${esc(sale.customerName)}</b></div>
${sale.customerPhone ? `<div class="r"><span>Telefon</span><b>${esc(sale.customerPhone)}</b></div>` : ""}<hr>
<div class="r"><span>Ürün</span><b>${esc(name)}</b></div>
<div class="r"><span>Adet</span><b>${sale.quantity}</b></div>
<div class="r"><span>Birim fiyat</span><b>${esc(money(sale.unitPrice))}</b></div>
${extrasHtml}<hr>
<div class="r t"><span>TOPLAM</span><span>${esc(money(sale.totalPrice))}</span></div>
${paymentHtml}
${sale.isCancelled ? '<p class="c" style="color:#b91c1c"><b>BU SATIŞ İPTAL EDİLMİŞTİR</b></p>' : ""}
<div class="f">Bizi tercih ettiğiniz için teşekkür ederiz.</div>
<script>window.onload=()=>{window.print()}</script></body></html>`);
  w.document.close();
}

type EditDraft = {
  id: number;
  saleDate: string;
  customerName: string;
  customerPhone: string;
  motorcycleId: string;
  dealerId: string;
  quantity: string;
  unitPrice: string;
  cash: string;
  card: string;
  installments: string;
  status: string;
  channel: string;
  extras: ExtraDraft[];
};

export default function Sales({ motorcycles, sales, customers, dealers, role, loading, reload, initialSearch = "" }: {
  motorcycles: Motorcycle[]; sales: Sale[]; customers: Customer[]; dealers: Dealer[]; role: Role; loading: boolean; reload: () => Promise<void>; initialSearch?: string;
}) {
  const { toast, confirm } = useUi();
  const isAdmin = role === "Admin";
  const nextExtraKey = useRef(1);

  const [dealerId, setDealerId] = useState("");
  const [statusMode, setStatusMode] = useState("Delivered");
  const [saleDate, setSaleDate] = useState(toLocalInput());
  const [motoId, setMotoId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [qty, setQty] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [cash, setCash] = useState("");
  const [card, setCard] = useState("");
  const [installments, setInstallments] = useState("1");
  const [extras, setExtras] = useState<ExtraDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [edit, setEdit] = useState<EditDraft | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const [search, setSearch] = useState(initialSearch);
  const [status, setStatus] = useState("");

  const moto = motorcycles.find((m) => String(m.id) === motoId);
  const quantity = Number(qty) || 0;
  const price = Number(unitPrice) || 0;
  const extrasSum = extrasTotal(extras);
  const total = Math.max(0, quantity) * Math.max(0, price) + extrasSum;
  const cashValue = Number(cash) || 0;
  const cardValue = Number(card) || 0;
  const hasPaymentInput = cash.trim() !== "" || card.trim() !== "";
  const paid = Math.min(total, cashValue + cardValue);
  const remaining = Math.max(0, total - (hasPaymentInput ? paid : total));
  const costMissing = !!moto && moto.purchaseCost <= 0;
  const profit = moto && moto.purchaseCost > 0 ? (price - moto.purchaseCost) * quantity + extrasProfit(extras) : null;
  const belowCost = !!moto && moto.purchaseCost > 0 && price > 0 && price < moto.purchaseCost;
  const qtyValid = Number.isInteger(quantity) && quantity > 0 && !!moto && quantity <= moto.stockQuantity;
  const step = !dealerId ? 1 : !motoId || !name.trim() ? 2 : !(price > 0 && qtyValid) ? 3 : 4;

  const motoOptions: Option[] = motorcycles.map((m) => ({
    value: String(m.id), label: `${m.brand} ${m.model} · ${m.color}`,
    meta: m.stockQuantity <= 0 ? "Stokta yok" : `Stok: ${m.stockQuantity}`, disabled: m.stockQuantity <= 0,
  }));
  const customerOptions: Option[] = [
    { value: "", label: "Kayıtlı müşteri seçme (yeni / tek seferlik)" },
    ...customers.map((c) => ({ value: String(c.id), label: c.fullName, meta: c.phone ?? "" })),
  ];

  function pickCustomer(id: string) {
    setCustomerId(id);
    const c = customers.find((x) => String(x.id) === id);
    if (c) { setName(c.fullName); setPhone(c.phone ?? ""); }
  }
  function pickMoto(id: string) {
    setMotoId(id);
    const m = motorcycles.find((x) => String(x.id) === id);
    setUnitPrice(m ? String(m.price) : "");
    setQty("1");
  }
  function addExtra() {
    setExtras((rows) => [...rows, emptyExtra(nextExtraKey.current++)]);
  }
  function updateExtra(key: number, patch: Partial<ExtraDraft>) {
    setExtras((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function removeExtra(key: number) {
    setExtras((rows) => rows.filter((r) => r.key !== key));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!dealerId) return toast("error", "Satış lokasyonu seçin.");
    if (!moto || !qtyValid) return toast("error", "Motosiklet ve geçerli bir adet seç.");
    if (!name.trim()) return toast("error", "Müşteri adı girin.");
    if (!(price > 0)) return toast("error", "Satış fiyatı sıfırdan büyük olmalı.");
    if (cashValue + cardValue > total + 0.005) return toast("error", "Nakit ve kart toplamı satış tutarını aşamaz.");
    if (cardValue > 0 && !(Number(installments) >= 1)) return toast("error", "Taksit sayısı en az 1 olmalı.");
    if (belowCost && !(await confirm({ title: "Maliyetin altında satış", message: `Birim fiyat (${money(price)}) alış maliyetinin (${money(moto.purchaseCost)}) altında. Bu satışta ${money(Math.abs(profit ?? 0))} zarar edeceksin. Devam edilsin mi?`, confirmText: "Yine de sat", danger: true }))) return;
    setSaving(true);
    try {
      const response = await api("/sales", jsonInit("POST", {
        motorcycleId: moto.id, customerName: name.trim(), customerPhone: phone.trim() || null,
        quantity, unitPrice: price, customerId: customerId ? Number(customerId) : null,
        dealerId: dealerId ? Number(dealerId) : null, status: statusMode, channel: "Retail",
        saleDate: saleDate ? new Date(saleDate).toISOString() : null,
        cashAmount: cash.trim() === "" ? null : cashValue,
        cardAmount: card.trim() === "" ? null : cardValue,
        cardInstallments: cardValue > 0 ? Number(installments) || 1 : null,
        extras: extrasPayload(extras),
      }));
      if (!response.ok) throw new Error(await errorText(response, "Satış tamamlanamadı."));
      const created: Sale = await response.json();
      setLastSale({ ...created, motorcycle: created.motorcycle ?? `${moto.brand} ${moto.model}` });
      toast("success", `Satış tamamlandı: ${moto.brand} ${moto.model} — ${money(created.totalPrice)}`);
      setMotoId(""); setCustomerId(""); setName(""); setPhone(""); setQty("1"); setUnitPrice("");
      setCash(""); setCard(""); setInstallments("1"); setExtras([]); setSaleDate(toLocalInput());
      await reload();
    } catch (err) { toast("error", err instanceof Error ? err.message : "Satış yapılamadı."); }
    finally { setSaving(false); }
  }

  function openEdit(s: Sale) {
    setEdit({
      id: s.id,
      saleDate: toLocalInput(s.saleDate),
      customerName: s.customerName,
      customerPhone: s.customerPhone ?? "",
      motorcycleId: String(s.motorcycleId),
      dealerId: s.dealerId ? String(s.dealerId) : "",
      quantity: String(s.quantity),
      unitPrice: String(s.unitPrice),
      cash: (s.cashAmount ?? 0) > 0 ? String(s.cashAmount) : "",
      card: (s.cardAmount ?? 0) > 0 ? String(s.cardAmount) : "",
      installments: String(s.cardInstallments && s.cardInstallments > 0 ? s.cardInstallments : 1),
      status: s.status ?? "Delivered",
      channel: s.channel ?? "Retail",
      extras: (s.extras ?? []).map((x) => ({
        key: nextExtraKey.current++, kind: x.kind || "Product", description: x.description,
        quantity: String(x.quantity), unitPrice: String(x.unitPrice), unitCost: x.unitCost ? String(x.unitCost) : "",
      })),
    });
  }

  const editMoto = edit ? motorcycles.find((m) => String(m.id) === edit.motorcycleId) : undefined;
  const editQuantity = edit ? Number(edit.quantity) || 0 : 0;
  const editPrice = edit ? Number(edit.unitPrice) || 0 : 0;
  const editExtrasSum = edit ? extrasTotal(edit.extras) : 0;
  const editTotal = editQuantity * editPrice + editExtrasSum;
  const editCash = edit ? Number(edit.cash) || 0 : 0;
  const editCard = edit ? Number(edit.card) || 0 : 0;
  const editHasPaymentInput = edit ? edit.cash.trim() !== "" || edit.card.trim() !== "" : false;
  const editRemaining = Math.max(0, editTotal - (editHasPaymentInput ? Math.min(editTotal, editCash + editCard) : editTotal));

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    if (!edit.customerName.trim()) return toast("error", "Müşteri adı girin.");
    if (!(editPrice > 0)) return toast("error", "Satış fiyatı sıfırdan büyük olmalı.");
    if (editCash + editCard > editTotal + 0.005) return toast("error", "Nakit ve kart toplamı satış tutarını aşamaz.");
    if (editCard > 0 && !(Number(edit.installments) >= 1)) return toast("error", "Taksit sayısı en az 1 olmalı.");
    setEditSaving(true);
    try {
      const response = await api(`/sales/${edit.id}`, jsonInit("PUT", {
        motorcycleId: Number(edit.motorcycleId),
        customerName: edit.customerName.trim(),
        customerPhone: edit.customerPhone.trim() || null,
        dealerId: edit.dealerId ? Number(edit.dealerId) : null,
        quantity: editQuantity,
        unitPrice: editPrice,
        status: edit.status,
        channel: edit.channel,
        saleDate: edit.saleDate ? new Date(edit.saleDate).toISOString() : null,
        cashAmount: edit.cash.trim() === "" ? null : editCash,
        cardAmount: edit.card.trim() === "" ? null : editCard,
        cardInstallments: editCard > 0 ? Number(edit.installments) || 1 : null,
        extras: extrasPayload(edit.extras),
      }));
      if (!response.ok) throw new Error(await errorText(response, "Satış güncellenemedi."));
      toast("success", `Satış #${edit.id} güncellendi.`);
      setEdit(null);
      await reload();
    } catch (err) { toast("error", err instanceof Error ? err.message : "Satış güncellenemedi."); }
    finally { setEditSaving(false); }
  }

  async function complete(s: Sale) {
    const response = await api(`/sales/${s.id}/complete`, { method: "POST" });
    if (!response.ok) return toast("error", await errorText(response, "Fatura kesilemedi."));
    toast("success", `#${s.id} faturalandı ve muhasebeye işlendi.`);
    await reload();
  }

  async function cancel(s: Sale) {
    if (!(await confirm({ title: `Satış #${s.id} iptal edilsin mi?`, message: `${s.quantity} adet ürün stoğa geri eklenecek ve satış ciro hesaplarından çıkarılacak. Bu işlem geri alınamaz.`, confirmText: "Satışı iptal et", danger: true }))) return;
    try {
      const response = await api(`/sales/${s.id}/cancel`, { method: "POST" });
      if (!response.ok) throw new Error(await errorText(response, "Satış iptal edilemedi."));
      toast("success", `#${s.id} iptal edildi, ${s.quantity} adet stoğa eklendi.`);
      await reload();
    } catch (err) { toast("error", err instanceof Error ? err.message : "Satış iptal edilemedi."); }
  }

  const rows = useMemo(() => {
    const q = trLower(search.trim());
    return sales.filter((s) =>
      (!q || trLower(`${s.id} ${s.customerName} ${s.customerPhone ?? ""} ${saleName(s, motorcycles)}`).includes(q)) &&
      (!status || (status === "done" && !s.isCancelled) || (status === "cancelled" && s.isCancelled)));
  }, [sales, motorcycles, search, status]);

  const activeRows = rows.filter((s) => !s.isCancelled);
  const totalRevenue = activeRows.reduce((t, s) => t + s.totalPrice, 0);

  const saleProfit = (s: Sale) => {
    if (!s.unitCostAtSale || s.unitCostAtSale <= 0) return null;
    const extraProfit = (s.extras ?? []).reduce((t, e) => t + ((e.unitPrice || 0) - (e.unitCost || 0)) * e.quantity, 0);
    return (s.unitPrice - s.unitCostAtSale) * s.quantity + extraProfit;
  };

  function paymentSummary(s: Sale) {
    const cashPart = s.cashAmount ?? 0;
    const cardPart = s.cardAmount ?? 0;
    const open = Math.max(0, s.totalPrice - cashPart - cardPart);
    const parts: string[] = [];
    if (cashPart > 0) parts.push(`Nakit ${money(cashPart)}`);
    if (cardPart > 0) parts.push(`Kart ${money(cardPart)}${(s.cardInstallments ?? 0) > 1 ? ` · ${s.cardInstallments} taksit` : " · tek çekim"}`);
    if (open > 0.005) parts.push(`Açık ${money(open)}`);
    return parts.length ? <span className="table-subtext" style={{ marginTop: 0 }}>{parts.join(" · ")}</span> : <span className="muted-text">—</span>;
  }

  const columns: Column<Sale>[] = [
    { key: "id", header: "No", sort: (s) => s.id, render: (s) => <span className="cell-title">#{s.id}</span> },
    { key: "date", header: "Tarih", sort: (s) => new Date(s.saleDate).getTime(), render: (s) => fmtDateTime(s.saleDate) },
    { key: "moto", header: "Motosiklet", sort: (s) => saleName(s, motorcycles), render: (s) => saleName(s, motorcycles) },
    { key: "cust", header: "Müşteri", sort: (s) => s.customerName, render: (s) => <>{s.customerName}{s.customerPhone && <span className="cell-sub">{s.customerPhone}</span>}</> },
    { key: "qty", header: "Adet", align: "center", sort: (s) => s.quantity, render: (s) => s.quantity },
    { key: "unit", header: "Birim fiyat", align: "right", sort: (s) => s.unitPrice, render: (s) => money(s.unitPrice) },
    { key: "total", header: "Toplam", align: "right", sort: (s) => s.totalPrice, render: (s) => (
      <>
        <span className="cell-title">{money(s.totalPrice)}</span>
        {(s.extras?.length ?? 0) > 0 && <span className="cell-sub">{s.extras!.length} ek kalem · {money(s.extrasTotal ?? 0)}</span>}
      </>) },
    { key: "pay", header: "Tahsilat", render: (s) => (s.isCancelled ? <span className="muted-text">—</span> : paymentSummary(s)) },
    ...(isAdmin ? [{ key: "profit", header: "Kâr", align: "right" as const, sort: (s: Sale) => saleProfit(s) ?? -Infinity,
      render: (s: Sale) => { const p = saleProfit(s); return p === null ? <span className="muted-text" title="Eski kayıt: maliyet bilinmiyor">—</span> : <span className={p >= 0 ? "positive-text" : "negative-text"}>{money(p)}</span>; } }] : []),
    { key: "status", header: "Durum", render: (s) => s.isCancelled ? <Badge tone="danger">İptal edildi</Badge> : <Badge tone={s.status === "Reserved" ? "warning" : "success"}>{saleStatusLabels[s.status ?? "Delivered"] ?? "Tamamlandı"}</Badge> },
    { key: "actions", header: "", align: "right", render: (s) => (
      <div className="row-actions">
        <button type="button" className="icon-btn" title="Fiş yazdır" aria-label="Fiş yazdır" onClick={() => printReceipt(s, saleName(s, motorcycles))}><Icon name="print" /></button>
        {isAdmin && !s.isCancelled && <button type="button" className="icon-btn" title="Satışı düzenle" aria-label="Satışı düzenle" onClick={() => openEdit(s)}><Icon name="edit" /></button>}
        {!s.isCancelled && s.status === "Reserved" && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void complete(s)}>Faturala</button>}
        {isAdmin && !s.isCancelled && <button type="button" className="icon-btn danger" title="Satışı iptal et" aria-label="Satışı iptal et" onClick={() => void cancel(s)}><Icon name="x" /></button>}
      </div>) },
  ];

  return (
    <>
      <div className="split stack">
        <section className="panel">
          <PanelHead title="Satış Yönlendirmesi" description="1 Lokasyon → 2 Ürün/müşteri → 3 Tahsilat → 4 Onay. Stok seçilen depodan düşer; kasa/cari yevmiyesi otomatik oluşur." />
          <ol className="wizard">
            {["Lokasyon", "Satır", "Tahsilat", "Onay"].map((label, i) => (
              <li key={label} className={step === i + 1 ? "active" : step > i + 1 ? "done" : ""}><span>{i + 1}</span>{label}</li>
            ))}
          </ol>
          <form id="sale-form" onSubmit={(e) => void submit(e)} className="form-grid cols-2">
            <Field label="Satış lokasyonu" className="span-all" hint="Merkez veya bayi deposu.">
              <Select value={dealerId} onChange={setDealerId} options={dealers.filter((d) => d.isActive).map((d) => ({ value: String(d.id), label: d.name, meta: d.isHeadquarters ? "Merkez" : d.city }))} placeholder="Depo / bayi seç" required />
            </Field>
            <Field label="Motosiklet" className="span-all">
              <Select value={motoId} onChange={pickMoto} options={motoOptions} placeholder="Motosiklet seç" required searchable />
            </Field>
            <Field label="Kayıtlı müşteri" className="span-all" hint="İstersen listeden seç; bilgiler otomatik dolar.">
              <Select value={customerId} onChange={pickCustomer} options={customerOptions} placeholder="Kayıtlı müşteri seçme (yeni / tek seferlik)" searchable />
            </Field>
            <Field label="Müşteri adı"><input value={name} onChange={(e) => { setName(e.target.value); setCustomerId(""); }} placeholder="Ad soyad" required /></Field>
            <Field label="Telefon (isteğe bağlı)"><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05xx xxx xx xx" /></Field>
            <Field label="Satış tarihi" hint="Varsayılan şimdi; geçmiş veya gelecek tarih seçilebilir.">
              <input type="datetime-local" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} required />
            </Field>
            <Field label="Satış adedi" hint={moto ? `Mevcut stok: ${moto.stockQuantity}` : undefined}>
              <input type="number" min="1" step="1" max={moto?.stockQuantity} value={qty} onChange={(e) => setQty(e.target.value)} required />
            </Field>
            <Field label="Birim satış fiyatı (TL)"><input type="number" min="0.01" step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="150000" required /></Field>
            <Field label="İşlem türü"><Select value={statusMode} onChange={setStatusMode} options={[{ value: "Delivered", label: "Hemen teslim + fatura" }, { value: "Reserved", label: "Rezervasyon (stok tut, sonra faturala)" }]} /></Field>
            <Field label="Nakit tahsilat (TL)" hint="Boş bırakılırsa tutarın tamamı peşin kabul edilir.">
              <input type="number" min="0" step="0.01" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0" />
            </Field>
            <Field label="Kartla tahsilat (TL)" hint="Tek çekim veya taksitli bölüm.">
              <input type="number" min="0" step="0.01" value={card} onChange={(e) => setCard(e.target.value)} placeholder="0" />
            </Field>
            <Field label="Kart taksit sayısı" hint={cardValue > 0 ? "Kart tutarı bu sayıya bölünür." : "Kart tutarı girilince aktifleşir."}>
              <input type="number" min="1" max="36" step="1" value={installments} onChange={(e) => setInstallments(e.target.value)} disabled={cardValue <= 0} />
            </Field>
            <Field label="Ek ürün ve hizmetler" className="span-all" hint="Aksesuar, yükseltme, montaj, sigorta vb. satışa eklenir ve toplama yansır. Maliyet girilirse kâr doğru hesaplanır.">
              <div className="extra-editor">
                {extras.length > 0 && (
                  <div className="extra-row-head" aria-hidden="true">
                    <span>Açıklama</span><span>Tür</span><span>{isAdmin ? "Adet × Fiyat × Maliyet" : "Adet × Fiyat"}</span><span />
                  </div>
                )}
                {extras.map((row) => (
                  <div className="extra-row" key={row.key}>
                    <input value={row.description} onChange={(e) => updateExtra(row.key, { description: e.target.value })} placeholder="Örn. Çanta, egzoz, montaj" aria-label="Ek ürün açıklaması" />
                    <select value={row.kind} onChange={(e) => updateExtra(row.key, { kind: e.target.value })} aria-label="Ek ürün türü">
                      <option value="Product">Ürün</option>
                      <option value="Service">Hizmet</option>
                    </select>
                    <div className={`inline-fields${isAdmin ? " has-cost" : ""}`}>
                      <input type="number" min="1" step="1" value={row.quantity} onChange={(e) => updateExtra(row.key, { quantity: e.target.value })} aria-label="Ek ürün adedi" />
                      <input type="number" min="0" step="0.01" value={row.unitPrice} onChange={(e) => updateExtra(row.key, { unitPrice: e.target.value })} placeholder="Fiyat" aria-label="Ek ürün birim fiyatı" />
                      {isAdmin && <input type="number" min="0" step="0.01" value={row.unitCost} onChange={(e) => updateExtra(row.key, { unitCost: e.target.value })} placeholder="Maliyet" aria-label="Ek ürün birim maliyeti" />}
                    </div>
                    <button type="button" className="icon-btn danger" title="Satırı kaldır" aria-label="Ek satırı kaldır" onClick={() => removeExtra(row.key)}><Icon name="x" size={15} /></button>
                  </div>
                ))}
                <div className="extra-editor-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={addExtra}><Icon name="plus" size={15} /> Ek satır ekle</button>
                  {extrasSum > 0 && <span className="muted-text">Ek toplam: <strong>{money(extrasSum)}</strong></span>}
                </div>
              </div>
            </Field>
          </form>
        </section>

        <section className="panel">
          <PanelHead title="Satış Özeti" />
          <div className="summary-box">
            <div className="summary-row"><span>Ürün</span><strong>{moto ? `${moto.brand} ${moto.model}` : "—"}</strong></div>
            <div className="summary-row"><span>Adet × Birim fiyat</span><strong>{quantity > 0 ? `${quantity} × ${money(price)}` : "—"}</strong></div>
            {extrasSum > 0 && <div className="summary-row"><span>Ek ürün/hizmet</span><strong>{money(extrasSum)}</strong></div>}
            {isAdmin && <div className="summary-row"><span>Tahmini kâr</span>
              <strong className={profit === null ? "" : profit >= 0 ? "positive-text" : "negative-text"}>{profit === null ? "—" : money(profit)}</strong></div>}
            <div className="summary-row"><span>Nakit / Kart</span><strong>{hasPaymentInput ? `${money(cashValue)} / ${money(cardValue)}${cardValue > 0 ? (Number(installments) || 1) > 1 ? ` · ${Number(installments)} taksit` : " · tek çekim" : ""}` : "Peşin (tamamı)"}</strong></div>
            {remaining > 0.005 && <div className="summary-row"><span>Açık bakiye (veresiye)</span><strong className="negative-text">{money(remaining)}</strong></div>}
            <div className="summary-total"><span>Toplam tutar</span><strong>{money(total)}</strong></div>
          </div>
          {costMissing && (
            <div className="callout callout-danger" style={{ marginTop: 14 }}><Icon name="alert" /><div>
              <strong>Bu modelin alış maliyeti tanımlı değil.</strong> {isAdmin ? "Motorlar sayfasından maliyeti gir; aksi halde satış yapılamaz." : "Yöneticinin maliyeti girmesi gerekiyor; aksi halde satış yapılamaz."}</div></div>
          )}
          {belowCost && <div className="callout callout-warning" style={{ marginTop: 14 }}><Icon name="alert" /><div>Fiyat alış maliyetinin altında; bu satış zararla sonuçlanır.</div></div>}
          <button type="submit" form="sale-form" className="btn btn-primary btn-block" style={{ marginTop: 16 }}
            disabled={saving || !moto || !qtyValid || costMissing}>{saving ? "İşleniyor…" : "Satışı Tamamla"}</button>
          {lastSale && (
            <div className="callout callout-info" style={{ marginTop: 14, alignItems: "center" }}>
              <Icon name="check" />
              <div style={{ flex: 1 }}>Son satış: <strong>#{lastSale.id}</strong> · {money(lastSale.totalPrice)}</div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => printReceipt(lastSale, saleName(lastSale, motorcycles))}><Icon name="print" size={15} /> Fiş</button>
            </div>)}
        </section>
      </div>

      <section className="panel">
        <PanelHead title="Satış Geçmişi" description={`${activeRows.length} aktif satış · toplam ${money(totalRevenue)}`}
          actions={<button type="button" className="btn btn-ghost" disabled={rows.length === 0} onClick={() => downloadCsv("satislar.csv", [
            ["No", "Tarih", "Motosiklet", "Müşteri", "Telefon", "Adet", "Birim fiyat", "Ek toplam", "Toplam", "Nakit", "Kart", "Taksit", "Açık", "Durum"],
            ...rows.map((s) => [s.id, fmtDateTime(s.saleDate), saleName(s, motorcycles), s.customerName, s.customerPhone ?? "", s.quantity, s.unitPrice, s.extrasTotal ?? 0, s.totalPrice, s.cashAmount ?? 0, s.cardAmount ?? 0, s.cardInstallments ?? 0, Math.max(0, s.totalPrice - (s.cashAmount ?? 0) - (s.cardAmount ?? 0)), s.isCancelled ? "İptal" : "Tamamlandı"]),
          ])}><Icon name="download" /> CSV</button>} />
        <div className="filter-row">
          <SearchBox value={search} onChange={setSearch} placeholder="Satış no, müşteri, telefon veya model ara…" />
          <Select value={status} onChange={setStatus} ariaLabel="Durum filtresi" options={[
            { value: "", label: "Tüm durumlar" }, { value: "done", label: "Tamamlananlar" }, { value: "cancelled", label: "İptal edilenler" }]} />
        </div>
        {loading ? <div className="skeleton" style={{ height: 120 }} />
          : <DataTable columns={columns} rows={rows} rowKey={(s) => s.id} rowClass={(s) => (s.isCancelled ? "row-cancelled" : "")}
              empty={<EmptyState icon="cart" title={sales.length ? "Filtreye uyan satış yok" : "Henüz satış kaydı yok"} />} />}
      </section>

      {edit && (
        <Modal title={`Satış #${edit.id} düzenle`} onClose={() => setEdit(null)} size="lg" footer={<>
          <button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>Vazgeç</button>
          <button type="submit" form="sale-edit-form" className="btn btn-primary" disabled={editSaving}>{editSaving ? "Kaydediliyor…" : "Değişiklikleri kaydet"}</button>
        </>}>
          <form id="sale-edit-form" onSubmit={(e) => void saveEdit(e)} className="form-grid cols-2">
            <Field label="Satış tarihi"><input type="datetime-local" value={edit.saleDate} onChange={(e) => setEdit({ ...edit, saleDate: e.target.value })} required /></Field>
            <Field label="Durum" hint="Rezervasyon faturalanana kadar stokta tutulur.">
              <input value={saleStatusLabels[edit.status] ?? edit.status} readOnly />
            </Field>
            <Field label="Müşteri adı"><input value={edit.customerName} onChange={(e) => setEdit({ ...edit, customerName: e.target.value })} required /></Field>
            <Field label="Telefon"><input type="tel" value={edit.customerPhone} onChange={(e) => setEdit({ ...edit, customerPhone: e.target.value })} /></Field>
            <Field label="Motosiklet">
              <Select value={edit.motorcycleId} onChange={(value) => setEdit({ ...edit, motorcycleId: value })} options={motoOptions} placeholder="Motosiklet seç" searchable />
            </Field>
            <Field label="Lokasyon">
              <Select value={edit.dealerId} onChange={(value) => setEdit({ ...edit, dealerId: value })} options={dealers.filter((d) => d.isActive).map((d) => ({ value: String(d.id), label: d.name, meta: d.isHeadquarters ? "Merkez" : d.city }))} placeholder="Depo / bayi seç" />
            </Field>
            <Field label="Adet" hint={editMoto ? `Mevcut stok: ${editMoto.stockQuantity}` : undefined}>
              <input type="number" min="1" step="1" value={edit.quantity} onChange={(e) => setEdit({ ...edit, quantity: e.target.value })} required />
            </Field>
            <Field label="Birim satış fiyatı (TL)"><input type="number" min="0.01" step="0.01" value={edit.unitPrice} onChange={(e) => setEdit({ ...edit, unitPrice: e.target.value })} required /></Field>
            <Field label="Nakit tahsilat (TL)"><input type="number" min="0" step="0.01" value={edit.cash} onChange={(e) => setEdit({ ...edit, cash: e.target.value })} placeholder="0" /></Field>
            <Field label="Kartla tahsilat (TL)"><input type="number" min="0" step="0.01" value={edit.card} onChange={(e) => setEdit({ ...edit, card: e.target.value })} placeholder="0" /></Field>
            <Field label="Kart taksit sayısı"><input type="number" min="1" max="36" step="1" value={edit.installments} onChange={(e) => setEdit({ ...edit, installments: e.target.value })} disabled={editCard <= 0} /></Field>
            <Field label="Kalan (açık bakiye)"><input value={money(editRemaining)} readOnly /></Field>
            <Field label="Ek ürün ve hizmetler" className="span-all">
              <div className="extra-editor">
                {edit.extras.length > 0 && (
                  <div className="extra-row-head" aria-hidden="true">
                    <span>Açıklama</span><span>Tür</span><span>{isAdmin ? "Adet × Fiyat × Maliyet" : "Adet × Fiyat"}</span><span />
                  </div>
                )}
                {edit.extras.map((row) => (
                  <div className="extra-row" key={row.key}>
                    <input value={row.description} onChange={(e) => setEdit({ ...edit, extras: edit.extras.map((x) => x.key === row.key ? { ...x, description: e.target.value } : x) })} placeholder="Örn. Çanta, egzoz, montaj" aria-label="Ek ürün açıklaması" />
                    <select value={row.kind} onChange={(e) => setEdit({ ...edit, extras: edit.extras.map((x) => x.key === row.key ? { ...x, kind: e.target.value } : x) })} aria-label="Ek ürün türü">
                      <option value="Product">Ürün</option>
                      <option value="Service">Hizmet</option>
                    </select>
                    <div className={`inline-fields${isAdmin ? " has-cost" : ""}`}>
                      <input type="number" min="1" step="1" value={row.quantity} onChange={(e) => setEdit({ ...edit, extras: edit.extras.map((x) => x.key === row.key ? { ...x, quantity: e.target.value } : x) })} aria-label="Ek ürün adedi" />
                      <input type="number" min="0" step="0.01" value={row.unitPrice} onChange={(e) => setEdit({ ...edit, extras: edit.extras.map((x) => x.key === row.key ? { ...x, unitPrice: e.target.value } : x) })} placeholder="Fiyat" aria-label="Ek ürün birim fiyatı" />
                      {isAdmin && <input type="number" min="0" step="0.01" value={row.unitCost} onChange={(e) => setEdit({ ...edit, extras: edit.extras.map((x) => x.key === row.key ? { ...x, unitCost: e.target.value } : x) })} placeholder="Maliyet" aria-label="Ek ürün birim maliyeti" />}
                    </div>
                    <button type="button" className="icon-btn danger" title="Satırı kaldır" aria-label="Ek satırı kaldır" onClick={() => setEdit({ ...edit, extras: edit.extras.filter((x) => x.key !== row.key) })}><Icon name="x" size={15} /></button>
                  </div>
                ))}
                <div className="extra-editor-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit({ ...edit, extras: [...edit.extras, emptyExtra(nextExtraKey.current++)] })}><Icon name="plus" size={15} /> Ek satır ekle</button>
                  {editExtrasSum > 0 && <span className="muted-text">Ek toplam: <strong>{money(editExtrasSum)}</strong></span>}
                </div>
              </div>
            </Field>
            <div className="summary-box span-all">
              <div className="summary-row"><span>Motosiklet</span><strong>{editQuantity > 0 ? `${editQuantity} × ${money(editPrice)}` : "—"}</strong></div>
              {editExtrasSum > 0 && <div className="summary-row"><span>Ek ürün/hizmet</span><strong>{money(editExtrasSum)}</strong></div>}
              <div className="summary-row"><span>Nakit / Kart</span><strong>{editHasPaymentInput ? `${money(editCash)} / ${money(editCard)}` : "Peşin (tamamı)"}</strong></div>
              {editRemaining > 0.005 && <div className="summary-row"><span>Açık bakiye</span><strong className="negative-text">{money(editRemaining)}</strong></div>}
              <div className="summary-total"><span>Yeni toplam</span><strong>{money(editTotal)}</strong></div>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
