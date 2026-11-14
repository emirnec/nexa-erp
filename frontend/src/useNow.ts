import { useEffect, useState } from "react";

/**
 * Bileşen render'ı sırasında Date.now() çağırmadan, dakikada bir güncellenen
 * zaman değeri. İlk render'da 0 döner; efekt çalışınca gerçek zaman gelir.
 */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(0);

  useEffect(() => {
    setNow(Date.now());
    if (!intervalMs) return;
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}
