import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, errorText, fmtDate, fmtDateTime, jsonInit } from "./utils";
import { Badge, Field, Icon, PanelHead, Progress, Tabs, useUi } from "./ui";
import { AuditPage, PasswordChangeCard } from "./Security";
import { useNow } from "./useNow";

type TenantInfo = {
  id: number; name: string; slug: string; legalName?: string | null; contactEmail?: string | null; phone?: string | null;
  planKey: string; subscriptionStatus: string; trialEndsAt?: string | null; subscriptionEndsAt?: string | null;
  maxUsers: number; maxBranches: number; isActive: boolean;
};

type TabKey = "profile" | "plan" | "security" | "audit";

const PLANS = [
  {
    key: "Trial", name: "Deneme", price: "Ücretsiz", period: "14 gün",
    features: ["5 kullanıcı", "1 şube", "Satış, stok ve CRM", "Katalog yayını", "Temel raporlar"],
  },
  {
    key: "Starter", name: "Başlangıç", price: "₺1.490", period: "/ ay",
    features: ["10 kullanıcı", "2 şube", "Servis ve iş emirleri", "Kasa ve cari", "Excel dışa aktarma"],
  },
  {
    key: "Professional", name: "Profesyonel", price: "₺3.900", period: "/ ay",
    features: ["25 kullanıcı", "5 şube", "Ön muhasebe ve yevmiye", "Otomasyon ve hatırlatma", "Öncelikli destek"],
  },
  {
    key: "Enterprise", name: "Kurumsal", price: "Teklif", period: "",
    features: ["Sınırsız kullanıcı", "Sınırsız şube", "API ve özel entegrasyon", "Veri göçü desteği", "Özel eğitim"],
  },
];

