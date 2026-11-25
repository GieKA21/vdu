// Pengindeksan dokumen oleh admin: VDU untuk gambar, teks halaman untuk PDF.
import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { cors, embed, hitungF1, json, layanan, MODEL_CHAT, openai, pecahTeks, PROMPT_VDU } from "../_shared/inti.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { galat: "Metode tidak didukung." }, 405);

  const pengguna = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false },
  });
  const { data: { user } } = await pengguna.auth.getUser();
  if (user?.app_metadata?.role !== "admin") return json(req, { galat: "Khusus admin." }, 403);

  let b: { id?: string; halaman?: string[] } = {};
  try { b = await req.json(); } catch { /* isi tidak sah */ }
  if (!b.id) return json(req, { galat: "ID dokumen wajib diisi." }, 400);

  const db = layanan();
  const { data: dok } = await db.from("dokumen").select("*").eq("id", b.id).maybeSingle();
  if (!dok) return json(req, { galat: "Dokumen tidak ditemukan." }, 404);

  const gagal = async (catatan: string) => {
    await db.from("dokumen").update({ status_indeks: "gagal", catatan, diperbarui: new Date().toISOString() }).eq("id", dok.id);
    return json(req, { galat: catatan }, 422);
  };

  try {
    let ekstraksi = ""; let potongan: { teks: string; halaman: number | null }[] = [];
    if (dok.tipe === "gambar") {
      const { data: berkas, error } = await db.storage.from("dokumen").download(dok.berkas);
      if (error || !berkas) return await gagal("Berkas gambar tidak ditemukan di penyimpanan.");
      const url = `data:${berkas.type || "image/png"};base64,${encodeBase64(new Uint8Array(await berkas.arrayBuffer()))}`;
      const j = await (await openai("chat/completions", {
        model: MODEL_CHAT, max_tokens: 1500, temperature: 0,
        messages: [{ role: "user", content: [{ type: "text", text: PROMPT_VDU }, { type: "image_url", image_url: { url } }] }],
      })).json();
      ekstraksi = (j.choices?.[0]?.message?.content ?? "").trim();
      if (!ekstraksi) return await gagal("Ekstraksi VDU tidak menghasilkan teks.");
      potongan = pecahTeks(ekstraksi).map((teks) => ({ teks, halaman: null }));
    } else {
      const halaman = (b.halaman ?? []).map(String);
      halaman.forEach((t, i) => { for (const teks of pecahTeks(t)) potongan.push({ teks, halaman: i + 1 }); });
      ekstraksi = halaman.map((t, i) => `--- Halaman ${i + 1} ---\n${t.trim()}`).join("\n\n");
      if (!potongan.length) return await gagal("PDF tidak memuat teks yang dapat dibaca (kemungkinan hasil pindaian). Unggah halamannya sebagai gambar agar diproses oleh VDU.");
    }
    if (potongan.length > 400) return await gagal("Dokumen terlalu panjang untuk diindeks.");

    const vektor = await embed(potongan.map((p) => p.teks));
    await db.from("potongan").delete().eq("doc_id", dok.id);
    const { error: e2 } = await db.from("potongan").insert(potongan.map((p, i) => ({
      id: `${dok.id}::${String(i).padStart(3, "0")}`, doc_id: dok.id, urutan: i, halaman: p.halaman, teks: p.teks, embedding: JSON.stringify(vektor[i]),
    })));
    if (e2) return await gagal("Potongan teks gagal disimpan.");

    const akurasi_f1 = dok.tipe === "gambar" && dok.ground_truth ? hitungF1(ekstraksi, dok.ground_truth) : null;
    await db.from("dokumen").update({ ekstraksi, akurasi_f1, status_indeks: "terindeks", catatan: "", diperbarui: new Date().toISOString() }).eq("id", dok.id);
    return json(req, { id: dok.id, jumlah_potongan: potongan.length, akurasi_f1 });
  } catch (e) {
    return await gagal((e as Error).message || "Pengindeksan gagal.");
  }
});
