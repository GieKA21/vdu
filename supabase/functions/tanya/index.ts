import { cari, catatLog, cors, type Hit, json, layanan, MODEL_CHAT, openai, PESAN_BASIS_KOSONG, pesanChat, terlaluSering } from "../_shared/inti.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { galat: "Metode tidak didukung." }, 405);
  if (terlaluSering(req)) return json(req, { galat: "Terlalu banyak pertanyaan. Coba lagi sebentar lagi." }, 429);

  let pertanyaan = "";
  try { pertanyaan = String((await req.json()).pertanyaan ?? "").trim(); } catch { /* isi tidak sah */ }
  if (!pertanyaan || pertanyaan.length > 1000) return json(req, { galat: "Pertanyaan kosong atau melebihi 1.000 karakter." }, 400);

  const db = layanan();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const kirim = (peristiwa: string, data: unknown) => ctrl.enqueue(enc.encode(`event: ${peristiwa}\ndata: ${JSON.stringify(data)}\n\n`));
      const t0 = performance.now();
      let hits: Hit[] = [], jawaban = "", galat = false, tRet = 0, tGen = 0;
      try {
        hits = await cari(db, pertanyaan);
        tRet = (performance.now() - t0) / 1000;
        kirim("sumber", hits);
        if (!hits.length) { jawaban = PESAN_BASIS_KOSONG; kirim("teks", jawaban); }
        else {
          const t1 = performance.now();
          const r = await openai("chat/completions", { model: MODEL_CHAT, temperature: 0.3, stream: true, messages: pesanChat(pertanyaan, hits) });
          const reader = r.body!.getReader(); const dec = new TextDecoder(); let buf = "";
          baca: for (;;) {
            const { value, done } = await reader.read(); if (done) break;
            buf += dec.decode(value, { stream: true }); let n;
            while ((n = buf.indexOf("\n")) >= 0) {
              const baris = buf.slice(0, n).trim(); buf = buf.slice(n + 1);
              if (!baris.startsWith("data:")) continue;
              const d = baris.slice(5).trim(); if (d === "[DONE]") break baca;
              try { const t = JSON.parse(d).choices?.[0]?.delta?.content; if (t) { jawaban += t; kirim("teks", t); } } catch { /* potongan tidak utuh */ }
            }
          }
          tGen = (performance.now() - t1) / 1000;
        }
      } catch (e) {
        galat = true; jawaban = (e as Error).message || "Terjadi gangguan.";
        kirim("galat", jawaban);
      }
      const total = (performance.now() - t0) / 1000;
      kirim("selesai", { latensi: { total, retrieval: tRet, generasi: tGen } });
      await catatLog(db, { kanal: "web", pertanyaan, jawaban, total, retrieval: tRet, generasi: tGen, galat, hits });
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { ...cors(req), "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
});
