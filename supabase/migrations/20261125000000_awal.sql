create extension if not exists vector with schema extensions;

create table public.dokumen (
  id text primary key,
  judul text not null,
  tipe text not null check (tipe in ('gambar', 'pdf')),
  berkas text not null,
  ekstraksi text,
  ground_truth text,
  akurasi_f1 numeric,
  status_indeks text not null default 'belum',
  catatan text not null default '',
  dibuat timestamptz not null default now(),
  diperbarui timestamptz not null default now()
);

create table public.potongan (
  id text primary key,
  doc_id text not null references public.dokumen (id) on delete cascade,
  urutan int not null,
  halaman int,
  teks text not null,
  embedding extensions.vector(1536) not null
);
create index potongan_doc_idx on public.potongan (doc_id, urutan);

create table public.log_kueri (
  id bigint generated always as identity primary key,
  waktu timestamptz not null default now(),
  kanal text not null,
  pertanyaan text not null,
  jawaban text not null default '',
  latensi_total_s numeric not null default 0,
  latensi_retrieval_s numeric not null default 0,
  latensi_generasi_s numeric not null default 0,
  galat boolean not null default false,
  hasil jsonb not null default '[]'
);
create index log_kueri_waktu_idx on public.log_kueri (waktu desc);

create table public.uji_kueri (
  no int primary key,
  kategori text not null,
  gaya_bahasa text not null,
  target_dokumen text not null,
  pertanyaan text not null,
  jawaban_ai text not null,
  rank_target int,
  latensi_detik numeric not null,
  status text not null
);

create or replace function public.adalah_admin() returns boolean
language sql stable
set search_path = ''
as $$ select coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin' $$;

alter table public.dokumen enable row level security;
alter table public.potongan enable row level security;
alter table public.log_kueri enable row level security;
alter table public.uji_kueri enable row level security;

create policy "admin kelola dokumen" on public.dokumen for all to authenticated
  using ((select public.adalah_admin())) with check ((select public.adalah_admin()));
create policy "admin baca potongan" on public.potongan for select to authenticated
  using ((select public.adalah_admin()));
create policy "admin baca log" on public.log_kueri for select to authenticated
  using ((select public.adalah_admin()));
create policy "admin hapus log" on public.log_kueri for delete to authenticated
  using ((select public.adalah_admin()));
create policy "admin baca uji" on public.uji_kueri for select to authenticated
  using ((select public.adalah_admin()));

-- Daftar judul dokumen rujukan untuk halaman publik, tanpa isi dokumen.
create view public.dokumen_publik with (security_invoker = off) as
  select d.id, d.judul, d.tipe, count(p.id)::int as jumlah_potongan
  from public.dokumen d left join public.potongan p on p.doc_id = d.id
  where d.status_indeks = 'terindeks'
  group by d.id;
grant select on public.dokumen_publik to anon, authenticated;

-- Pencarian kemiripan cosine; hanya dipanggil oleh edge function (service role).
create or replace function public.cari_potongan(kueri extensions.vector(1536), jumlah int default 6)
returns table (id text, doc_id text, judul text, tipe text, halaman int, teks text, jarak float)
language sql stable
set search_path = ''
as $$
  select p.id, p.doc_id, d.judul, d.tipe, p.halaman, p.teks,
         (p.embedding operator(extensions.<=>) kueri)::float as jarak
  from public.potongan p join public.dokumen d on d.id = p.doc_id
  order by p.embedding operator(extensions.<=>) kueri
  limit jumlah
$$;
revoke execute on function public.cari_potongan from public, anon, authenticated;
grant execute on function public.cari_potongan to service_role;

insert into storage.buckets (id, name, public) values ('dokumen', 'dokumen', false)
  on conflict (id) do nothing;
create policy "admin kelola berkas dokumen" on storage.objects for all to authenticated
  using (bucket_id = 'dokumen' and (select public.adalah_admin()))
  with check (bucket_id = 'dokumen' and (select public.adalah_admin()));
