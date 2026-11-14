import {
  cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useLayoutEffect,
  useMemo, useRef, useState,
  type ReactElement, type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/* ───────────── İkonlar (bağımlılıksız satır içi SVG) ───────────── */
const paths: Record<string, string> = {
  dashboard: "M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z",
  bike: "M5 18a3 3 0 100-6 3 3 0 000 6zM19 18a3 3 0 100-6 3 3 0 000 6zM12 18l-2-6h5l2 6M9 7h3l3 5",
  users: "M16 20v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 20v-1a4 4 0 00-3-3.9M16 4.1a3.5 3.5 0 010 6.8",
  box: "M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  cart: "M3 4h2l2.4 11h10.2L20 7H6M9 20a1 1 0 100-2 1 1 0 000 2zM17 20a1 1 0 100-2 1 1 0 000 2z",
  wallet: "M3 7a2 2 0 012-2h13v4M3 7v10a2 2 0 002 2h15a1 1 0 001-1V9a1 1 0 00-1-1H5a2 2 0 01-2-1zM17 14h.01",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  plus: "M12 5v14M5 12h14",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-4.5-4.5",
  download: "M12 4v11M7 11l5 5 5-5M4 20h16",
  logout: "M9 4H5a1 1 0 00-1 1v14a1 1 0 001 1h4M16 8l4 4-4 4M20 12H9",
  chevron: "M6 9l6 6 6-6",
  check: "M5 12l5 5 9-10",
  x: "M6 6l12 12M18 6L6 18",
  sun: "M12 17a5 5 0 100-10 5 5 0 000 10zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M21 13A9 9 0 1111 3a7 7 0 0010 10z",
  alert: "M12 3l10 18H2zM12 10v5M12 18h.01",
  info: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 8h.01",
  print: "M7 9V3h10v6M7 17H4v-6a1 1 0 011-1h14a1 1 0 011 1v6h-3M7 14h10v7H7z",
  menu: "M4 6h16M4 12h16M4 18h16",
  trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
  history: "M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8M3 3v5h5M12 7v5l3 2",
  building: "M4 21h16M6 21V5h12v16M9 9h.01M15 9h.01M9 13h.01M15 13h.01M9 17h.01M15 17h.01",
  swap: "M7 7h12l-3-3M17 17H5l3 3",
  bank: "M3 10l9-7 9 7M5 10v8h14v-8M3 18h18M10 14h4",
  book: "M4 5a2 2 0 012-2h12v16H6a2 2 0 00-2 2V5zM8 7h8",
  calendar: "M5 5h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1zM8 3v4M16 3v4M4 10h16",
  wrench: "M14.7 6.3a4 4 0 105.1 5.1l-2.1-2.1-2.9-2.9zM13 11L4 20l-1-1 9-9",
  package: "M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8M7.5 5.3l9 5",
  "shopping-cart": "M3 4h2l2.4 11h10.2L20 7H6M9 20a1 1 0 100-2 1 1 0 000 2zM17 20a1 1 0 100-2 1 1 0 000 2zM8 9h10",
  repeat: "M17 2l4 4-4 4M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 01-3 3H3",
  workflow: "M5 4h5v5H5zM14 15h5v5h-5zM7.5 9v3a2 2 0 002 2h4.5M17 4h2a1 1 0 011 1v5",
  "building-2": "M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M15 9h.01M9 13h.01M15 13h.01M9 17h.01M15 17h.01",
  refresh: "M21 12a9 9 0 11-2.6-6.4M21 3v6h-6",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5",
  bell: "M18 8a6 6 0 10-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10.3 21a2 2 0 003.4 0",
  command: "M9 6a3 3 0 10-3 3h12a3 3 0 10-3-3v12a3 3 0 103-3H6a3 3 0 103 3z",
  "chevron-right": "M9 6l6 6-6 6",
  "chevron-left": "M15 6l-6 6 6 6",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H10a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V10a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z",
  lock: "M6 10h12a1 1 0 011 1v9a1 1 0 01-1 1H6a1 1 0 01-1-1v-9a1 1 0 011-1zM8 10V7a4 4 0 118 0v3M12 14v3",
  mail: "M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zM3 7l9 6 9-6",
  phone: "M5 3h4l2 5-2.5 1.5a12 12 0 006 6L16 13l5 2v4a2 2 0 01-2 2A17 17 0 013 5a2 2 0 012-2z",
  filter: "M3 5h18l-7 8v6l-4 2v-8z",
  user: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z",
  key: "M14 7a4 4 0 108 0 4 4 0 00-8 0zM14 7l-9 9v4h4l1-1v-3h2v-2h3",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z",
  "eye-off": "M3 3l18 18M10.6 10.6a3 3 0 004.2 4.2M9.9 5.2A10.6 10.6 0 0112 5c6 0 10 7 10 7a17 17 0 01-3.2 4M6.6 6.6A17 17 0 002 12s4 7 10 7a10 10 0 004.3-.9",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
  file: "M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8zM14 3v5h5M8 13h8M8 17h5",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5",
  truck: "M3 6h11v11H3zM14 10h4l3 3v4h-7zM7 20a2 2 0 100-4 2 2 0 000 4zM18 20a2 2 0 100-4 2 2 0 000 4z",
  sparkles: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 3v3M20.5 4.5h-3M5 18v3M6.5 19.5h-3",
  help: "M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9a2.5 2.5 0 115 0c0 1.5-2.5 2-2.5 3.5M12 17h.01",
  "plus-circle": "M12 21a9 9 0 100-18 9 9 0 000 18zM12 8v8M8 12h8",
  minus: "M5 12h14",
  "arrow-right": "M4 12h16M14 6l6 6-6 6",
  "arrow-left": "M20 12H4M10 6l-6 6 6 6",
  "check-circle": "M12 21a9 9 0 100-18 9 9 0 000 18zM8 12l3 3 5-6",
  "alert-circle": "M12 21a9 9 0 100-18 9 9 0 000 18zM12 8v5M12 16h.01",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  "more-horizontal": "M5 12h.01M12 12h.01M19 12h.01",
  "credit-card": "M3 6h18a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V7a1 1 0 011-1zM2 10h20M6 15h4",
  receipt: "M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM8 8h8M8 12h8M8 16h4",
  tag: "M20 13l-7 7-9-9V4h7l9 9zM8 8h.01",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  star: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  link: "M10 13a5 5 0 007.5.5l2-2a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7.5-.5l-2 2a5 5 0 007 7l1-1",
  database: "M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  sliders: "M4 6h16M4 12h16M4 18h16M8 4v4M16 10v4M10 16v4",
};

export function Icon({ name, size = 18 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] ?? ""} />
    </svg>
  );
}

