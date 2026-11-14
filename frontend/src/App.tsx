import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import "./App.css";
import { Badge, Field, Icon, Kbd, Modal, Progress, UiProvider, useUi } from "./ui";
import {
  API_BASE, LOW_STOCK_LIMIT, api, errorText, jsonInit, money, saleName, trLower,
  type Customer, type Dealer, type Motorcycle, type Role, type Sale,
} from "./utils";
import Dashboard from "./Dashboard";
import Motorcycles from "./Motorcycles";
import Sales from "./Sales";
import { CustomersPage, ExpensesPage, ReportsPage, StockPage, UsersPage } from "./BusinessModules";
import { BalancePage, DealersPage, LedgerPage, PaymentsPage, TransfersPage } from "./ErpModules";
import { CatalogManagement, OperationalModules, type ModuleKey } from "./OperationalModules";
import TenantSettingsPage from "./TenantSettings";
import { AuditPage, PasswordChangeCard } from "./Security";
import PublicCatalog from "./PublicCatalog";
import { useNow } from "./useNow";

/** Tek bir sayfadaki beklenmeyen veri hatasının tüm uygulamayı boşaltmasını önler. */
class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return (
      <section className="panel" role="alert">
        <h2>Bu sayfa yüklenemedi</h2>
        <p>Beklenmeyen bir veri nedeniyle ekran açılamadı. Diğer sayfalar çalışmaya devam eder.</p>
        <button type="button" className="btn btn-primary" onClick={() => this.setState({ failed: false })}>Tekrar dene</button>
      </section>
    );
    return this.props.children;
  }
}

/* ═════════════ Navigasyon ═════════════ */

type NavItem = {
  id: string; label: string; icon: string; title: string; subtitle: string;
  roles: Role[]; group: string;
};

const ALL: Role[] = ["Admin", "Staff", "Dealer"];

const NAV: NavItem[] = [
  { id: "dashboard", label: "Genel Bakış", icon: "dashboard", title: "Genel Bakış", subtitle: "Satış, stok ve uyarıların özeti.", roles: ALL, group: "ÇALIŞMA ALANI" },
  { id: "motorcycles", label: "Ürün Envanteri", icon: "bike", title: "Ürün Envanteri", subtitle: "Modelleri, fiyatları ve stok durumunu yönet.", roles: ALL, group: "ÇALIŞMA ALANI" },
  { id: "sales", label: "Satışlar", icon: "cart", title: "Satış İşlemi", subtitle: "Lokasyon → ürün → müşteri → tahsilat.", roles: ALL, group: "ÇALIŞMA ALANI" },
  { id: "customers", label: "Müşteriler", icon: "users", title: "Müşteriler", subtitle: "Müşteri kartları ve satış geçmişleri.", roles: ALL, group: "ÇALIŞMA ALANI" },
  { id: "stock", label: "Stok Yönetimi", icon: "box", title: "Stok Yönetimi", subtitle: "Giriş, çıkış ve stok hareket defteri.", roles: ["Admin", "Staff"], group: "ÇALIŞMA ALANI" },
  { id: "calendar", label: "Takvim / Görevler", icon: "calendar", title: "Takvim ve Görevler", subtitle: "Randevu, teslimat ve hatırlatmalar.", roles: ALL, group: "ÇALIŞMA ALANI" },

  { id: "crm", label: "Müşteri CRM", icon: "users", title: "Müşteri İlişkileri", subtitle: "Talepler, teklifler ve takip kayıtları.", roles: ALL, group: "SATIŞ & CRM" },
  { id: "catalog", label: "Ürün Kataloğu", icon: "book", title: "Ürün Kataloğu", subtitle: "Müşterilere açık ürünleri ve görselleri yayınla.", roles: ["Admin"], group: "SATIŞ & CRM" },
  { id: "tradein", label: "Takas / İkinci El", icon: "repeat", title: "Takas ve İkinci El", subtitle: "Değerleme ve takas kayıtları.", roles: ["Admin"], group: "SATIŞ & CRM" },

  { id: "dealers", label: "Bayiler / Şubeler", icon: "building", title: "Bayi ve Şube Ağı", subtitle: "Şube kartları, komisyon ve performans.", roles: ALL, group: "ŞUBE YÖNETİMİ" },
  { id: "transfers", label: "Sevk / Depo", icon: "swap", title: "Stok Yönlendirme", subtitle: "Merkez ↔ şube konsinye ve toptan sevk.", roles: ALL, group: "ŞUBE YÖNETİMİ" },

  { id: "service", label: "Servis", icon: "wrench", title: "Servis Yönetimi", subtitle: "Servis kabul, bakım ve iş emirleri.", roles: ALL, group: "OPERASYON" },
  { id: "parts", label: "Yedek Parça", icon: "package", title: "Yedek Parça", subtitle: "Parça hareketleri ve stok kayıtları.", roles: ["Admin"], group: "OPERASYON" },
  { id: "purchasing", label: "Satın Alma", icon: "shopping-cart", title: "Satın Alma", subtitle: "Tedarikçi ve sipariş süreçleri.", roles: ["Admin"], group: "OPERASYON" },

  { id: "payments", label: "Kasa / Banka", icon: "bank", title: "Kasa ve Banka", subtitle: "Tahsilat, tediye ve açık bakiye kapatma.", roles: ["Admin", "Staff", "Dealer"], group: "MUHASEBE & FİNANS" },
  { id: "expenses", label: "Giderler", icon: "wallet", title: "Giderler", subtitle: "İşletme giderlerini kaydet ve takip et.", roles: ["Admin", "Staff"], group: "MUHASEBE & FİNANS" },
  { id: "finance", label: "Cari / Finans", icon: "credit-card", title: "Cari ve Finans", subtitle: "Ödeme planı ve cari takip kayıtları.", roles: ["Admin"], group: "MUHASEBE & FİNANS" },
  { id: "ledger", label: "Yevmiye", icon: "book", title: "Yevmiye Defteri", subtitle: "Hesap planı ve otomatik mahsup fişleri.", roles: ["Admin"], group: "MUHASEBE & FİNANS" },
  { id: "balance", label: "Bilanço", icon: "chart", title: "Bilanço ve Mizan", subtitle: "Aktif-pasif denge, gelir tablosu, mizan.", roles: ["Admin"], group: "MUHASEBE & FİNANS" },
  { id: "reports", label: "Kârlılık", icon: "trend", title: "Kârlılık Raporu", subtitle: "Brüt kâr ve net sonuç analizi.", roles: ["Admin"], group: "MUHASEBE & FİNANS" },

  { id: "users", label: "Kullanıcılar", icon: "shield", title: "Kullanıcı ve Yetki", subtitle: "Hesap, davet ve yetki yönetimi.", roles: ["Admin"], group: "YÖNETİM" },
  { id: "automation", label: "Otomasyon", icon: "workflow", title: "Otomasyon Merkezi", subtitle: "Bildirim ve otomasyon görevleri.", roles: ["Admin"], group: "YÖNETİM" },
  { id: "audit", label: "İşlem Geçmişi", icon: "history", title: "İşlem Geçmişi", subtitle: "Kritik kayıtların denetim izi.", roles: ["Admin"], group: "YÖNETİM" },
  { id: "tenant", label: "İşletme / Paket", icon: "settings", title: "İşletme ve Paket", subtitle: "İşletme profili, abonelik ve güvenlik.", roles: ["Admin"], group: "YÖNETİM" },
];

