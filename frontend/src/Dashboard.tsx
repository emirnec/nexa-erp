import { useMemo, useState } from "react";
import {
  Badge, BarChart, EmptyState, Icon, PanelHead, Select, StatCard,
} from "./ui";
import {
  LOW_STOCK_LIMIT, compactMoney, dateKey, fmtDateTime, money, moneyRound, saleName,
  type Motorcycle, type Role, type Sale,
} from "./utils";


export default function Dashboard({ motorcycles, sales, role, onNavigate }: {
  motorcycles: Motorcycle[]; sales: Sale[]; role: Role; onNavigate: (page: string) => void;
}) {
  const [range, setRange] = useState("14");

  const active = useMemo(() => sales.filter((s) => !s.isCancelled), [sales]);
  const todayKey = dateKey(new Date());
  const monthKey = todayKey.slice(0, 7);

  const sum = (list: Sale[]) => list.reduce((t, s) => t + s.totalPrice, 0);
  const units = (list: Sale[]) => list.reduce((t, s) => t + s.quantity, 0);
  const today = active.filter((s) => dateKey(s.saleDate) === todayKey);
  const month = active.filter((s) => dateKey(s.saleDate).startsWith(monthKey));

  const totalStock = motorcycles.reduce((t, m) => t + m.stockQuantity, 0);
  const stockValue = motorcycles.reduce((t, m) => t + m.purchaseCost * m.stockQuantity, 0);
  const lowStock = motorcycles.filter((m) => m.stockQuantity <= LOW_STOCK_LIMIT)
    .sort((a, b) => a.stockQuantity - b.stockQuantity);
  const noCost = motorcycles.filter((m) => m.purchaseCost <= 0);

  const days = Number(range);
  const chart = useMemo(() => {
    const byDay = new Map<string, number>();
    active.forEach((s) => { const k = dateKey(s.saleDate); byDay.set(k, (byDay.get(k) ?? 0) + s.totalPrice); });
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (days - 1 - i));
      return { label: d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" }), value: byDay.get(dateKey(d)) ?? 0 };
    });
  }, [active, days]);
  const periodTotal = chart.reduce((t, d) => t + d.value, 0);

  const topModels = useMemo(() => {
    const from = new Date(); from.setDate(from.getDate() - (days - 1)); const fromKey = dateKey(from);
    const groups = new Map<string, { name: string; quantity: number; revenue: number }>();
    active.filter((s) => dateKey(s.saleDate) >= fromKey).forEach((s) => {
      const name = saleName(s, motorcycles);
      const g = groups.get(name) ?? { name, quantity: 0, revenue: 0 };
      g.quantity += s.quantity; g.revenue += s.totalPrice; groups.set(name, g);
    });
    return [...groups.values()].sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue).slice(0, 5);
  }, [active, motorcycles, days]);

  const recent = sales.slice(0, 5);

  return (
    <>
      {role === "Admin" && noCost.length > 0 && (
        <div className="callout callout-warning" style={{ marginBottom: 20 }}>
          <Icon name="alert" />
          <div><strong>{noCost.length} modelin alış maliyeti tanımlı değil.</strong> Bu modeller satılamaz ve kâr hesabını bozar. Motorlar sayfasından maliyetlerini gir.
            {" "}<button type="button" className="link-button" style={{ margin: 0 }} onClick={() => onNavigate("motorcycles")}>Motorlara git →</button></div>
        </div>
      )}

      <section className="stat-grid">
        <StatCard icon="cart" tone="blue" label="Bugünkü ciro" value={moneyRound(sum(today))} hint={`${units(today)} adet satış`} />
        <StatCard icon="trend" tone="green" label="Bu ayın cirosu" value={moneyRound(sum(month))} hint={`${units(month)} adet satış`} />
        <StatCard icon="box" tone="violet" label="Toplam stok" value={totalStock} hint={`${motorcycles.length} model kaydı`} />
        {role === "Admin"
          ? <StatCard icon="wallet" tone="amber" label="Stok değeri" value={moneyRound(stockValue)} hint="Stok × alış maliyeti" />
          : <StatCard icon="bike" tone="amber" label="Model sayısı" value={motorcycles.length} hint="Envanterdeki kayıt" />}
        <StatCard icon="alert" tone={lowStock.length ? "red" : "green"} label="Düşük / biten stok" value={lowStock.length} hint={`${LOW_STOCK_LIMIT} adet ve altı`} />
      </section>

      <div className="split stack">
        <section className="panel">
          <PanelHead title="Satış Cirosu" description={`Son ${days} gün · toplam ${money(periodTotal)}`}
            actions={<div style={{ width: 150 }}><Select value={range} onChange={setRange} ariaLabel="Zaman aralığı"
              options={[{ value: "7", label: "Son 7 gün" }, { value: "14", label: "Son 14 gün" }, { value: "30", label: "Son 30 gün" }]} /></div>} />
          {periodTotal === 0
            ? <EmptyState icon="chart" title="Bu dönemde satış yok" text="Satış yapıldıkça grafik burada oluşur." />
            : <BarChart data={chart} format={(n) => `${compactMoney(n)} ₺`} />}
        </section>

        <section className="panel">
          <PanelHead title="Stok Uyarıları" description="Azalan veya biten modeller" />
          {lowStock.length === 0 ? <EmptyState icon="check" title="Her şey yolunda" text="Düşük stoklu model yok." /> : (
            <ul className="list-plain">
              {lowStock.slice(0, 6).map((m) => (
                <li key={m.id}>
                  <div className="grow"><strong>{m.brand} {m.model}</strong><small>{m.color} · {m.engineCapacityCc} cc</small></div>
                  <Badge tone={m.stockQuantity === 0 ? "danger" : "warning"}>{m.stockQuantity === 0 ? "Stokta yok" : `${m.stockQuantity} adet`}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="split split-even stack">
        <section className="panel">
          <PanelHead title="En Çok Satan Modeller" description={`Son ${days} gün`} />
          {topModels.length === 0 ? <EmptyState icon="bike" title="Henüz veri yok" /> : (
            <ul className="list-plain">
              {topModels.map((m, i) => (
                <li key={m.name}><span className="rank">{i + 1}</span>
                  <div className="grow"><strong>{m.name}</strong><small>{m.quantity} adet</small></div>
                  <strong>{money(m.revenue)}</strong></li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <PanelHead title="Son Satışlar" actions={<button type="button" className="btn btn-ghost btn-sm" onClick={() => onNavigate("sales")}>Tümü</button>} />
          {recent.length === 0 ? <EmptyState icon="cart" title="Henüz satış yok" /> : (
            <ul className="list-plain">
              {recent.map((s) => (
                <li key={s.id}>
                  <div className="grow"><strong>{saleName(s, motorcycles)}</strong><small>{s.customerName} · {fmtDateTime(s.saleDate)}</small></div>
                  {s.isCancelled ? <Badge tone="danger">İptal</Badge> : <strong>{money(s.totalPrice)}</strong>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
