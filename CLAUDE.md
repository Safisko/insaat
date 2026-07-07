# CLAUDE.md — Soylu İnşaat Muhasebe (V5)

Bu dosya, bu projede çalışacak bir Claude Code oturumu için bağlam sağlar. Proje sıfırdan burada, sohbet üzerinden geliştirildi; kod tabanı küçük ama iş mantığı yoğun. Değişiklik yapmadan önce bu dosyanın tamamını oku.

## Proje nedir

Soylu İnşaat adlı bir inşaat taahhüt firması için muhasebe/şantiye takip uygulaması. Firma sahibi (Safa Soylu, inşaat mühendisi), babası (40 yıllık usta) ve bir yardımcı (Nurettin Abi) tarafından günlük kullanılıyor. Önceden WhatsApp'tan yazışıp akşamları elle Excel'e işliyorlardı; bu onun yerine geçiyor.

**Kritik:** Bu gerçek bir şirketin gerçek parasal verilerini tutan canlı bir sistem. Test verisiyle deney yapılmıyor — kullanıcı doğrudan üretimde çalışıyor. Şema değişikliklerinde her zaman `alter table ... add column if not exists` gibi geriye dönük uyumlu, veri kaybettirmeyen yollar kullan; asla `drop table` veya veri silen migration yazma onay almadan.

## Teknoloji yığını (bilinçli tercih: tamamen ücretsiz)

- **Barındırma:** GitHub Pages (`safisko/insaat` deposu, `index.html` kökte)
- **Veritabanı + Auth:** Supabase ücretsiz katman (Postgres + Row Level Security + Auth)
- **Bot:** Telegram Bot API + Supabase Edge Function (Deno)
- **Yapay zekâ (mesaj çözümleme):** Google Gemini Flash ücretsiz API
- **Dosya depolama:** Supabase Storage ücretsiz katman (fiş fotoğrafları)
- **Frontend:** Tek dosya `index.html` — framework yok, build adımı yok. Vanilla JS + `supabase-js` (CDN) + SheetJS (Excel) + jsPDF (PDF). Bilinçli tercih: kullanıcı GitHub web arayüzünden düzenleyip commit'liyor, npm/build zinciri onun için pratik değil.

**Önemli mimari not:** Firebase değil Supabase kullanılıyor — kullanıcı özellikle kartsız/tamamen ücretsiz kalmak istediği için Firebase Blaze planından kaçınıldı (bkz. `birlesik-proje-raporu.md`).

## Dosya haritası

