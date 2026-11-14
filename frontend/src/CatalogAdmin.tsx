import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorText, jsonInit, money, type Motorcycle } from "./utils";

type Listing = { id:number; motorcycleId:number; publicDescription:string|null; imageUrls:string|null; isPublished:boolean; brand:string; model:string; price:number; stockQuantity:number; imageUrl?:string|null };
const parseImages = (raw:string|null) => {
  try { const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v.filter((x):x is string => typeof x === "string" && /^https?:\/\//i.test(x)) : []; }
  catch { return []; }
};

export default function CatalogAdmin({ motorcycles }: { motorcycles:Motorcycle[] }) {
  const [rows,setRows] = useState<Listing[]>([]);
  const [motorcycleId,setMotorcycleId] = useState("");
  const [description,setDescription] = useState("");
  const [imageText,setImageText] = useState("");
  const [published,setPublished] = useState(false);
  const [editing,setEditing] = useState<number|null>(null);
  const [search,setSearch] = useState("");
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState("");
  const load = useCallback(async()=>{ const r=await api("/catalog"); if(r.ok) setRows(await r.json()); else setNotice(await errorText(r,"Katalog listesi alınamadı.")); },[]);
  useEffect(()=>{ void load(); },[load]);
  const selected = motorcycles.find(m=>m.id===Number(motorcycleId));
  const filtered = useMemo(()=>rows.filter(x=>`${x.brand} ${x.model}`.toLocaleLowerCase("tr-TR").includes(search.toLocaleLowerCase("tr-TR"))),[rows,search]);
  function reset(){setEditing(null);setMotorcycleId("");setDescription("");setImageText("");setPublished(false);}
  function edit(row:Listing){setEditing(row.id);setMotorcycleId(String(row.motorcycleId));setDescription(row.publicDescription||"");setImageText((parseImages(row.imageUrls).length ? parseImages(row.imageUrls) : (row.imageUrl ? [row.imageUrl] : [])).join("\n"));setPublished(row.isPublished);window.scrollTo({top:0,behavior:"smooth"});}
  async function save(e:React.FormEvent){e.preventDefault();setNotice(""); if(!motorcycleId){setNotice("Önce bir motosiklet seç.");return;} const images=imageText.split(/\r?\n/).map(x=>x.trim()).filter(Boolean); if(images.some(x=>{try{const u=new URL(x);return !["http:","https:"].includes(u.protocol)}catch{return true}})){setNotice("Fotoğraf bağlantıları http:// veya https:// ile başlamalı.");return;}
    setBusy(true);try{const body={motorcycleId:Number(motorcycleId),publicDescription:description,imageUrls:JSON.stringify(images),isPublished:published};const r=await api(editing?`/catalog/${editing}`:"/catalog",jsonInit(editing?"PUT":"POST",body));if(!r.ok)throw new Error(await errorText(r,"Katalog kaydedilemedi."));setNotice(published?"Ürün kataloğa yayımlandı.":"Katalog kaydı kaydedildi.");reset();await load();}catch(e){setNotice(e instanceof Error?e.message:"İşlem başarısız.");}finally{setBusy(false);}}
  async function remove(id:number){if(!window.confirm("Bu katalog kaydını silmek istediğine emin misin? Motosiklet envanterden silinmez."))return;const r=await api(`/catalog/${id}`,{method:"DELETE"});if(r.ok){if(editing===id)reset();await load();}else setNotice(await errorText(r,"Kayıt silinemedi."));}
  return <div className="catalog-admin">
    <section className="panel"><div className="panel-head"><div><h2>{editing?"Katalog ürününü düzenle":"Kataloğa ürün ekle"}</h2><p className="panel-description">Envanterdeki motosikletleri seç, açıklama ve fotoğraf URL'lerini ekle, ardından herkese açık katalogda yayımla.</p></div><a className="btn btn-secondary" href="/catalog" target="_blank" rel="noreferrer">Müşteri kataloğunu aç ↗</a></div>
      <form className="form-grid catalog-form" onSubmit={e=>void save(e)}>
        <label className="field"><span>Motosiklet</span><select value={motorcycleId} onChange={e=>setMotorcycleId(e.target.value)} required><option value="">Envanterden model seç</option>{motorcycles.map(m=><option key={m.id} value={m.id}>{m.brand} {m.model} · {m.engineCapacityCc} cc</option>)}</select></label>
        <label className="field"><span>Ürün açıklaması</span><textarea rows={4} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Öne çıkan özellikler, garanti ve teslimat bilgileri…" /></label>
        <label className="field"><span>Fotoğraf URL'leri (her satıra bir bağlantı)</span><textarea rows={4} value={imageText} onChange={e=>setImageText(e.target.value)} placeholder="https://site.com/motosiklet-on.jpg\nhttps://site.com/motosiklet-yan.jpg" /><small>Doğrudan görsel bağlantısı kullan. JPG, PNG veya WebP olabilir.</small></label>
        {imageText.trim().split(/\r?\n/).filter(Boolean).length>0&&<div className="catalog-preview">{imageText.trim().split(/\r?\n/).filter(Boolean).slice(0,4).map((url,i)=><img key={`${url}-${i}`} src={url} alt={`Önizleme ${i+1}`} onError={e=>{e.currentTarget.style.opacity=".25";}} />)}</div>}
        <label className="check-row"><input type="checkbox" checked={published} onChange={e=>setPublished(e.target.checked)} /> <span>Ürünü müşterilerin görebileceği katalogda yayımla</span></label>
        {selected&&<div className="catalog-selected"><strong>{selected.brand} {selected.model}</strong><span>{selected.engineCapacityCc} cc · {money(selected.price)} · Stok: {selected.stockQuantity}</span></div>}
        {notice&&<div className="callout">{notice}</div>}
        <div className="panel-actions"><button className="btn btn-primary" disabled={busy}>{busy?"Kaydediliyor…":editing?"Değişiklikleri kaydet":"Kataloğa kaydet"}</button>{editing&&<button type="button" className="btn btn-secondary" onClick={reset}>Vazgeç</button>}</div>
      </form>
    </section>
    <section className="panel"><div className="panel-head"><div><h2>Katalog kayıtları</h2><p className="panel-description">Yayımlanan ürünler giriş yapmadan görüntülenebilir.</p></div><input className="catalog-search" placeholder="Model ara…" value={search} onChange={e=>setSearch(e.target.value)} /></div>
      <div className="catalog-admin-list">{filtered.map(row=>{const images=parseImages(row.imageUrls);return <article className="catalog-admin-row" key={row.id}><div className="catalog-admin-thumb">{images[0]||row.imageUrl?<img src={images[0]||row.imageUrl||""} alt="" />:<span>Görsel yok</span>}</div><div className="catalog-admin-info"><strong>{row.brand} {row.model}</strong><span>{money(row.price)} · Stok {row.stockQuantity}</span><small>{row.publicDescription||"Açıklama eklenmemiş"}</small></div><span className={`catalog-status ${row.isPublished?"is-live":"is-draft"}`}>{row.isPublished?"Yayında":"Taslak"}</span><div className="panel-actions"><button className="btn btn-secondary btn-small" onClick={()=>edit(row)}>Düzenle</button><button className="btn btn-danger btn-small" onClick={()=>void remove(row.id)}>Sil</button></div></article>})}{filtered.length===0&&<p className="empty-state">Henüz katalog kaydı yok. Yukarıdan envanterindeki bir modeli ekleyebilirsin.</p>}</div>
    </section>
  </div>;
}
