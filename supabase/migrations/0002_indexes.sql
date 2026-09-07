-- ACM — Index (PRD §6.3) + kunci dedup harian

-- Index yang disebut PRD §6.3, untuk filter dashboard pada skala 1000+ unit.
create index if not exists idx_alerts_status_created  on public.alerts (status, created_at desc);
create index if not exists idx_alerts_source          on public.alerts (source_id);
create index if not exists idx_alerts_vhcid_type      on public.alerts (vhcid, alert_type, status);

-- Feed wall display selalu "alert terbaru lebih dulu".
create index if not exists idx_alerts_last_seen       on public.alerts (last_seen_at desc);

-- Filter cabang / project dari topbar, dan penegakan cabang_scope di RLS.
create index if not exists idx_alerts_cabang          on public.alerts (cabang, last_seen_at desc);
create index if not exists idx_alerts_project         on public.alerts (group_project, last_seen_at desc);

-- Heatmap: hanya baris yang punya koordinat.
create index if not exists idx_alerts_geo             on public.alerts (occurrence_date, alert_type)
  where lat is not null and long is not null;

-- Rollup harian & job pembersihan 90 hari.
create index if not exists idx_alerts_occurrence_date on public.alerts (occurrence_date);

create index if not exists idx_polling_logs_source    on public.polling_logs (source_id, executed_at desc);
create index if not exists idx_daily_summary_date     on public.alert_daily_summary (summary_date desc, alert_type);


-- ---------------------------------------------------------------
-- Kunci dedup harian (PRD §7.1)
-- ---------------------------------------------------------------
-- Aturannya: satu baris per (vhcid, alert_type) per hari SELAMA masih terbuka.
-- Kalau kejadian sebelumnya sudah closed, kejadian berikutnya membuat baris baru
-- meski di hari yang sama — karena itu predikatnya `status <> 'closed'`.
--
-- Dibuat sebagai UNIQUE INDEX, bukan sekadar index bantu, supaya endpoint polling
-- bisa memakai INSERT ... ON CONFLICT DO UPDATE. Ini penting: pola
-- "SELECT dulu, lalu INSERT kalau tidak ada" punya lubang balapan — dua polling
-- yang tumpang tindih (dan window kita memang sengaja tumpang tindih) bisa
-- sama-sama tidak menemukan baris lalu sama-sama menyisipkan. Dengan unique index,
-- database yang menjamin keunikannya, bukan urutan eksekusi aplikasi.
--
-- coalesce(vhcid, '') dipakai karena di Postgres dua NULL dianggap berbeda,
-- sehingga alert dari unit tak dikenal tidak akan pernah ter-dedup tanpa ini.
create unique index if not exists uq_alerts_dedup
  on public.alerts (coalesce(vhcid, ''), alert_type, occurrence_date)
  where status <> 'closed';