- `index.html` — **Ana uygulama.** Tek dosya, ~1200 satır, hepsi `<script>` içinde vanilla JS. CONFIG bölümü en üstte (SUPABASE_URL + SUPABASE_ANON_KEY — anon/publishable key, tarayıcıda görünmesi güvenli, gerçek koruma RLS'de).
- `schema.sql` — İlk kurulum şeması (V4). Tüm temel tablolar + RLS + `create_company`/`join_company` RPC'leri.
- `surum1-migration.sql` — V5 için eklenen migration: puantajda kesir (yarım gün), `suppliers`/`supplier_tx` (malzemeci carisi), `payment_method`/`photo_url` kolonları, `fisler` storage bucket'ı. **Bu ikisi (schema.sql + surum1-migration.sql) sırayla çalıştırılmalı, tek başına surum1 yetmez.**
- `add-telegram-session.sql` — Telegram botunun çok adımlı soru-cevap durumunu tutan `telegram_session` tablosu.
- `telegram-webhook.ts` — Supabase Edge Function. Telegram mesajlarını Gemini ile çözüp onay butonlarıyla (inline keyboard) veritabanına yazar. **Henüz Sürüm 1'deki yeni tablolara (suppliers vb.) göre güncellenmedi — bu Sürüm 2'nin işi.**
- `keepalive.yml` — GitHub Actions: Supabase'in 7 gün uykuya yatmasını önleyen günlük ping.
- `KURULUM-REHBERI.md`, `TELEFONDAN-KURULUM.md` — kullanıcı için adım adım kurulum rehberleri (masaüstü ve telefon).
- `V5-GELISTIRME-RAPORU.md` — **Onaylanmış geliştirme yol haritası, 3 sürüme bölünmüş.** Sürüm 1 uygulama tarafı büyük ölçüde tamamlandı, bu dosya kalan işlerin tek doğru kaynağı.
- `birlesik-proje-raporu.md` — Firebase→Supabase kararının gerekçesi, ilk mimari tartışma.

## Veri modeli — önemli kurallar

**Proje ve Müşteri İlişkisi:** Projeler, `projects.customer_id` (Foreign Key) ile `customers` tablosuna bağlıdır. Ön yüzde projeler oluşturulurken/düzenlenirken müşteri bir açılır kutudan seçilir. Geriye dönük uyumluluk için `projects.customer` (text) alanı da seçilen müşterinin adıyla otomatik güncellenir. Müşteriler sayfasında ve Detay ekranında hem Hakediş/Fatura bakiyesi (`cari_tx` hakedişleri ile tahsilatları) hem de Harcama/Maliyet bakiyesi (projeye ait tüm puantaj, gider, taşeron ve malzemeci borçları ile yapılan tahsilatlar) hesaplanarak gösterilir.

Çok kiracılı (multi-tenant): her tablo `company_id` taşır, RLS ile `profiles.company_id = auth.uid()'in şirketi` kısıtı var. **Her yeni tabloda bu paterni kopyala, aksi halde bir şirket başka şirketin verisini görür.**

**İşaret kuralı (cari hesap):** `cari_tx.direction`: `hakedis` (+, müşteri bize borçlanır/gelir) / `tahsilat` (−, müşteri borcu azalır). `supplier_tx.direction`: `borc` (+, biz malzemeciye borçlanırız) / `odeme` (−, borcumuz azalır). Worker tarafında brüt/net hesabı artık **tek bir ortak fonksiyonda** toplandı: `workerNet(worker, attRows, advRows, payRows, mode)` (`index.html`, PANEL bölümünden hemen önce tanımlı). `mode="month"`: maaşlı işçide brüt = `monthly_salary` (ay bazlı ekranlar — İşçiler sayfası ay seçiliyken, Raporlar hakediş). `mode="all"`: maaşlı işçide brüt bilinmez → `null` (UI'da "—"), net = -(avans+ödeme) (Panel'in "İşçilere Borç"u, İşçiler sayfası "Tüm Zamanlar" seçiliyken, işçi kapanış hesabı, Raporlar→İşçi Cari Dökümü). **Bu fonksiyonu değiştirirken Panel, İşçiler ve Raporlar'ın hepsinin aynı sonucu vermeye devam ettiğini doğrula** — aynı koda bağlı oldukları için bir yerdeki hata otomatik olarak her yere yayılır.

**Puantaj (attendance):** `fraction` sütunu (1 / 0.5 / 1.5). Bir işçi aynı güne **birden fazla projede** kayıt girebilir (`unique(worker_id, work_date, project_id)` kısıtı — aynı gün+aynı işçi+aynı proje tekrar edemez, ama farklı proje olabilir). Bir günün toplam `fraction`'ı 1.5'i geçemez — bu kontrol veritabanında değil, **sadece JS tarafında** (`addAtt` fonksiyonu, `index.html`). İleride bunu bir DB trigger'ına taşımak daha sağlam olur.

**Proje kâr/zarar:** Gelir (`cari_tx.hakedis`) − işçilik (`attendance.wage_amount`) − gider (`expenses`) − taşeron (`sub_tx.hakedis`) − malzemeci (`supplier_tx.borc`), hepsi `project_id` ile filtrelenip toplanıyor. `renderProjeler` ve rapor fonksiyonlarında bu hesap **iki yerde ayrı ayrı** yazılı (kod tekrarı var, teknik borç — ileride ortak bir fonksiyona çıkarılabilir).

## Bilinen açık konular / henüz çözülmemiş

1. ~~Panel'deki "İşçilere Borç" ile İşçiler sayfasındaki toplam arasındaki tutarsızlık~~ **ÇÖZÜLDÜ.** Kök neden ikiydi: (a) Panel tüm-zamanlar, İşçiler ise seçili ayı gösteriyordu — farklı zaman aralıkları karşılaştırılıyordu; (b) maaşlı işçiler için brüt hakediş hesabı yerlere göre tutarsızdı (Panel hiç saymıyordu, İşçiler aylık maaşı sayıyordu, kapanış hesabı 0 kabul ediyordu). Ortak `workerNet(worker, attRows, advRows, payRows, mode)` fonksiyonu eklenerek Panel, İşçiler ve Raporlar aynı mantığı kullanacak şekilde birleştirildi.
2. ~~"Tüm Zamanlar" görünümü İşçiler sayfasına henüz eklenmedi~~ **YAPILDI** — `wMonth` seçicisine "Tüm Zamanlar" seçeneği eklendi.
3. ~~Panel grafiğindeki "Gider+İşçilik" etiketi kafa karıştırıcı~~ **YAPILDI** — grafik artık Gider / İşçilik / Tahsilat olarak 3 ayrı çubuk gösteriyor.
4. **Maaşlı işçi için "tüm zamanlar brüt hakediş" hesaplanmıyor (bilinçli karar).** Aylık maaş tekrarlayan bir yükümlülük olduğundan ve işe başlama tarihi şemada tutulmadığından, "tüm zamanlar" modunda maaşlı işçi brüt sütunu "—" gösterilir; net = -(avans+ödeme toplamı). Bu, "işçiye borcumuz" değil "bugüne kadar verdiğimiz avans/ödeme" gibi okunmalı. Aynı kısıt yeni "İşçi Cari Dökümü" raporunda da geçerli.
5. **Maaşlı işçinin maaşı proje kâr/zarar hesabına (`renderProjeler`, `renderRaporlar→projeKZ`, yeni "Proje/Müşteri Cari Dökümü") hâlâ yansımıyor** — bilinçli olarak ertelendi. İleride: ya işçiye proje bazlı "aylık maaş dağıtımı" girişi eklenmeli ya da maaşlı işçi maliyeti ayrı bir gider kalemi olarak elle girilmeli.
6. **Yeni "Proje/Müşteri Cari Dökümü" raporu `cari_tx.direction==="hakedis"` (fatura/hakediş kesme) satırlarını göstermiyor**, sadece `tahsilat` (gerçek nakit girişi) — bilinçli bir tasarım kararı (kullanıcının verdiği örnek Excel formatı da bu şekildeydi). Kullanıcı hakediş kesimlerinin de görünmesini isterse `projeCari()` fonksiyonuna (`index.html`, `renderRaporlar` içinde) küçük bir ekleme yeterli.
7. **Raporlar sayfasındaki yeni "İşçi Cari Dökümü" / "Proje/Müşteri Cari Dökümü" Excel çıktıları renksizdir** — SheetJS'in ücretsiz `xlsx.full.min.js` derlemesi hücre renklendirmeyi desteklemiyor. Sadece PDF çıktısında (jsPDF-autotable) negatif bakiye kırmızı gösteriliyor.
8. ~~Geçmiş Takvimi'nde güncel ay hiç görünmüyordu, girilen puantaj yeşile boyanmıyordu~~ **ÇÖZÜLDÜ.** Kök neden: `today()`/`monthOptions()`/`monthRange()` (ve Panel'in 6 aylık trendi, "dün girilmeyenler" uyarısı) `new Date(...).toISOString()` ile yerel gece yarısını UTC'ye çevirirken pozitif UTC ofsetli (Türkiye, UTC+3) saat dilimlerinde bir gün/ay geriye kayıyordu. Yeni `localKey(d)` yardımcı fonksiyonu (yerel `getFullYear/getMonth/getDate` kullanıyor, `toISOString` kullanmıyor) tüm bu yerlerde kullanılacak şekilde birleştirildi.
9. ~~Puantaj kaydını düzeltmek için düzenleme yolu yoktu, sadece silme vardı~~ **ÇÖZÜLDÜ.** Günlük Giriş ve Geçmiş Takvimi'ne ✎ (düzenle) butonu eklendi — `editAtt()` fonksiyonu proje/gün kesrini günceller, 1,5 gün üst sınırı ve tekil proje kısıtı düzenlemede de kontrol edilir.
10. ~~İşçi/Müşteri/Malzemeci/Taşeron sayfalarında tekil işlem kaydını (avans, tahsilat, alım, taşeron hakedişi vb.) görüp düzenleme/silme yolu yoktu, Excel'e bakmadan hangi tarihte ne girildiğini bulmak mümkün değildi~~ **ÇÖZÜLDÜ.** Her varlık satırına "📄 Detay" butonu eklendi — `showDetay(type, id, backTo)` çağrılıp sözde-sayfa `page-detay` açılıyor, `renderDetay()` o kayda ait TÜM geçmiş hareketleri kronolojik + koşan bakiyeli tek tabloda gösteriyor, her satır ayrı düzenlenip silinebiliyor. 4 loader: `detayIsci`, `detayMusteri`, `detayMalzemeci`, `detayTaseron` (son ikisinde satır bazlı düzenleme öncesinde hiç yoktu). Yeni edit fonksiyonları: `editAvansOdeme`, `editCariTx`, `editSubTx`; `editAtt` globale taşındı; `alimForm`/`odeForm` globale taşınıp genişletildi — malzemeci ödemelerinin "düzenlenemez" kısıtı kalktı. Cari/Malzemeci'deki eski `slice(0,6)`/`slice(0,8)` inline önizlemeleri kaldırıldı (tek doğruluk kaynağı: Detay sekmesi).

