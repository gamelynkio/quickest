import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const GOOGLE_VISION_KEY = Deno.env.get("GOOGLE_CLOUD_VISION_API_KEY");
    if (!GOOGLE_VISION_KEY) throw new Error("GOOGLE_CLOUD_VISION_API_KEY nicht konfiguriert");

    const { imageBase64, mimeType } = await req.json();
    if (!imageBase64) throw new Error("Keine Datei übermittelt");

    let fullText = "";

    if (mimeType === "application/pdf") {
      // PDF → files:annotate (unterstützt mehrseitige PDFs)
      // Seiten 1-30 anfordern — Vision gibt zurück was vorhanden ist
      const pages = Array.from({ length: 30 }, (_, i) => i + 1);

      const res = await fetch(
        `https://vision.googleapis.com/v1/files:annotate?key=${GOOGLE_VISION_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requests: [{
              inputConfig: {
                content: imageBase64,
                mimeType: "application/pdf"
              },
              features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
              pages,
              imageContext: { languageHints: ["de", "en", "fr", "es"] }
            }]
          })
        }
      );

      const data = await res.json();

      if (data.error) throw new Error(`Google Vision: ${data.error.message}`);

      // files:annotate hat verschachtelte Struktur:
      // responses[0].responses[] = eine Antwort pro Seite
      const pageResponses = data.responses?.[0]?.responses || [];
      const texts = pageResponses
        .map((r: any) => r.fullTextAnnotation?.text || "")
        .filter((t: string) => t.trim().length > 0);

      fullText = texts.join("\n\n--- SEITENUMBRUCH ---\n\n");

    } else {
      // Bild (JPG/PNG) → images:annotate
      const res = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requests: [{
              image: { content: imageBase64 },
              features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
              imageContext: { languageHints: ["de", "en", "fr", "es"] }
            }]
          })
        }
      );

      const data = await res.json();
      if (data.error) throw new Error(`Google Vision: ${data.error.message}`);
      if (data.responses?.[0]?.error) throw new Error(`Google Vision: ${data.responses[0].error.message}`);
      fullText = data.responses?.[0]?.fullTextAnnotation?.text || "";
    }

    if (!fullText.trim()) throw new Error("Kein Text erkannt");

    return new Response(JSON.stringify({ text: fullText }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
