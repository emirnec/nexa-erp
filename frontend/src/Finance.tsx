import { useCallback, useEffect, useState } from "react";
import { DataTable, EmptyState, Icon, PanelHead, StatCard, useUi, type Column } from "./ui";
import { api, downloadCsv, errorText, money, moneyRound } from "./utils";

type AgingCustomer = {
  customerId: number;
  customerName: string;
  phone?: string | null;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  days90Plus: number;
  total: number;
};

type Aging = {
  asOf: string;
  totalOutstanding: number;
  buckets: { current: number; days1To30: number; days31To60: number; days61To90: number; days90Plus: number };
  customers: AgingCustomer[];
};

export default function ReceivablesPage() {
  const { toast } = useUi();
  const [data, setData] = useState<Aging | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api("/reports/receivables-aging");
      if (!response.ok) throw new Error(await errorText(response, "Cari yaşlandırma alınamadı."));
      setData(await response.json());
    } catch (error) {
      toast("error", error instanceof Error ? error.message : "Cari yaşlandırma alınamadı.");
    } finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { void load(); }, [load]);

  const columns: Column<AgingCustomer>[] = [
    { key: "name", header: "Müşteri", sort: (r) => r.customerName, render: (r) => <>{r.customerName}{r.phone && <span className="cell-sub">{r.phone}</span>}</> },
    { key: "current", header: "Vadesi gelmemiş", align: "right", sort: (r) => r.current, render: (r) => money(r.current) },
    { key: "30", header: "1-30 gün", align: "right", sort: (r) => r.days1To30, render: (r) => r.days1To30 > 0 ? <span className="negative-text">{money(r.days1To30)}</span> : "—" },
    { key: "60", header: "31-60 gün", align: "right", sort: (r) => r.days31To60, render: (r) => r.days31To60 > 0 ? <span className="negative-text">{money(r.days31To60)}</span> : "—" },
    { key: "90", header: "61-90 gün", align: "right", sort: (r) => r.days61To90, render: (r) => r.days61To90 > 0 ? <span className="negative-text">{money(r.days61To90)}</span> : "—" },
    { key: "over", header: "90+ gün", align: "right", sort: (r) => r.days90Plus, render: (r) => r.days90Plus > 0 ? <span className="negative-text">{money(r.days90Plus)}</span> : "—" },
    { key: "total", header: "Toplam", align: "right", sort: (r) => r.total, render: (r) => <strong>{money(r.total)}</strong> },
  ];

  return (
    <>
      <div className="stat-grid">
        <StatCard icon="credit-card" tone="blue" label="Toplam açık bakiye" value={moneyRound(data?.totalOutstanding ?? 0)} />
        <StatCard icon="calendar" tone="violet" label="Vadesi gelmemiş" value={moneyRound(data?.buckets.current ?? 0)} />
        <StatCard icon="alert" tone="amber" label="1-30 gün gecikmiş" value={moneyRound(data?.buckets.days1To30 ?? 0)} />
        <StatCard icon="alert" tone="red" label="90+ gün" value={moneyRound(data?.buckets.days90Plus ?? 0)} />
      </div>
      <section className="panel">
        <PanelHead title="Cari Yaşlandırma" description="Vadeli satış taksitleri ve faturalanmış servis bakiyeleri; ödemeler en eski vadeden başlayarak mahsup edilir."
          actions={<>
            <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={loading}><Icon name="refresh" /> Yenile</button>
            <button type="button" className="btn btn-ghost" disabled={!data?.customers.length}
              onClick={() => data && downloadCsv("cari-yaslandirma.csv", [
                ["Müşteri", "Telefon", "Vadesi gelmemiş", "1-30", "31-60", "61-90", "90+", "Toplam"],
                ...data.customers.map((row) => [row.customerName, row.phone ?? "", row.current, row.days1To30, row.days31To60, row.days61To90, row.days90Plus, row.total]),
              ])}><Icon name="download" /> CSV</button>
          </>} />
        {loading ? <div className="skeleton" style={{ height: 140 }} />
          : <DataTable columns={columns} rows={data?.customers ?? []} rowKey={(r) => r.customerId} pageSize={15}
              empty={<EmptyState icon="credit-card" title="Açık bakiye yok" text="Vadeli satış veya faturalanmış servis bakiyesi bulunmuyor." />} />}
      </section>
    </>
  );
}