/* ───────────── Bildirim + Onay penceresi (Provider) ───────────── */
type ToastKind = "success" | "error" | "info";
type Toast = { id: number; kind: ToastKind; text: string };
type ConfirmOptions = { title: string; message: string; confirmText?: string; danger?: boolean };
type UiContextValue = {
  toast: (kind: ToastKind, text: string) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const UiContext = createContext<UiContextValue | null>(null);

export function useUi() {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error("useUi, UiProvider içinde kullanılmalı.");
  return ctx;
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const nextId = useRef(1);

  const toast = useCallback((kind: ToastKind, text: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6500 : 4000);
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setDialog({ ...options, resolve })),
    [],
  );

  const close = (value: boolean) => {
    dialog?.resolve(value);
    setDialog(null);
  };

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);

  return (
    <UiContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <Icon name={t.kind === "success" ? "check" : t.kind === "error" ? "alert" : "info"} />
            <span>{t.text}</span>
            <button type="button" className="toast-close" aria-label="Kapat"
              onClick={() => setToasts((x) => x.filter((i) => i.id !== t.id))}>
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
      {dialog && (
        <Modal title={dialog.title} onClose={() => close(false)} size="sm"
          footer={<>
            <button type="button" className="btn btn-ghost" onClick={() => close(false)}>Vazgeç</button>
            <button type="button" className={`btn ${dialog.danger ? "btn-danger" : "btn-primary"}`} autoFocus
              onClick={() => close(true)}>{dialog.confirmText ?? "Onayla"}</button>
          </>}>
          <p className="confirm-text">{dialog.message}</p>
        </Modal>
      )}
    </UiContext.Provider>
  );
}