## Yol haritası — V5-GELISTIRME-RAPORU.md'den özet

**Sürüm 1 (uygulama çekirdeği) — TAMAMLANDI:** puantaj v2 (proje+kesir), geçmiş puantaj takvimi, malzemeci carisi, fiş fotoğrafı, ödeme yöntemi, panel grafikleri, mükerrer uyarısı, işçi kapanış hesabı, tarih aralıklı raporlar, tam yedek, işçi "tüm zamanlar" görünümü, panel rakam doğrulaması/etiket netliği, koşan bakiyeli İşçi Cari ve Proje/Müşteri Cari dökümleri. Kalan bilinen sınırlamalar için "Bilinen açık konular" madde 4-7'ye bak.

**Sürüm 2 (Telegram zekâsı) — HENÜZ BAŞLANMADI:** yeni işçi akışında yevmiye sorma, yeni müşteri/tedarikçi akışı, onayda düzeltme butonu, tarih anlama ("dün", "3 Temmuz'da"), Telegram'dan toplu puantaj, Telegram'dan sorgu ("Mehmet ne kadar alacaklı?", "kartlarım", "bugün" özeti), Telegram'dan fiş fotoğrafı ekleme. `telegram-webhook.ts` bu sürümde `suppliers`/`supplier_tx` tablolarını da tanıyacak şekilde genişletilmeli.