export default function TenantSettingsPage() {
  const { toast } = useUi();
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [form, setForm] = useState({ name: "", legalName: "", contactEmail: "", phone: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<TabKey>("profile");
  const [users, setUsers] = useState<{ id: number; username: string; role: string; isActive: boolean }[]>([]);
  const [branches, setBranches] = useState<{ id: number; name: string; isHeadquarters?: boolean }[]>([]);
  const [planRequest, setPlanRequest] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tenantResponse, usersResponse, dealersResponse] = await Promise.all([
        api("/tenant/current"), api("/users"), api("/dealers"),
      ]);
      if (!tenantResponse.ok) throw new Error(await errorText(tenantResponse, "İşletme bilgileri alınamadı."));
      const data: TenantInfo = await tenantResponse.json();
      setTenant(data);
      setForm({ name: data.name || "", legalName: data.legalName || "", contactEmail: data.contactEmail || "", phone: data.phone || "" });
      if (usersResponse.ok) setUsers(await usersResponse.json());
      if (dealersResponse.ok) setBranches(await dealersResponse.json());
    } catch (error) {
      toast("error", error instanceof Error ? error.message : "İşletme bilgileri alınamadı.");
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return toast("error", "İşletme adı zorunludur.");
    if (form.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail.trim()))
      return toast("error", "Geçerli bir iletişim e-postası girin.");
    setSaving(true);
    try {
      const response = await api("/tenant/current", jsonInit("PUT", form));
      if (!response.ok) throw new Error(await errorText(response, "İşletme bilgileri kaydedilemedi."));
      toast("success", "İşletme bilgileri güncellendi.");
      await load();
    } catch (error) {
      toast("error", error instanceof Error ? error.message : "İşletme bilgileri kaydedilemedi.");
    } finally { setSaving(false); }
  }

  async function requestPlan(key: string) {
    const plan = PLANS.find((item) => item.key === key);
    if (!plan) return;
    setPlanRequest(key);
    try {
      const response = await api("/tenant/plan-request", jsonInit("POST", { planKey: plan.key }));
      if (!response.ok) throw new Error(await errorText(response, "Plan talebi oluşturulamadı."));
      toast("success", `${plan.name} plan talebi kaydedildi. Satış ekibi sizinle iletişime geçecek.`);
    } catch (error) {
      toast("error", error instanceof Error ? error.message : "Plan talebi oluşturulamadı.");
    } finally { setPlanRequest(null); }
  }

  async function copyCatalog() {
    if (!tenant) return;
    const url = `${window.location.origin}/catalog?tenant=${encodeURIComponent(tenant.slug)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("success", "Katalog bağlantısı kopyalandı.");
    } catch {
      toast("info", url);
    }
  }

  const date = (value?: string | null) => value ? fmtDate(value) : "—";
  const now = useNow();
  const trialDays = useMemo(() => {
    if (!tenant?.trialEndsAt || now <= 0) return null;
    const diff = new Date(tenant.trialEndsAt).getTime() - now;
    return Math.ceil(diff / 86_400_000);
  }, [tenant, now]);

  const activeUsers = users.filter((user) => user.isActive).length;
  // Paket limiti merkez dışındaki şubeleri sayar (API'deki kontrolle aynı).
  const branchCount = branches.filter((branch) => !branch.isHeadquarters).length;

  const tabs: { value: TabKey; label: string }[] = [
    { value: "profile", label: "İşletme Profili" },
    { value: "plan", label: "Paket ve Kullanım" },
    { value: "security", label: "Güvenlik" },
    { value: "audit", label: "İşlem Geçmişi" },
  ];

  return (
    <div className="page-stack">
      <section className="panel">
        <PanelHead title="İşletme ve Abonelik" description="İşletme bilgileri, paket kullanımı, güvenlik ve denetim kayıtları tek yerde."
          actions={<Badge tone={tenant?.isActive ? "success" : "danger"}>{tenant?.isActive ? "Aktif işletme" : "Pasif işletme"}</Badge>} />
        <Tabs tabs={tabs} value={tab} onChange={setTab} ariaLabel="İşletme ayarları sekmeleri" />

        {tab === "profile" && (
          loading
            ? <div className="skeleton-list"><div className="skeleton" style={{ height: 180 }} /></div>
            : <form className="form-grid cols-2" onSubmit={(e) => void save(e)}>
                <Field label="İşletme adı"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={180} /></Field>
                <Field label="İşletme kısa adı (URL)" hint="Katalog ve giriş adresinde kullanılır. Değiştirmek için destek ekibine başvurun.">
                  <input value={tenant?.slug || ""} readOnly />
                </Field>
                <Field label="Ticari unvan"><input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} placeholder="Örn. Örnek Motorlu Araçlar Ltd. Şti." /></Field>
                <Field label="Telefon" hint="İşletme iletişim numarası."><input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0 (5xx) xxx xx xx" /></Field>
                <Field label="İletişim e-postası" className="span-all"><input type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} placeholder="bilgi@isletme.com" /></Field>
                <div className="span-all form-actions">
                  <button className="btn btn-primary" disabled={saving}><Icon name="check" /> {saving ? "Kaydediliyor…" : "Bilgileri Kaydet"}</button>
                  <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={loading}><Icon name="refresh" /> Geri al</button>
                </div>
              </form>
        )}

        {tab === "plan" && tenant && (
          <div className="page-stack">
            <div className="split split-even">
              <div>
                <h3 style={{ marginBottom: 8 }}>Mevcut paket</h3>
                <p className="panel-description" style={{ marginBottom: 14 }}>
                  <strong>{tenant.planKey}</strong> · {tenant.subscriptionStatus === "Trial" ? "Deneme dönemi" : tenant.subscriptionStatus}
                  {trialDays !== null && tenant.subscriptionStatus === "Trial" && <> · {trialDays > 0 ? `${trialDays} gün kaldı` : "süre doldu"}</>}
                </p>
                <div className="usage-row">
                  <div className="usage-label"><span>Kullanıcılar</span><strong>{activeUsers} / {tenant.maxUsers}</strong></div>
                  <Progress value={activeUsers} max={tenant.maxUsers} tone={activeUsers >= tenant.maxUsers ? "red" : "blue"} />
                </div>
                <div className="usage-row">
                  <div className="usage-label"><span>Şube / lokasyon</span><strong>{branchCount} / {tenant.maxBranches}</strong></div>
                  <Progress value={branchCount} max={tenant.maxBranches} tone={branchCount >= tenant.maxBranches ? "red" : "blue"} />
                </div>
                <div className="mini-stats">
                  <div className="mini-stat"><span>Deneme bitişi</span><strong>{date(tenant.trialEndsAt)}</strong></div>
                  <div className="mini-stat"><span>Abonelik bitişi</span><strong>{date(tenant.subscriptionEndsAt)}</strong></div>
                </div>
                <div className="callout callout-info" style={{ marginTop: 12 }}>
                  <Icon name="info" />
                  <div>Online ödeme sağlayıcısı bu sürümde bağlı değil. Plan talebi kaydı açılır; satış ekibi ödeme ve sözleşme adımlarını tamamlar.</div>
                </div>
              </div>
              <div>
                <h3 style={{ marginBottom: 8 }}>Katalog bağlantısı</h3>
                <p className="panel-description">Müşterileriniz giriş yapmadan yayınlanan ürünleri görebilir.</p>
                <div className="summary-box" style={{ marginTop: 10 }}>
                  <div className="summary-row" style={{ wordBreak: "break-all" }}>
                    <span>{window.location.origin}/catalog?tenant={tenant.slug}</span>
                  </div>
                  <div className="form-actions" style={{ marginTop: 10 }}>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => void copyCatalog()}><Icon name="copy" /> Bağlantıyı kopyala</button>
                    <a className="btn btn-ghost btn-sm" href={`/catalog?tenant=${encodeURIComponent(tenant.slug)}`} target="_blank" rel="noreferrer"><Icon name="external" /> Aç</a>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 style={{ marginBottom: 10 }}>Paketler</h3>
              <div className="plan-grid">
                {PLANS.map((plan) => {
                  const current = plan.key === tenant.planKey;
                  return (
                    <article key={plan.key} className={`plan-card ${current ? "current" : ""}`}>
                      {current && <span className="plan-badge badge badge-info">Mevcut</span>}
                      <h3>{plan.name}</h3>
                      <div className="plan-price">{plan.price}<small>{plan.period}</small></div>
                      <ul>{plan.features.map((feature) => <li key={feature}><Icon name="check" size={14} /> {feature}</li>)}</ul>
                      <button type="button" className={`btn ${current ? "btn-ghost" : "btn-primary"} btn-block`}
                        disabled={current || planRequest !== null}
                        onClick={() => void requestPlan(plan.key)}>
                        {current ? "Kullanımda" : planRequest === plan.key ? "Talep gönderiliyor…" : plan.key === "Enterprise" ? "Teklif iste" : "Bu planı talep et"}
                      </button>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {tab === "security" && (
          <div className="security-list">
            <div className="security-item">
              <div className="si-icon"><Icon name="lock" /></div>
              <div className="si-body">
                <strong>Şifre değiştirme</strong>
                <small>Parolanızı düzenli olarak değiştirin. Değişiklikten sonra yeniden giriş yapmanız önerilir.</small>
                <div style={{ marginTop: 14 }}><PasswordChangeCard /></div>
              </div>
            </div>
            <div className="security-item">
              <div className="si-icon"><Icon name="clock" /></div>
              <div className="si-body">
                <strong>Oturum süresi</strong>
                <small>Oturum belirteci 8 saat geçerlidir. Süre dolduğunda sistem sizi giriş ekranına yönlendirir.</small>
              </div>
            </div>
            <div className="security-item">
              <div className="si-icon"><Icon name="shield" /></div>
              <div className="si-body">
                <strong>İki aşamalı doğrulama</strong>
                <small>Bu sürümde TOTP tabanlı iki aşamalı doğrulama henüz etkin değil. Etkinleştirme altyapısı sonraki sürümde sunulacak; kapalı olduğu açıkça belirtilir, sahte bir açma düğmesi gösterilmez.</small>
              </div>
            </div>
            <div className="security-item">
              <div className="si-icon"><Icon name="history" /></div>
              <div className="si-body">
                <strong>İşlem geçmişi</strong>
                <small>Parola, kullanıcı, satış ve stok işlemleri kayıt altına alınır. “İşlem Geçmişi” sekmesinden inceleyebilirsiniz.</small>
                <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => setTab("audit")}><Icon name="arrow-right" /> Kayıtları aç</button>
              </div>
            </div>
          </div>
        )}

        {tab === "audit" && <AuditPage />}
      </section>

      {tenant && (
        <section className="panel">
          <PanelHead title="İşletme Özeti" description="Hesabın genel durumu." />
          <div className="stats-grid">
            <article className="stat-card"><div className="stat-body"><span>İşletme</span><strong>{tenant.name}</strong><small>{tenant.slug}</small></div></article>
            <article className="stat-card"><div className="stat-body"><span>Paket</span><strong>{tenant.planKey}</strong><small>{tenant.subscriptionStatus}</small></div></article>
            <article className="stat-card"><div className="stat-body"><span>Kullanıcı</span><strong>{activeUsers} / {tenant.maxUsers}</strong><small>Aktif hesap</small></div></article>
            <article className="stat-card"><div className="stat-body"><span>Şube</span><strong>{branchCount} / {tenant.maxBranches}</strong><small>Lokasyon</small></div></article>
          </div>
          <p className="muted-text" style={{ fontSize: 12 }}>Son yükleme: {fmtDateTime(new Date())}</p>
        </section>
      )}
    </div>
  );
}