/* ───────────── Modal (portal + odak tuzağı) ───────────── */
export function Modal({ title, onClose, children, footer, size = "md" }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" | "xl";
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onCloseRef.current(); return; }
      if (e.key !== "Tab" || !boxRef.current) return;
      const focusable = Array.from(boxRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => {
      const box = boxRef.current;
      const body = box?.querySelector<HTMLElement>(".modal-body");
      if (!box || !body) return;
      /* Kullanıcı bu arada bir alana tıkladıysa odağını geri alma. */
      if (body.contains(document.activeElement)) return;
      /* İlk odak form alanı olmalı. Başlıktaki “Kapat” düğmesi DOM'da formdan
         önce geldiği için modal açılır açılmaz odak oraya gidiyor, kullanıcı
         yazmaya başlayınca harfler düğmeye gidiyordu. */
      const field = body.querySelector<HTMLElement>(
        'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), .select-trigger:not([disabled])',
      );
      const fallback = body.querySelector<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
      (field ?? fallback)?.focus({ preventScroll: true });
    }, 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      window.clearTimeout(timer);
      previousFocus?.focus?.();
    };
    // Yalnızca modal açıldığında çalışır; her tuş vuruşunda odağı ilk alana
    // geri taşımamak için onClose güncel referanstan okunur.
  }, []);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={boxRef} className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-head">
          <h3 id={titleId}>{title}</h3>
          <button type="button" className="icon-btn" aria-label="Kapat" onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/* ───────────── Özel Dropdown (Select) ─────────────
   Tetikleyici, listenin genişliği ve satır yüksekliği metin kutusuyla (input)
   birebir aynı ölçülerde (44px) tasarlandı. Klavye ve arama desteği vardır. */
export type Option = { value: string; label: string; meta?: string; disabled?: boolean };

export function Select({ value, onChange, options, placeholder = "Seçiniz", required, searchable, disabled, ariaLabel }: {
  value: string; onChange: (value: string) => void; options: Option[]; placeholder?: string;
  required?: boolean; searchable?: boolean; disabled?: boolean; ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [menuStyle, setMenuStyle] = useState<{
    top?: number; bottom?: number; left: number; width: number; maxHeight: number;
  }>({ top: 0, left: 0, width: 0, maxHeight: 320 });
  const root = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /* Liste yalnızca klavyeyle gezinirken kaydırılır. Fareyle üzerine gelindiğinde
     liste kendi kendine kayarsa seçenek imlecin altından kaçar ve menü
     “oynuyor” gibi görünür. */
  const keyboardNav = useRef(true);

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr-TR");
    return q ? options.filter((o) => o.label.toLocaleLowerCase("tr-TR").includes(q)) : options;
  }, [options, query]);
  const selected = options.find((o) => o.value === value);

  /* Menü, viewport koordinatlarıyla fixed konumlanır. Yukarı açılırken yüksekliği
     ölçmek yerine alt kenarı tetikleyiciye sabitlenir; böylece menü her zaman
     alanına yapışık kalır ve sayfa zıplamaz. */
  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gap = 6;
    const margin = 12;
    const viewportH = window.innerHeight;
    const viewportW = document.documentElement.clientWidth;
    const spaceBelow = viewportH - rect.bottom - gap - margin;
    const spaceAbove = rect.top - gap - margin;
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(96, Math.min(340, openUp ? spaceAbove : spaceBelow));
    const width = Math.max(160, Math.min(rect.width, viewportW - margin * 2));
    setMenuStyle({
      top: openUp ? undefined : Math.min(rect.bottom + gap, viewportH - margin - maxHeight),
      bottom: openUp ? viewportH - rect.top + gap : undefined,
      left: Math.min(Math.max(margin, rect.left), Math.max(margin, viewportW - width - margin)),
      width,
      maxHeight,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (root.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const onScroll = (event: Event) => {
      /* Seçenek listesinin kendi içinde kaydırılması menüyü yeniden
         konumlandırmamalı; aksi halde uzun listelerde menü kayıyor. */
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      place();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    window.visualViewport?.addEventListener("resize", onScroll);
    window.visualViewport?.addEventListener("scroll", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      window.visualViewport?.removeEventListener("resize", onScroll);
      window.visualViewport?.removeEventListener("scroll", onScroll);
    };
  }, [open, place]);

  /* Arama alanına odaklanırken tarayıcının sayfayı kaydırmasını engelle. */
  useEffect(() => {
    if (open && searchable) searchRef.current?.focus({ preventScroll: true });
  }, [open, searchable]);

  /* Aktif satırı yalnızca liste içinde kaydır; window.scrollIntoView sayfayı oynatıyordu. */
  useEffect(() => {
    if (!open || !keyboardNav.current) return;
    const list = listRef.current;
    const item = list?.children[active] as HTMLElement | undefined;
    if (!list || !item) return;
    const listBox = list.getBoundingClientRect();
    const itemBox = item.getBoundingClientRect();
    if (itemBox.top < listBox.top) list.scrollTop -= listBox.top - itemBox.top + 4;
    else if (itemBox.bottom > listBox.bottom) list.scrollTop += itemBox.bottom - listBox.bottom + 4;
  }, [active, open]);

  function toggle() {
    if (disabled) return;
    if (!open) {
      keyboardNav.current = true;
      setQuery("");
      const idx = visible.findIndex((o) => o.value === value);
      setActive(idx >= 0 ? idx : 0);
      place();
    }
    setOpen(!open);
  }
  function pick(o: Option | undefined) {
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { toggle(); return; }
      keyboardNav.current = true;
      const dir = e.key === "ArrowDown" ? 1 : -1;
      let i = active;
      for (let n = 0; n < visible.length; n++) {
        i = (i + dir + visible.length) % visible.length;
        if (!visible[i].disabled) break;
      }
      setActive(i);
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      pick(visible[active] ?? visible[0]);
    } else if ((e.key === " " || e.key === "Enter") && !open && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      toggle();
    }
  }

  const menu = open ? createPortal(
    <div ref={menuRef} className="select-menu select-menu-fixed"
      style={{ top: menuStyle.top, bottom: menuStyle.bottom, left: menuStyle.left, width: menuStyle.width, maxHeight: menuStyle.maxHeight }}>
      {searchable && (
        <div className="select-search">
          <Icon name="search" size={15} />
          <input ref={searchRef} value={query} placeholder="Ara…" aria-label="Seçeneklerde ara"
            onChange={(e) => { keyboardNav.current = true; setQuery(e.target.value); setActive(0); }} />
        </div>
      )}
      <ul role="listbox" ref={listRef}>
        {visible.length === 0 && <li className="select-empty">Sonuç bulunamadı</li>}
        {visible.map((o, i) => (
          <li key={o.value + i} role="option" aria-selected={o.value === value} aria-disabled={o.disabled}
            className={`select-option ${i === active ? "active" : ""} ${o.value === value ? "selected" : ""} ${o.disabled ? "disabled" : ""}`}
            onMouseEnter={() => { keyboardNav.current = false; setActive(i); }} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)}>
            <span className="select-option-label">{o.label}</span>
            {o.meta && <span className="select-option-meta">{o.meta}</span>}
            {o.value === value && <Icon name="check" size={15} />}
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  ) : null;

  return (
    <div className={`select ${open ? "is-open" : ""}`} ref={root} onKeyDown={onKeyDown}>
      <button ref={triggerRef} type="button" className="select-trigger" onClick={toggle} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel} aria-required={required || undefined}>
        <span className={selected ? "select-value" : "select-placeholder"}>{selected ? selected.label : placeholder}</span>
        <Icon name="chevron" size={16} />
      </button>
      {menu}
    </div>
  );
}