**Sürüm 3 (finans merkezi) — HENÜZ BAŞLANMADI:** Sabit Ödemeler modülü (kredi kartları, ev kredisi, vergi — kişisel/şirket ayrımı, proje kâr/zararına asla karışmaz), kart kesim günü otomasyonu (bota özelden soru-cevap), Supabase cron ile zamanlanmış görevler (ay sonu özet, gecikme uyarıları). Kart hatırlatmaları **özel mesaj** olarak gelecek (gruba değil) — kullanıcı kararı.

## Kullanıcıyla çalışma tarzı (önemli)

Kullanıcı teknik değil ama meraklı ve titiz — kod değişikliklerini genelde GitHub'ın web düzenleyicisinden yapıştırarak uyguluyor (yerel geliştirme ortamı yok). Konsol/CLI kullanmıyor. Değişiklik teklif ederken:
- Küçük düzeltmeler için tam dosya yerine net "şu bloğu bul, bununla değiştir" talimatı işe yarıyordu.
- Büyük değişikliklerde (bu Sürüm 1 gibi) tüm `index.html`'i yeniden vermek ve "silip yapıştır" demek daha güvenilir oldu.
- Her SQL değişikliği **ayrı, küçük, `if not exists` korumalı** bir dosya olarak verildi ki mevcut veri bozulmasın.
- Kullanıcı önce büyük resmi (rapor/onay) görmek istiyor, sonra kodluyoruz — aceleye getirilmemeli.

Claude Code'da devam ederken bu tarzı koru: değişiklik yapmadan önce ne değişeceğini özetle, SQL migration'ları küçük ve tersine çevrilebilir tut, ve `V5-GELISTIRME-RAPORU.md`'deki sıralamaya sadık kal (kullanıcı onayı olmadan sürüm atlama).
