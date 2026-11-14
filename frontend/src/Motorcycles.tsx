import { useMemo, useState } from "react";
import {
  Badge, DataTable, EmptyState, Field, Icon, Modal, PanelHead, SearchBox, Select, useUi,
  type Column,
} from "./ui";
import {
  LOW_STOCK_LIMIT, api, downloadCsv, errorText, jsonInit, money, trLower,
  type Motorcycle, type Role,
} from "./utils";

type FormState = { brand: string; model: string; engineCapacityCc: string; price: string; purchaseCost: string; color: string; imageUrl: string; stockQuantity: string };
const emptyForm: FormState = { brand: "", model: "", engineCapacityCc: "249", price: "", purchaseCost: "", color: "", imageUrl: "", stockQuantity: "1" };

export default function Motorcycles({ motorcycles, loading, role, reload, initialSearch = "" }: {
  motorcycles: Motorcycle[]; loading: boolean; role: Role; reload: () => Promise<void>; initialSearch?: string;
}) {
  const { toast, confirm } = useUi();
  const isAdmin = role === "Admin";
  const [search, setSearch] = useState(initialSearch);
  const [brand, setBrand] = useState("");
  const [stock, setStock] = useState("");
  const [editing, setEditing] = useState<Motorcycle | "new" | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const brandOptions = useMemo(() => [
    { value: "", label: "Tüm markalar" },
    ...Array.from(new Set(motorcycles.map((m) => m.brand))).sort((a, b) => a.localeCompare(b, "tr")).map((b) => ({ value: b, label: b })),
  ], [motorcycles]);

  const rows = useMemo(() => {
    const q = trLower(search.trim());
    return motorcycles.filter((m) =>
      (!q || trLower(`${m.brand} ${m.model} ${m.color}`).includes(q)) &&
      (!brand || m.brand === brand) &&
      (!stock || (stock === "in" && m.stockQuantity > LOW_STOCK_LIMIT) || (stock === "low" && m.stockQuantity > 0 && m.stockQuantity <= LOW_STOCK_LIMIT) || (stock === "out" && m.stockQuantity === 0)));
  }, [motorcycles, search, brand, stock]);

  function openNew() { setForm(emptyForm); setEditing("new"); }
  function openEdit(m: Motorcycle) {
    setForm({ brand: m.brand, model: m.model, engineCapacityCc: String(m.engineCapacityCc), price: String(m.price), purchaseCost: String(m.purchaseCost), color: m.color, imageUrl: m.imageUrl ?? "", stockQuantity: String(m.stockQuantity) });
    setEditing(m);
  }
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const price = Number(form.price), cost = Number(form.purchaseCost), stockQty = Number(form.stockQuantity), cc = Number(form.engineCapacityCc);
    if (!(price > 0)) return toast("error", "Satış fiyatı sıfırdan büyük olmalı.");
    if (!(cost >= 0)) return toast("error", "Alış maliyeti negatif olamaz.");
    if (!Number.isInteger(stockQty) || stockQty < 0) return toast("error", "Stok adedi sıfır veya daha büyük bir tam sayı olmalı.");
    if (cost > price && !(await confirm({ title: "Maliyet satış fiyatından yüksek", message: "Alış maliyeti satış fiyatından büyük görünüyor; bu modelde zarar edersin. Yine de kaydedilsin mi?", confirmText: "Yine de kaydet" }))) return;
    const imageUrl = form.imageUrl.trim();
    if (imageUrl && (!/^https?:\/\//i.test(imageUrl) || imageUrl.length > 2048)) return toast("error", "Görsel bağlantısı http:// veya https:// ile başlamalı ve 2048 karakteri geçmemeli.");
    const payload = { brand: form.brand.trim(), model: form.model.trim(), engineCapacityCc: cc, price, purchaseCost: cost, color: form.color.trim(), imageUrl: imageUrl || null, stockQuantity: stockQty };
    setSaving(true);
    try {
      const isNew = editing === "new";
      const response = await api(isNew ? "/motorcycles" : `/motorcycles/${(editing as Motorcycle).id}`, jsonInit(isNew ? "POST" : "PUT", payload));
      if (!response.ok) throw new Error(await errorText(response, "Kayıt yapılamadı."));
      toast("success", isNew ? "Motosiklet eklendi." : "Motosiklet güncellendi.");
      setEditing(null);
      await reload();
    } catch (err) { toast("error", err instanceof Error ? err.message : "Kayıt yapılamadı."); }
    finally { setSaving(false); }
  }

  async function remove(m: Motorcycle) {
    if (!(await confirm({ title: "Motosikleti sil", message: `${m.brand} ${m.model} kaydı kalıcı olarak silinecek. İşlem geçmişi olan modeller silinemez.`, confirmText: "Sil", danger: true }))) return;
    try {
      const response = await api(`/motorcycles/${m.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await errorText(response, "Motosiklet silinemedi."));
      toast("success", "Motosiklet silindi.");
      await reload();
    } catch (err) { toast("error", err instanceof Error ? err.message : "Motosiklet silinemedi."); }
  }

  function exportCsv() {
    downloadCsv("motorlar.csv", [
      ["Marka", "Model", "Motor (cc)", "Renk", "Stok", "Satış fiyatı", ...(isAdmin ? ["Alış maliyeti"] : [])],
      ...rows.map((m) => [m.brand, m.model, m.engineCapacityCc, m.color, m.stockQuantity, m.price, ...(isAdmin ? [m.purchaseCost] : [])]),
    ]);
  }

  const columns: Column<Motorcycle>[] = [
    { key: "photo", header: "Fotoğraf", render: (m) => m.imageUrl ? <img src={m.imageUrl} alt={`${m.brand} ${m.model}`} loading="lazy" referrerPolicy="no-referrer" style={{ width: 68, height: 48, objectFit: "cover", borderRadius: 9, background: "#f1f3f5" }} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} /> : <span className="muted-text">Görsel yok</span> },
    { key: "brand", header: "Marka", sort: (m) => m.brand, render: (m) => <span className="cell-title">{m.brand}</span> },
    { key: "model", header: "Model", sort: (m) => m.model, render: (m) => m.model },
    { key: "cc", header: "Motor", sort: (m) => m.engineCapacityCc, render: (m) => `${m.engineCapacityCc} cc` },
    { key: "color", header: "Renk", sort: (m) => m.color, render: (m) => m.color },
    { key: "stock", header: "Stok", sort: (m) => m.stockQuantity, render: (m) =>
      m.stockQuantity === 0 ? <Badge tone="danger">Stokta yok</Badge>
        : m.stockQuantity <= LOW_STOCK_LIMIT ? <Badge tone="warning">{m.stockQuantity} adet</Badge>
        : <Badge tone="success">{m.stockQuantity} adet</Badge> },
    { key: "price", header: "Satış fiyatı", align: "right", sort: (m) => m.price, render: (m) => money(m.price) },
    ...(isAdmin ? [
      { key: "cost", header: "Alış maliyeti", align: "right" as const, sort: (m: Motorcycle) => m.purchaseCost,
        render: (m: Motorcycle) => m.purchaseCost > 0 ? money(m.purchaseCost) : <Badge tone="warning">Tanımsız</Badge> },
      { key: "margin", header: "Marj", align: "right" as const, sort: (m: Motorcycle) => (m.purchaseCost > 0 ? (m.price - m.purchaseCost) / m.price : -1),
        render: (m: Motorcycle) => {
          if (m.purchaseCost <= 0) return <span className="muted-text">—</span>;
          const p = ((m.price - m.purchaseCost) / m.price) * 100;
          return <span className={p >= 0 ? "positive-text" : "negative-text"}>%{p.toFixed(1)}</span>;
        } },
      { key: "actions", header: "", align: "right" as const, render: (m: Motorcycle) => (
        <div className="row-actions">
          <button type="button" className="icon-btn" title="Düzenle" aria-label="Düzenle" onClick={() => openEdit(m)}><Icon name="edit" /></button>
          <button type="button" className="icon-btn danger" title="Sil" aria-label="Sil" onClick={() => void remove(m)}><Icon name="trash" /></button>
        </div>) },
    ] : []),
  ];

  return (
    <section className="panel">
      <PanelHead title="Motosiklet Envanteri" description={`${rows.length} / ${motorcycles.length} kayıt gösteriliyor`}
        actions={<>
          <button type="button" className="btn btn-ghost" onClick={exportCsv} disabled={rows.length === 0}><Icon name="download" /> CSV</button>
          {isAdmin && <button type="button" className="btn btn-primary" onClick={openNew}><Icon name="plus" /> Yeni Motosiklet</button>}
        </>} />
      <div className="filter-row">
        <SearchBox value={search} onChange={setSearch} placeholder="Marka, model veya renk ara…" />
        <Select value={brand} onChange={setBrand} options={brandOptions} ariaLabel="Marka filtresi" />
        <Select value={stock} onChange={setStock} ariaLabel="Stok filtresi" options={[
          { value: "", label: "Tüm stok durumları" }, { value: "in", label: "Stokta (yeterli)" },
          { value: "low", label: "Azalan stok" }, { value: "out", label: "Stokta olmayanlar" }]} />
      </div>

      {loading ? <div style={{ display: "grid", gap: 14 }}>{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 38 }} />)}</div>
        : <DataTable columns={columns} rows={rows} rowKey={(m) => m.id}
            empty={<EmptyState icon="bike" title={motorcycles.length ? "Filtreye uyan kayıt yok" : "Henüz motosiklet kaydı yok"}
              text={motorcycles.length ? "Arama veya filtreleri değiştirmeyi dene." : isAdmin ? "“Yeni Motosiklet” ile ilk kaydı ekle." : undefined} />} />}

      {editing && (
        <Modal title={editing === "new" ? "Yeni Motosiklet" : "Motosikleti Düzenle"} onClose={() => setEditing(null)}
          footer={<>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Vazgeç</button>
            <button type="submit" form="moto-form" className="btn btn-primary" disabled={saving}>{saving ? "Kaydediliyor…" : "Kaydet"}</button>
          </>}>
          <form id="moto-form" className="form-grid cols-2" onSubmit={(e) => void save(e)}>
            <Field label="Marka"><input value={form.brand} onChange={set("brand")} placeholder="Örn. CFMOTO" required /></Field>
            <Field label="Model"><input value={form.model} onChange={set("model")} placeholder="Örn. 250 NK" required /></Field>
            <Field label="Motor hacmi (cc)"><input type="number" min="1" value={form.engineCapacityCc} onChange={set("engineCapacityCc")} required /></Field>
            <Field label="Renk"><input value={form.color} onChange={set("color")} placeholder="Örn. Siyah" required /></Field>
            <div className="span-all">
              <Field label="Ürün fotoğrafı URL'si" hint="Doğrudan görsel bağlantısını yapıştır. Bağlantı kaydedilmeden önce önizlemesi gösterilir.">
                <input type="url" value={form.imageUrl} onChange={set("imageUrl")} placeholder="https://ornek.com/motosiklet.jpg" />
              </Field>
              {form.imageUrl.trim() && <div style={{ marginTop: 10, padding: 10, border: "1px solid #ddd", borderRadius: 12 }}>
                <div className="muted-text" style={{ fontSize: 12, marginBottom: 8 }}>Görsel önizleme</div>
                <img src={form.imageUrl.trim()} alt="Motosiklet önizlemesi" referrerPolicy="no-referrer" style={{ display: "block", maxWidth: "100%", width: 260, height: 150, objectFit: "contain", borderRadius: 8 }} onError={(e) => { e.currentTarget.style.display = "none"; }} onLoad={(e) => { e.currentTarget.style.display = "block"; }} />
              </div>}
            </div>
            <Field label="Satış fiyatı (TL)"><input type="number" min="0.01" step="0.01" value={form.price} onChange={set("price")} placeholder="165000" required /></Field>
            <Field label="Birim alış maliyeti (TL)" hint="Satış yapabilmek için sıfırdan büyük olmalı."><input type="number" min="0" step="0.01" value={form.purchaseCost} onChange={set("purchaseCost")} placeholder="130000" required /></Field>
            <Field label="Stok adedi"><input type="number" min="0" step="1" value={form.stockQuantity} onChange={set("stockQuantity")} required /></Field>
            {Number(form.price) > 0 && Number(form.purchaseCost) > 0 && (
              <Field label="Tahmini birim kâr">
                <input readOnly disabled value={`${money(Number(form.price) - Number(form.purchaseCost))}  (%${(((Number(form.price) - Number(form.purchaseCost)) / Number(form.price)) * 100).toFixed(1)})`} />
              </Field>)}
          </form>
        </Modal>
      )}
    </section>
  );
}