/* ───────────── Küçük yardımcı bileşenler ───────────── */
export function Field({ label, hint, children, className = "" }: {
  label: string; hint?: string; children: ReactNode; className?: string;
}) {
  const controlId = useId();
  const fieldRef = useRef<HTMLDivElement>(null);
  const control = isValidElement<{ id?: string }>(children) ? children : null;
  const isNativeControl = !!control && typeof control.type === "string"
    && ["input", "textarea", "select"].includes(control.type);

  /* Etikete tıklamak alanı odaklamalı. Özel bileşenlerde (Select, parola alanı)
     htmlFor kullanılamadığı için alanın ilk denetimi elle odaklanır. */
  function focusControl() {
    fieldRef.current
      ?.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), .select-trigger:not([disabled])')
      ?.focus();
  }

  return (
    <div ref={fieldRef} className={`field ${className}`}>
      <label htmlFor={isNativeControl ? controlId : undefined} onClick={isNativeControl ? undefined : focusControl}>{label}</label>
      {isNativeControl ? cloneElement(control as ReactElement<{ id?: string }>, { id: controlId }) : children}
      {hint && <small className="field-hint">{hint}</small>}
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "success" | "danger" | "warning" | "info"; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="search-box">
      <Icon name="search" size={16} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </div>
  );
}

