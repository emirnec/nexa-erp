export const API_BASE = (import.meta.env.VITE_API_BASE || "http://localhost:5172/api").replace(/\/$/, "");

export type Role = "Admin" | "Staff" | "Dealer";

export type Motorcycle = {
  id: number;
  brand: string;
  model: string;
  engineCapacityCc: number;
  price: number;
  purchaseCost: number;
  color: string;
  imageUrl?: string | null;
  stockQuantity: number;
};

export type SaleExtra = {
  id?: number;
  kind: string;
  description: string;
  quantity: number;
  unitPrice: number;
  unitCost?: number;
  total?: number;
};

export type Sale = {
  id: number;
  motorcycleId: number;
  motorcycle?: string | Motorcycle | null;
  customerId?: number | null;
  customerName: string;
  customerPhone?: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  unitCostAtSale?: number;
  extrasTotal?: number;
  extras?: SaleExtra[];
  saleDate: string;
  isCancelled: boolean;
  cancelledAt?: string | null;
  dealerId?: number | null;
  status?: string;
  channel?: string;
  paymentMethod?: string;
  cashAmount?: number;
  cardAmount?: number;
  cardInstallments?: number;
  paidAmount?: number;
  invoiceNo?: string | null;
  dueDate?: string | null;
  installmentCount?: number;
  installments?: { id: number; sequence: number; dueDate: string; amount: number }[];
};

export type Part = {
  id: number;
  code: string;
  name: string;
  stockQuantity: number;
  purchaseCost: number;
  salePrice: number;
  isActive: boolean;
};

export type ServiceOrderItem = {
  id?: number;
  kind: string;
  description: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  partId?: number | null;
  total?: number;
};

export type ServiceOrder = {
  id: number;
  orderNo: string;
  status: string;
  complaint?: string | null;
  diagnosis?: string | null;
  notes?: string | null;
  openedAt: string;
  dueDate?: string | null;
  invoicedAt?: string | null;
  invoiceNo?: string | null;
  totalLabor: number;
  totalParts: number;
  total: number;
  paidAmount: number;
  paymentMethod: string;
  customerId?: number | null;
  customer?: string | null;
  motorcycleId?: number | null;
  motorcycle?: string | null;
  items: ServiceOrderItem[];
  outstanding: number;
};

export type Dealer = {
  id: number;
  code: string;
  name: string;
  city: string;
  phone?: string | null;
  taxNumber?: string | null;
  address?: string | null;
  commissionPercent: number;
  creditLimit: number;
  isHeadquarters: boolean;
  isActive: boolean;
};

export type StockTransfer = {
  id: number;
  motorcycleId: number;
  motorcycle?: string | null;
  fromDealerId: number;
  fromDealer?: string | null;
  toDealerId: number;
  toDealer?: string | null;
  quantity: number;
  unitCost: number;
  transferType: string;
  status: string;
  note?: string | null;
  createdAt: string;
  shippedAt?: string | null;
  receivedAt?: string | null;
};

export type Payment = {
  id: number;
  paymentDate: string;
  direction: string;
  method: string;
  amount: number;
  saleId?: number | null;
  serviceOrderId?: number | null;
  dealerId?: number | null;
  customerId?: number | null;
  counterparty?: string | null;
  note?: string | null;
};

export type Customer = {
  id: number;
  fullName: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  creditLimit: number;
};

export async function api(path: string, init: RequestInit = {}) {
  const token = localStorage.getItem("mca_token");
  const headers = new Headers(init.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (response.status === 401 && token) {
    localStorage.removeItem("mca_token");
    window.location.reload();
  }
  return response;
}

export const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function errorText(response: Response, fallback: string) {
  try {
    const text = (await response.text()).trim();
    if (!text) return fallback;
    try {
      const parsed = JSON.parse(text);
      return parsed.detail || parsed.title || parsed.message || text;
    } catch {
      return text.replace(/^"|"$/g, "");
    }
  } catch {
    return fallback;
  }
}

export const money = (n: number) =>
  n.toLocaleString("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 });

export const compactMoney = (n: number) =>
  n.toLocaleString("tr-TR", { notation: "compact", maximumFractionDigits: 1 });

export const fmtDate = (v: string | Date) => new Date(v).toLocaleDateString("tr-TR");
export const fmtDateTime = (v: string | Date) =>
  new Date(v).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });

export function dateKey(value: string | Date) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function saleName(sale: Sale, motorcycles: Motorcycle[]) {
  if (typeof sale.motorcycle === "string") return sale.motorcycle;
  if (sale.motorcycle && typeof sale.motorcycle === "object")
    return `${sale.motorcycle.brand} ${sale.motorcycle.model}`;
  const m = motorcycles.find((x) => x.id === sale.motorcycleId);
  return m ? `${m.brand} ${m.model}` : `Motosiklet #${sale.motorcycleId}`;
}

export const movementLabels: Record<string, string> = {
  OpeningStock: "Açılış stoğu",
  OpeningBalance: "Açılış bakiyesi",
  PurchaseIn: "Satın alma girişi",
  ManualIn: "Manuel giriş",
  ManualOut: "Manuel çıkış",
  SaleOut: "Satış çıkışı",
  SaleReturn: "Satış iptal iadesi",
  SaleAdjust: "Satış düzeltmesi",
  ReserveOut: "Rezervasyon",
  TransferOut: "Sevk çıkışı",
  TransferIn: "Sevk girişi",
};

export const transferLabels: Record<string, string> = {
  Draft: "Taslak",
  Shipped: "Yolda",
  Received: "Teslim alındı",
  Cancelled: "İptal",
};

export const saleStatusLabels: Record<string, string> = {
  Reserved: "Rezerve",
  Delivered: "Teslim / Faturalı",
  Cancelled: "İptal",
};

/** Türkçe Excel ile uyumlu CSV (UTF-8 BOM + noktalı virgül). */
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "\uFEFF" + rows.map((r) => r.map(escape).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const trLower = (s: string) => s.toLocaleLowerCase("tr-TR");
export const LOW_STOCK_LIMIT = 2;

/** Kartlarda kuruşsuz, kırılmayan kısa tutar gösterimi. */
export const moneyRound = (n: number) =>
  n.toLocaleString("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });
