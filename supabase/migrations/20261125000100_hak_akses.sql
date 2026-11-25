-- Proyek Supabase baru tidak lagi memberi hak tabel secara otomatis; RLS tetap membatasi baris.
grant select, insert, update, delete on public.dokumen, public.potongan, public.log_kueri, public.uji_kueri to service_role, authenticated;
grant usage, select on all sequences in schema public to service_role, authenticated;
grant execute on function public.adalah_admin() to authenticated, anon, service_role;