export function PanelHead({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="panel-head">
      <div>
        <h2>{title}</h2>
        {description && <p className="panel-description">{description}</p>}
      </div>
      {actions && <div className="panel-actions">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon = "box", title, text }: { icon?: string; title: string; text?: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon name={icon} size={26} /></div>
      <strong>{title}</strong>
      {text && <p>{text}</p>}
    </div>
  );
}

export function StatCard({ label, value, hint, icon, tone = "blue" }: {
  label: string; value: ReactNode; hint?: string; icon: string; tone?: "blue" | "green" | "amber" | "red" | "violet";
}) {
  return (
    <article className="stat-card">
      <div className={`stat-icon tone-${tone}`}><Icon name={icon} size={20} /></div>
      <div className="stat-body">
        <span>{label}</span>
        <strong>{value}</strong>
        {hint && <small>{hint}</small>}
      </div>
    </article>
  );
}

/* ───────────── Sıralanabilir + sayfalamalı tablo ───────────── */
export type Column<T> = {
  key: string; header: string; render: (row: T) => ReactNode;
  sort?: (row: T) => string | number; align?: "right" | "center";
};

export function DataTable<T>({ columns, rows, rowKey, pageSize = 10, empty, rowClass }: {
  columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string | number; pageSize?: number;
  empty?: ReactNode; rowClass?: (row: T) => string;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sort) return rows;
    const get = col.sort;
    return [...rows].sort((a, b) => {
      const x = get(a), y = get(b);
      const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "tr");
      return dir === "asc" ? r : -r;
    });
  }, [rows, columns, sortKey, dir]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages - 1);
  const slice = sorted.slice(current * pageSize, current * pageSize + pageSize);

  if (rows.length === 0) return <>{empty ?? <EmptyState title="Kayıt bulunamadı" />}</>;

  return (
    <>
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.align ? `align-${c.align}` : ""}
                  aria-sort={sortKey === c.key ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                  {c.sort ? (
                    <button type="button" className={`th-sort ${sortKey === c.key ? "sorted" : ""}`}
                      onClick={() => { if (sortKey === c.key) setDir(dir === "asc" ? "desc" : "asc"); else { setSortKey(c.key); setDir("asc"); } }}>
                      {c.header}<span className="sort-arrow">{sortKey === c.key ? (dir === "asc" ? "↑" : "↓") : "↕"}</span>
                    </button>
                  ) : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((row) => (
              <tr key={rowKey(row)} className={rowClass?.(row)}>
                {columns.map((c) => <td key={c.key} data-label={c.header} className={c.align ? `align-${c.align}` : ""}>{c.render(row)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > pageSize && (
        <div className="pagination">
          <span>{current * pageSize + 1}–{Math.min(sorted.length, (current + 1) * pageSize)} / {sorted.length} kayıt</span>
          <div>
            <button type="button" className="btn btn-ghost btn-sm" disabled={current === 0} onClick={() => setPage(current - 1)}>Önceki</button>
            <span className="page-indicator">{current + 1} / {pages}</span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Sonraki</button>
          </div>
        </div>
      )}
    </>
  );
}

/* ───────────── Sekmeler, ilerleme, kısayol ───────────── */
export function Tabs<T extends string>({ tabs, value, onChange, ariaLabel }: {
  tabs: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; ariaLabel?: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((t) => (
        <button key={t.value} role="tab" type="button" aria-selected={value === t.value}
          className={`tab ${value === t.value ? "active" : ""}`} onClick={() => onChange(t.value)}>
          {t.label}{typeof t.count === "number" && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, max = 100, tone = "blue", label }: { value: number; max?: number; tone?: "blue" | "green" | "amber" | "red"; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemax={max} aria-label={label ?? "Kullanım"}>
      <div className={`progress-bar tone-${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/* ───────────── Basit SVG çubuk grafik ───────────── */
export function BarChart({ data, format }: { data: { label: string; value: number }[]; format: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const W = 640, H = 220, padL = 8, padB = 28, padT = 14;
  const bw = (W - padL * 2) / data.length;
  return (
    <svg className="bar-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Günlük satış cirosu grafiği">
      {[0, 0.5, 1].map((t) => {
        const y = padT + (H - padT - padB) * (1 - t);
        return <line key={t} x1={padL} x2={W - padL} y1={y} y2={y} className="chart-grid" />;
      })}
      {data.map((d, i) => {
        const h = ((H - padT - padB) * d.value) / max;
        const x = padL + i * bw + bw * 0.18;
        return (
          <g key={d.label + i}>
            <rect x={x} y={H - padB - h} width={bw * 0.64} height={Math.max(h, d.value > 0 ? 2 : 0)} rx="3" className="chart-bar">
              <title>{`${d.label}: ${format(d.value)}`}</title>
            </rect>
            {(i % Math.ceil(data.length / 7) === 0 || i === data.length - 1) && (
              <text x={x + bw * 0.32} y={H - 8} textAnchor="middle" className="chart-label">{d.label}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function MetricNote({ children }: { children: ReactNode }) {
  return <div className="callout callout-warning"><Icon name="alert" /><div>{children}</div></div>;
}
