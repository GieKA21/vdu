// Webhook Fonnte: menggantikan app_wa.py + ngrok.
import { jawab, layanan } from "../_shared/inti.ts";

const j = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const kunci = Deno.env.get("WA_WEBHOOK_KUNCI");
  if (!kunci) return j({ status: "WA_WEBHOOK_KUNCI belum diatur" }, 503);
  if (new URL(req.url).searchParams.get("kunci") !== kunci) return j({ status: "ditolak" }, 401);
  if (req.method === "GET") return j({ status: "Webhook aktif dan siap!" });

  let data: Record<string, unknown> = {};
  try {
    data = (req.headers.get("content-type") ?? "").includes("json") ? await req.json() : Object.fromEntries(await req.formData());
  } catch { return j({ status: "diabaikan" }); }
  const pengirim = String(data.sender ?? ""), pesan = String(data.message ?? "").trim();
  if (!pengirim || !pesan) return j({ status: "diabaikan" });

  const tugas = (async () => {
    const jawaban = await jawab(layanan(), pesan.slice(0, 1000), "whatsapp");
    const r = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { Authorization: Deno.env.get("FONNTE_TOKEN") ?? "" },
      body: new URLSearchParams({ target: pengirim, message: jawaban }),
    });
    if (!r.ok) console.error("Fonnte", r.status);
  })();
  // Balas webhook segera; jawaban dikirim di latar belakang.
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(tugas); else await tugas;
  return j({ status: "sukses" });
});