const ROLE_LABEL: Record<Role, string> = { Admin: "Yönetici", Staff: "Personel", Dealer: "Bayi" };

const PRODUCT = "MMS";
const PRODUCT_SUB = "ERP CONTROL PANEL";

type TenantInfo = {
  name: string; slug: string; planKey: string; subscriptionStatus: string;
  trialEndsAt?: string | null; maxUsers: number; maxBranches: number; isActive: boolean;
  legalName?: string | null; contactEmail?: string | null;
};
type WorkflowLite = { id: number; module: string; title: string; status: string; dueAt?: string | null; amount?: number | null };
type Notice = { id: string; icon: string; tone: "warning" | "danger" | "info" | "success"; title: string; text: string; page: string; query?: string };
type PaletteItem = { id: string; group: string; icon: string; title: string; subtitle: string; action: () => void };
type ThemeMode = "light" | "dark" | "system";

function parseHash() {
  const value = window.location.hash.replace(/^#\/?/, "").split("?")[0];
  return value || "dashboard";
}

/* ═════════════ Giriş ═════════════ */

function Login({ onToken }: { onToken: (token: string) => void }) {
  const { toast } = useUi();
  const [bootstrap, setBootstrap] = useState(false);
  const [tenantSlug, setTenantSlug] = useState(() =>
    new URLSearchParams(window.location.search).get("tenant") || localStorage.getItem("mca_tenant") || import.meta.env.VITE_TENANT_SLUG || "",
  );
  const [tenantName, setTenantName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/auth/${bootstrap ? "bootstrap" : "login"}`, jsonInit("POST",
        bootstrap
          ? { username: username.trim(), password, tenantName: tenantName.trim() || "İşletmem", tenantSlug: tenantSlug.trim() }
          : { username: username.trim(), password, tenantSlug: tenantSlug.trim() || null }));
      if (!response.ok) throw new Error(await errorText(response, "Giriş yapılamadı."));
      const data = await response.json();
      localStorage.setItem("mca_token", data.token);
      if (data.tenantSlug) localStorage.setItem("mca_tenant", data.tenantSlug);
      onToken(data.token);
      if (bootstrap) toast("success", "İşletme ve yönetici hesabı oluşturuldu.");
      else toast("success", `${data.tenantName ?? "İşletme"} paneline hoş geldiniz.`);
    } catch (err) {
      setError(err instanceof TypeError ? "Sunucuya ulaşılamadı. API'nin çalıştığını kontrol edin." : err instanceof Error ? err.message : "Giriş yapılamadı.");
    } finally { setBusy(false); }
  }

  const catalogHref = tenantSlug.trim() ? `/catalog?tenant=${encodeURIComponent(tenantSlug.trim())}` : "/catalog";

  return (
    <div className="auth-shell">
      <aside className="auth-hero">
        <div className="brand-lockup" style={{ padding: 0 }}>
          <span className="brand-mark"><Icon name="layers" size={22} /></span>
          <div><strong>{PRODUCT}</strong><small>{PRODUCT_SUB}</small></div>
        </div>
        <div>
          <p className="eyebrow" style={{ color: "#8eb9ff" }}>İŞLETME YÖNETİM PLATFORMU</p>
          <h2>Satıştan servise, stoktan muhasebeye tek panel.</h2>
          <p>Motosiklet bayisi, otomobil galerisi veya çok şubeli her işletme için uyarlanabilir ERP.</p>
          <ul className="auth-points">
            <li><Icon name="check" /> Satış, teklif, sipariş ve rezervasyon</li>
            <li><Icon name="check" /> Stok, servis, yedek parça ve satın alma</li>
            <li><Icon name="check" /> Kasa, cari, yevmiye ve raporlar</li>
            <li><Icon name="check" /> Çok şubeli ekip, yetki ve denetim izi</li>
          </ul>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <small style={{ color: "#7f93b0" }}>© {new Date().getFullYear()} MMS ERP Control Panel · Motorcycle Management System</small>
          <a href={catalogHref} className="link-button" style={{ margin: 0, color: "#8eb9ff", fontSize: 12 }}>Ürün kataloğu ↗</a>
        </div>
      </aside>
      <main className="auth-form-wrap">
        <div className="auth-card">
          <p className="eyebrow">{bootstrap ? "YENİ İŞLETME KURULUMU" : "HOŞ GELDİNİZ"}</p>
          <h1>{bootstrap ? "İşletmenizi kurun" : "Yönetim paneline giriş"}</h1>
          <p className="panel-description">
            {bootstrap ? "İşletme bilgilerini ve ilk yönetici hesabını oluşturun. Kurulum yalnızca sistemde kullanıcı yokken çalışır." : "Devam etmek için işletme ve hesap bilgilerinizle giriş yapın."}
          </p>
          <form className="form-grid" onSubmit={(e) => void submit(e)}>
            <Field label="İşletme kısa adı" hint="Tek işletme varsa boş bırakabilirsiniz. Katalog adresinde de kullanılır.">
              <input value={tenantSlug} onChange={(e) => setTenantSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} minLength={3} placeholder="ornek-motors" />
            </Field>
            {bootstrap && <Field label="İşletme adı"><input value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="Örn. Örnek Motors" required /></Field>}
            <Field label="Kullanıcı adı"><input value={username} autoComplete="username" autoFocus onChange={(e) => setUsername(e.target.value)} required minLength={3} placeholder="kullanici.adi" /></Field>
            <Field label="Parola" hint={capsLock ? "Caps Lock açık." : undefined}>
              <div className="password-field">
                <input type={showPassword ? "text" : "password"} value={password}
                  autoComplete={bootstrap ? "new-password" : "current-password"}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={(e) => setCapsLock(e.getModifierState("CapsLock"))}
                  onKeyDown={(e) => setCapsLock(e.getModifierState("CapsLock"))}
                  required minLength={bootstrap ? 12 : 1} />
                <button type="button" className="icon-btn password-toggle" aria-label={showPassword ? "Parolayı gizle" : "Parolayı göster"}
                  onClick={() => setShowPassword((value) => !value)}>
                  <Icon name={showPassword ? "eye-off" : "eye"} size={18} />
                </button>
              </div>
            </Field>
            {error && <div className="callout callout-danger" role="alert"><Icon name="alert" /><div>{error}</div></div>}
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? "Lütfen bekleyin…" : bootstrap ? "İşletmeyi Kur" : "Giriş Yap"}</button>
          </form>
          <button type="button" className="link-button" onClick={() => { setBootstrap((value) => !value); setError(""); }}>
            {bootstrap ? "← Giriş ekranına dön" : "Yeni işletme / ilk kurulum"}
          </button>
          <p className="muted-text" style={{ marginTop: 18, fontSize: 12 }}>
            Parolanızı unuttuysanız işletme yöneticinizden sıfırlama isteyin.
          </p>
        </div>
      </main>
    </div>
  );
}

/* ═════════════ Kabuk ═════════════ */

function Shell({ onLogout }: { onLogout: () => void }) {
  const { toast } = useUi();
  const [page, setPage] = useState(parseHash);
  const [navSearch, setNavSearch] = useState("");
  const [role, setRole] = useState<Role>("Staff");
  const [roleReady, setRoleReady] = useState(false);
  const [username, setUsername] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [motorcycles, setMotorcycles] = useState<Motorcycle[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowLite[]>([]);
  const [users, setUsers] = useState<{ id: number; isActive: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteActive, setPaletteActive] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem("mca_theme");
    return saved === "dark" || saved === "light" ? saved : "system";
  });
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  const notifRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const paletteInputRef = useRef<HTMLInputElement>(null);

  /* Tema */
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const next = themeMode === "system" ? (media.matches ? "dark" : "light") : themeMode;
      document.documentElement.dataset.theme = next;
      setResolvedTheme(next);
    };
    apply();
    localStorage.setItem("mca_theme", themeMode);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [themeMode]);

  /* Çevrim içi durum */
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  /* Veri yükleme */
  const loadMotorcycles = useCallback(async () => {
    try {
      const response = await api("/motorcycles");
      if (!response.ok) throw new Error();
      setMotorcycles(await response.json());
    } catch { toast("error", "Ürün listesi alınamadı. API bağlantısını kontrol edin."); }
    finally { setLoading(false); }
  }, [toast]);

  const loadSales = useCallback(async () => {
    try {
      const response = await api("/sales");
      if (!response.ok) throw new Error(await errorText(response, "Satış geçmişi alınamadı."));
      setSales(await response.json());
    } catch (err) { toast("error", err instanceof Error ? err.message : "Satış geçmişi alınamadı."); }
  }, [toast]);

  const loadCustomers = useCallback(async () => {
    try {
      const response = await api("/customers");
      if (response.ok) setCustomers(await response.json());
    } catch { /* çevrim dışı: mevcut liste kullanılmaya devam eder */ }
  }, []);

  const loadDealers = useCallback(async () => {
    try {
      const response = await api("/dealers");
      if (response.ok) setDealers(await response.json());
    } catch { /* çevrim dışı: mevcut liste kullanılmaya devam eder */ }
  }, []);

  const reloadAll = useCallback(async () => {
    await Promise.all([loadMotorcycles(), loadSales(), loadCustomers(), loadDealers()]);
  }, [loadMotorcycles, loadSales, loadCustomers, loadDealers]);

  useEffect(() => {
    void reloadAll();
    void api("/auth/me").then(async (response) => {
      if (!response.ok) return;
      const me = await response.json();
      const nextRole: Role = me.role === "Admin" ? "Admin" : me.role === "Dealer" ? "Dealer" : "Staff";
      setRole(nextRole);
      setUsername(me.username || "");
      setTenantName(me.tenantName || "");
      setTenantSlug(me.tenantSlug || "");
    }).finally(() => setRoleReady(true));
    void api("/tenant/current").then(async (response) => {
      if (response.ok) setTenant(await response.json());
    });
    void Promise.all(["calendar", "service", "crm"].map((module) => api(`/workflows/${module}`))).then(async (responses) => {
      const rows: WorkflowLite[] = [];
      for (const response of responses) if (response.ok) rows.push(...(await response.json()));
      setWorkflows(rows);
    });
  }, [reloadAll]);

  useEffect(() => {
    if (role !== "Admin") return;
    void api("/users").then(async (response) => { if (response.ok) setUsers(await response.json()); });
  }, [role]);

  useEffect(() => {
    if (tenantSlug) setOnboardingDismissed(localStorage.getItem(`mca_onboard_${tenantSlug}`) === "1");
  }, [tenantSlug]);

  /* Rota ve rol koruması */
  const items = useMemo(() => NAV.filter((item) => item.roles.includes(role)), [role]);
  const current = useMemo(() => items.find((item) => item.id === page) ?? items[0], [items, page]);

  useEffect(() => {
    if (!roleReady) return;
    if (items.length > 0 && !items.some((item) => item.id === page)) {
      setPage("dashboard");
      history.replaceState(null, "", "#/dashboard");
    }
  }, [items, page, roleReady]);

  useEffect(() => {
    const onHash = () => { setPage(parseHash()); setNavSearch(""); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = useCallback((id: string, query = "") => {
    setPage(id);
    setNavSearch(query);
    setMenuOpen(false);
    setPaletteOpen(false);
    setNotifOpen(false);
    setUserOpen(false);
    history.replaceState(null, "", `#/${id}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  /* Bildirimler */
  const now = useNow();
  const notifications = useMemo<Notice[]>(() => {
    const list: Notice[] = [];
    const low = motorcycles.filter((item) => item.stockQuantity <= LOW_STOCK_LIMIT);
    if (low.length > 0) list.push({
      id: "low-stock", icon: "alert", tone: low.some((item) => item.stockQuantity === 0) ? "danger" : "warning",
      title: `${low.length} üründe stok azaldı`, text: `${low.slice(0, 2).map((item) => `${item.brand} ${item.model}`).join(", ")}${low.length > 2 ? "…" : ""}`,
      page: "motorcycles",
    });
    const reserved = sales.filter((sale) => !sale.isCancelled && sale.status === "Reserved");
    if (reserved.length > 0) list.push({
      id: "reserved", icon: "clock", tone: "info", title: `${reserved.length} rezervasyon faturalanmayı bekliyor`,
      text: "Teslim edilen rezervasyonları faturaya dönüştürün.", page: "sales",
    });
    const overdue = now > 0 ? workflows.filter((row) => row.dueAt && new Date(row.dueAt).getTime() < now && !["Completed", "Cancelled"].includes(row.status)) : [];
    if (overdue.length > 0) list.push({
      id: "overdue", icon: "calendar", tone: "warning", title: `${overdue.length} gecikmiş görev`,
      text: overdue.slice(0, 2).map((row) => row.title).join(", "), page: "calendar",
    });
    const receivable = sales.filter((sale) => !sale.isCancelled && sale.paymentMethod === "Credit" && (sale.paidAmount ?? 0) < sale.totalPrice);
    if (receivable.length > 0) {
      const total = receivable.reduce((sum, sale) => sum + (sale.totalPrice - (sale.paidAmount ?? 0)), 0);
      list.push({ id: "receivable", icon: "wallet", tone: "info", title: "Açık cari bakiye", text: `${receivable.length} satışta toplam ${money(total)} tahsil edilecek.`, page: "payments" });
    }
    const noCost = motorcycles.filter((item) => item.purchaseCost <= 0);
    if (role === "Admin" && noCost.length > 0) list.push({
      id: "no-cost", icon: "alert", tone: "warning", title: `${noCost.length} ürünün maliyeti tanımsız`,
      text: "Maliyeti olmayan ürünler satılamaz ve kâr hesabını bozar.", page: "motorcycles",
    });
    if (now > 0 && tenant?.subscriptionStatus === "Trial" && tenant.trialEndsAt) {
      const days = Math.ceil((new Date(tenant.trialEndsAt).getTime() - now) / 86_400_000);
      if (days <= 7) list.push({
        id: "trial", icon: "star", tone: days <= 0 ? "danger" : "warning",
        title: days > 0 ? `Deneme süresi ${days} gün sonra bitiyor` : "Deneme süresi doldu",
        text: "Paket seçeneklerini inceleyip plan talebi oluşturabilirsiniz.", page: "tenant",
      });
    }
    return list;
  }, [motorcycles, sales, workflows, role, tenant, now]);

  const noticeCount = notifications.length;

  /* Menü dışına tıklama */
  useEffect(() => {
    if (!notifOpen && !userOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (notifOpen && notifRef.current && !notifRef.current.contains(target)) setNotifOpen(false);
      if (userOpen && userRef.current && !userRef.current.contains(target)) setUserOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [notifOpen, userOpen]);

  /* Klavye kısayolları */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true); setPaletteQuery(""); setPaletteActive(0);
        window.setTimeout(() => paletteInputRef.current?.focus(), 30);
      } else if (!typing && event.key === "/") {
        event.preventDefault();
        setPaletteOpen(true); setPaletteQuery(""); setPaletteActive(0);
        window.setTimeout(() => paletteInputRef.current?.focus(), 30);
      } else if (!typing && event.key === "?") {
        event.preventDefault(); setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* Komut paleti sonuçları */
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const query = trLower(paletteQuery.trim());
    const results: PaletteItem[] = [];
    const addPages = () => items.forEach((item) => results.push({
      id: `nav-${item.id}`, group: "Sayfalar", icon: item.icon, title: item.label, subtitle: item.title,
      action: () => go(item.id),
    }));
    if (!query) {
      addPages();
      results.push(
        { id: "quick-sale", group: "Hızlı işlemler", icon: "plus", title: "Yeni satış başlat", subtitle: "Satış sihirbazını aç", action: () => go("sales") },
        { id: "quick-customer", group: "Hızlı işlemler", icon: "users", title: "Yeni müşteri", subtitle: "Müşteri kartı oluştur", action: () => go("customers") },
        { id: "quick-stock", group: "Hızlı işlemler", icon: "box", title: "Stok hareketi", subtitle: "Giriş veya çıkış kaydı", action: () => go("stock") },
        { id: "quick-catalog", group: "Hızlı işlemler", icon: "external", title: "Müşteri kataloğunu aç", subtitle: "Yeni sekmede yayınlanan katalog", action: () => window.open(`/catalog?tenant=${encodeURIComponent(tenantSlug)}`, "_blank", "noopener") },
      );
      return results;
    }
    const matches = (...values: (string | number | null | undefined)[]) => trLower(values.filter(Boolean).join(" ")).includes(query);
    items.filter((item) => matches(item.label, item.title, item.subtitle)).forEach((item) => results.push({
      id: `nav-${item.id}`, group: "Sayfalar", icon: item.icon, title: item.label, subtitle: item.title, action: () => go(item.id),
    }));
    motorcycles.filter((item) => matches(item.brand, item.model, item.color)).slice(0, 6).forEach((item) => results.push({
      id: `moto-${item.id}`, group: "Ürünler", icon: "bike", title: `${item.brand} ${item.model}`,
      subtitle: `${item.color} · ${item.engineCapacityCc} cc · stok ${item.stockQuantity}`, action: () => go("motorcycles", `${item.brand} ${item.model}`),
    }));
    customers.filter((item) => matches(item.fullName, item.phone, item.email)).slice(0, 6).forEach((item) => results.push({
      id: `cust-${item.id}`, group: "Müşteriler", icon: "users", title: item.fullName,
      subtitle: item.phone ?? item.email ?? "Müşteri kartı", action: () => go("customers", item.fullName),
    }));
    sales.filter((sale) => matches(`#${sale.id}`, sale.customerName, saleName(sale, motorcycles))).slice(0, 5).forEach((sale) => results.push({
      id: `sale-${sale.id}`, group: "Satışlar", icon: "cart", title: `#${sale.id} · ${sale.customerName}`,
      subtitle: `${saleName(sale, motorcycles)} · ${money(sale.totalPrice)}`, action: () => go("sales", `#${sale.id}`),
    }));
    return results.slice(0, 40);
  }, [paletteQuery, items, motorcycles, customers, sales, go, tenantSlug]);

  useEffect(() => { setPaletteActive(0); }, [paletteQuery]);

  const dismissOnboarding = () => {
    setOnboardingDismissed(true);
    if (tenantSlug) localStorage.setItem(`mca_onboard_${tenantSlug}`, "1");
  };

  const onboardingSteps = useMemo(() => {
    const profileDone = !!(tenant?.legalName && tenant?.contactEmail);
    const steps = [
      { key: "profile", title: "İşletme profilini tamamla", text: "Ticari unvan ve iletişim bilgisi", done: profileDone, page: "tenant" },
      { key: "product", title: "İlk ürünü ekle", text: "Envanter ve fiyat bilgisi", done: motorcycles.length > 0, page: "motorcycles" },
      { key: "customer", title: "İlk müşteriyi kaydet", text: "CRM ve satış geçmişi", done: customers.length > 0, page: "customers" },
      { key: "sale", title: "İlk satışı tamamla", text: "Stok ve muhasebe otomatik işlenir", done: sales.length > 0, page: "sales" },
    ];
    if (role === "Admin") steps.push({ key: "team", title: "Ekibini davet et", text: "Kullanıcı ve yetki tanımı", done: users.length > 1, page: "users" });
    return steps;
  }, [tenant, motorcycles, customers, sales, users, role]);

  const showOnboarding = role === "Admin" && !onboardingDismissed && onboardingSteps.some((step) => !step.done);
  const onboardingDone = onboardingSteps.filter((step) => step.done).length;

  const toggleTheme = () => setThemeMode(resolvedTheme === "dark" ? "light" : "dark");

  const renderPage = () => {
    switch (current.id) {
      case "dashboard": return <Dashboard motorcycles={motorcycles} sales={sales} role={role} onNavigate={go} />;
      case "motorcycles": return <Motorcycles key={`m-${navSearch}`} motorcycles={motorcycles} loading={loading} role={role} reload={loadMotorcycles} initialSearch={navSearch} />;
      case "sales": return <Sales key={`s-${navSearch}`} motorcycles={motorcycles} sales={sales} customers={customers} dealers={dealers} role={role} loading={loading} reload={reloadAll} initialSearch={navSearch} />;
      case "customers": return <CustomersPage key={`c-${navSearch}`} customers={customers} reload={loadCustomers} initialSearch={navSearch} />;
      case "stock": return <StockPage motorcycles={motorcycles} role={role} reloadMotorcycles={loadMotorcycles} />;
      case "dealers": return <DealersPage role={role} />;
      case "transfers": return <TransfersPage motorcycles={motorcycles} role={role} />;
      case "payments": return <PaymentsPage role={role} />;
      case "expenses": return <ExpensesPage role={role} />;
      case "ledger": return <LedgerPage />;
      case "balance": return <BalancePage />;
      case "reports": return <ReportsPage />;
      case "users": return <UsersPage currentUsername={username} dealers={dealers} />;
      case "tenant": return <TenantSettingsPage />;
      case "audit": return <AuditPage />;
      case "catalog": return <CatalogManagement motorcycles={motorcycles} />;
      case "calendar": case "service": case "parts": case "purchasing": case "tradein": case "crm": case "finance": case "automation":
        return <OperationalModules module={current.id as ModuleKey} role={role} />;
      default: return null;
    }
  };

  return (
    <div className="app-layout">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand-lockup">
          <span className="brand-mark"><Icon name="layers" size={22} /></span>
          <div><strong>{PRODUCT}</strong><small>{tenantName || PRODUCT_SUB}</small></div>
        </div>
        <nav aria-label="Ana menü">
          {items.map((item, index) => (
            <span key={item.id}>
              {(index === 0 || item.group !== items[index - 1].group) && <div className="nav-caption">{item.group}</div>}
              <button type="button" className={`nav-item ${current.id === item.id ? "active" : ""}`} onClick={() => go(item.id)}>
                <Icon name={item.icon} />{item.label}
                {item.id === "motorcycles" && motorcycles.some((moto) => moto.stockQuantity <= LOW_STOCK_LIMIT) && (
                  <span className="nav-badge" title="Düşük stoklu ürün">{motorcycles.filter((moto) => moto.stockQuantity <= LOW_STOCK_LIMIT).length}</span>
                )}
              </button>
            </span>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-avatar">{(username || "U").slice(0, 1).toUpperCase()}</div>
          <div className="user-meta"><strong>{username || "Kullanıcı"}</strong><small>{ROLE_LABEL[role]} · {tenantName || tenantSlug || "İşletme"}</small></div>
          <button type="button" className="icon-btn" title="Çıkış yap" aria-label="Çıkış yap" onClick={onLogout}><Icon name="logout" /></button>
        </div>
      </aside>
      {menuOpen && <div className="sidebar-scrim" onClick={() => setMenuOpen(false)} />}

      <div className="workspace">
        <header className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <button type="button" className="icon-btn menu-toggle" aria-label="Menüyü aç" onClick={() => setMenuOpen(true)}><Icon name="menu" size={22} /></button>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <h1>{current.title}</h1>
                {tenantSlug && <span className="topbar-tenant"><span className="dot" />{tenantName || tenantSlug}</span>}
              </div>
              <p className="subtitle">{current.subtitle}</p>
            </div>
          </div>
          <div className="topbar-actions">
            <button type="button" className="search-trigger" onClick={() => { setPaletteOpen(true); setPaletteQuery(""); window.setTimeout(() => paletteInputRef.current?.focus(), 30); }} aria-label="Hızlı arama">
              <Icon name="search" size={16} /><span className="search-label">Ara veya komut çalıştır…</span><Kbd>Ctrl K</Kbd>
            </button>

            <div className="menu" ref={notifRef}>
              <button type="button" className="icon-btn" aria-label={`Bildirimler (${noticeCount})`} aria-expanded={notifOpen} onClick={() => { setNotifOpen((v) => !v); setUserOpen(false); }}>
                <Icon name="bell" size={20} />
                {noticeCount > 0 && <span className="bell-count">{noticeCount}</span>}
              </button>
              {notifOpen && (
                <div className="menu-panel" role="dialog" aria-label="Bildirimler">
                  <div className="menu-panel-head">
                    <div><strong>Bildirimler</strong><small>{noticeCount} açık uyarı ve hatırlatma</small></div>
                    <Badge tone={noticeCount > 0 ? "warning" : "success"}>{noticeCount > 0 ? "Dikkat" : "Temiz"}</Badge>
                  </div>
                  <div className="menu-list">
                    {notifications.length === 0
                      ? <div className="palette-empty">Şu anda bekleyen bildirim yok.</div>
                      : notifications.map((notice) => (
                        <button key={notice.id} type="button" className="notif" onClick={() => go(notice.page, notice.query ?? "")}>
                          <span className={`notif-icon tone-${notice.tone}`}><Icon name={notice.icon} size={17} /></span>
                          <span className="notif-body"><strong>{notice.title}</strong><small>{notice.text}</small></span>
                          <Icon name="chevron-right" size={15} />
                        </button>
                      ))}
                  </div>
                  <div className="menu-foot">
                    <button type="button" className="btn btn-ghost btn-block btn-sm" onClick={() => { setNotifOpen(false); setPage("dashboard"); history.replaceState(null, "", "#/dashboard"); }}>Genel bakışa dön</button>
                  </div>
                </div>
              )}
            </div>

            <button type="button" className="icon-btn" title={resolvedTheme === "dark" ? "Açık temaya geç" : "Koyu temaya geç"} aria-label="Temayı değiştir" onClick={toggleTheme}>
              <Icon name={resolvedTheme === "dark" ? "sun" : "moon"} size={20} />
            </button>

            <div className="menu" ref={userRef}>
              <button type="button" className="user-chip" aria-label="Kullanıcı menüsü" aria-expanded={userOpen} onClick={() => { setUserOpen((v) => !v); setNotifOpen(false); }}>
                <span className="user-avatar">{(username || "U").slice(0, 1).toUpperCase()}</span>
                <span className="chip-meta"><strong>{username || "Kullanıcı"}</strong><small>{ROLE_LABEL[role]}</small></span>
                <Icon name="chevron" size={14} />
              </button>
              {userOpen && (
                <div className="menu-panel" role="dialog" aria-label="Kullanıcı menüsü">
                  <div className="menu-panel-head">
                    <div><strong>{username || "Kullanıcı"}</strong><small>{ROLE_LABEL[role]} · {tenantName || tenantSlug}</small></div>
                    <span className="user-avatar">{(username || "U").slice(0, 1).toUpperCase()}</span>
                  </div>
                  <div className="theme-select" role="group" aria-label="Tema">
                    <button type="button" className={themeMode === "light" ? "active" : ""} onClick={() => setThemeMode("light")}><Icon name="sun" size={16} /> Açık</button>
                    <button type="button" className={themeMode === "dark" ? "active" : ""} onClick={() => setThemeMode("dark")}><Icon name="moon" size={16} /> Koyu</button>
                    <button type="button" className={themeMode === "system" ? "active" : ""} onClick={() => setThemeMode("system")}><Icon name="settings" size={16} /> Sistem</button>
                  </div>
                  <ul className="menu-list">
                    {role === "Admin" && <li><button type="button" onClick={() => { setUserOpen(false); go("tenant"); }}><Icon name="settings" /> İşletme ayarları<span className="menu-meta"><Icon name="chevron-right" size={14} /></span></button></li>}
                    <li><button type="button" onClick={() => { setUserOpen(false); setPasswordOpen(true); }}><Icon name="key" /> Parola değiştir</button></li>
                    <li><button type="button" onClick={() => { setUserOpen(false); setShortcutsOpen(true); }}><Icon name="help" /> Klavye kısayolları</button></li>
                    <li><a href={`/catalog?tenant=${encodeURIComponent(tenantSlug)}`} target="_blank" rel="noreferrer" onClick={() => setUserOpen(false)}><Icon name="external" /> Müşteri kataloğu</a></li>
                  </ul>
                  <div className="menu-foot">
                    <button type="button" className="btn btn-ghost btn-block btn-sm" onClick={onLogout}><Icon name="logout" size={15} /> Çıkış yap</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {offline && <div className="callout callout-warning" style={{ marginBottom: 16 }}><Icon name="alert" /><div>İnternet bağlantısı yok. Bağlantı sağlanana kadar işlemler başarısız olabilir.</div></div>}

        {roleReady && current.id === "dashboard" && showOnboarding && (
          <section className="panel onboarding">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div>
                <h2><Icon name="sparkles" /> Kurulumu tamamlayın</h2>
                <p className="panel-description">Sistemi kullanmaya başlamak için {onboardingSteps.length} adımdan {onboardingDone} tanesi tamamlandı.</p>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={dismissOnboarding}>Gizle</button>
            </div>
            <div style={{ marginTop: 12 }}><Progress value={onboardingDone} max={onboardingSteps.length} tone="green" label="Kurulum ilerlemesi" /></div>
            <div className="onboarding-grid">
              {onboardingSteps.map((step, index) => (
                <button key={step.key} type="button" className={`onboarding-step ${step.done ? "done" : ""}`} onClick={() => go(step.page)}>
                  <span className="step-dot">{step.done ? <Icon name="check" size={13} /> : index + 1}</span>
                  <span><strong>{step.title}</strong><small>{step.text}</small></span>
                </button>
              ))}
            </div>
          </section>
        )}

        {roleReady && current.id === "dashboard" && (
          <div className="quick-actions">
            <button type="button" className="btn btn-primary" onClick={() => go("sales")}><Icon name="plus" /> Yeni satış</button>
            <button type="button" className="btn btn-ghost" onClick={() => go("customers")}><Icon name="users" /> Müşteri ekle</button>
            {(role === "Admin" || role === "Staff") && <button type="button" className="btn btn-ghost" onClick={() => go("stock")}><Icon name="box" /> Stok girişi</button>}
            <button type="button" className="btn btn-ghost" onClick={() => go("service")}><Icon name="wrench" /> Servis kaydı</button>
            {role === "Admin" && <button type="button" className="btn btn-ghost" onClick={() => go("reports")}><Icon name="trend" /> Raporlar</button>}
          </div>
        )}

        {roleReady ? <PageBoundary key={current.id}>{renderPage()}</PageBoundary> : (
          <section className="panel" aria-busy="true">
            <div className="skeleton-list">
              <div className="skeleton" style={{ height: 26, width: "38%" }} />
              <div className="skeleton" style={{ height: 150 }} />
              <div className="skeleton" style={{ height: 150 }} />
            </div>
          </section>
        )}
      </div>

      <nav className="mobile-nav" aria-label="Mobil menü">
        {[
          { id: "dashboard", label: "Özet", icon: "dashboard" },
          { id: "sales", label: "Satış", icon: "cart" },
          { id: "motorcycles", label: "Ürün", icon: "bike" },
          { id: "customers", label: "Müşteri", icon: "users" },
        ].map((item) => (
          <button key={item.id} type="button" className={current.id === item.id ? "active" : ""} onClick={() => go(item.id)}>
            <Icon name={item.icon} size={20} />{item.label}
          </button>
        ))}
        <button type="button" onClick={() => setMenuOpen(true)}><Icon name="menu" size={20} />Menü</button>
      </nav>

      {paletteOpen && (
        <div className="palette-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setPaletteOpen(false)}>
          <div className="palette" role="dialog" aria-modal="true" aria-label="Hızlı arama ve komutlar">
            <div className="palette-input">
              <Icon name="search" size={19} />
              <input ref={paletteInputRef} autoFocus value={paletteQuery} placeholder="Sayfa, ürün, müşteri veya satış ara…"
                onChange={(event) => setPaletteQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") { event.preventDefault(); setPaletteOpen(false); }
                  else if (event.key === "ArrowDown") { event.preventDefault(); setPaletteActive((value) => Math.min(value + 1, paletteItems.length - 1)); }
                  else if (event.key === "ArrowUp") { event.preventDefault(); setPaletteActive((value) => Math.max(value - 1, 0)); }
                  else if (event.key === "Enter") {
                    event.preventDefault();
                    const item = paletteItems[paletteActive];
                    if (item) { item.action(); setPaletteOpen(false); }
                  }
                }} />
              <Kbd>Esc</Kbd>
            </div>
            <div className="palette-results">
              {paletteItems.length === 0 ? <div className="palette-empty">“{paletteQuery}” için sonuç bulunamadı.</div> : paletteItems.map((item, index) => (
                <div key={item.id}>
                  {(index === 0 || paletteItems[index - 1].group !== item.group) && <div className="palette-group">{item.group}</div>}
                  <button type="button" className={`palette-item ${index === paletteActive ? "active" : ""}`}
                    onMouseEnter={() => setPaletteActive(index)}
                    onClick={() => { item.action(); setPaletteOpen(false); }}>
                    <span className="pi-icon"><Icon name={item.icon} size={17} /></span>
                    <span className="pi-body"><strong>{item.title}</strong><small>{item.subtitle}</small></span>
                    {index === paletteActive && <Icon name="arrow-right" size={15} />}
                  </button>
                </div>
              ))}
            </div>
            <div className="palette-foot"><span><Kbd>↑</Kbd> <Kbd>↓</Kbd> gezin</span><span><Kbd>Enter</Kbd> aç</span><span><Kbd>Ctrl K</Kbd> kapat</span></div>
          </div>
        </div>
      )}

      {shortcutsOpen && (
        <Modal title="Klavye kısayolları" size="sm" onClose={() => setShortcutsOpen(false)} footer={<button type="button" className="btn btn-primary" onClick={() => setShortcutsOpen(false)}>Anladım</button>}>
          <div className="security-list">
            <div className="security-item"><div className="si-icon"><Icon name="search" /></div><div className="si-body"><strong>Hızlı arama</strong><small><Kbd>Ctrl</Kbd> + <Kbd>K</Kbd> veya <Kbd>/</Kbd></small></div></div>
            <div className="security-item"><div className="si-icon"><Icon name="help" /></div><div className="si-body"><strong>Kısayol yardımı</strong><small><Kbd>?</Kbd></small></div></div>
            <div className="security-item"><div className="si-icon"><Icon name="x" /></div><div className="si-body"><strong>Pencereyi kapat</strong><small><Kbd>Esc</Kbd></small></div></div>
            <div className="security-item"><div className="si-icon"><Icon name="arrow-right" /></div><div className="si-body"><strong>Aramada gezinme</strong><small><Kbd>↑</Kbd> <Kbd>↓</Kbd> ve <Kbd>Enter</Kbd></small></div></div>
          </div>
        </Modal>
      )}

      {passwordOpen && (
        <Modal title="Parola Değiştir" onClose={() => setPasswordOpen(false)}
          footer={<button type="button" className="btn btn-ghost" onClick={() => setPasswordOpen(false)}>Kapat</button>}>
          <PasswordChangeCard
            hint="Parola değiştiğinde güvenlik için oturumunuz kapatılır ve yeniden giriş yapmanız istenir."
            onChanged={() => { setPasswordOpen(false); localStorage.removeItem("mca_token"); onLogout(); }} />
        </Modal>
      )}
    </div>
  );
}

/* ═════════════ Kök ═════════════ */

function Root() {
  const [token, setToken] = useState(localStorage.getItem("mca_token") || "");

  useEffect(() => {
    const saved = localStorage.getItem("mca_theme");
    document.documentElement.dataset.theme = saved === "dark" ? "dark" : saved === "light" ? "light" : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }, []);

  if (window.location.pathname.replace(/\/$/, "") === "/catalog") return <PublicCatalog />;
  if (!token) return <Login onToken={setToken} />;
  return <Shell onLogout={() => { localStorage.removeItem("mca_token"); setToken(""); }} />;
}

export default function App() {
  return <UiProvider><Root /></UiProvider>;
}
