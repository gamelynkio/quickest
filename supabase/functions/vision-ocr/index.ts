import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function ocrPdfBatch(
  pdfBase64: string,
  pages: number[],
  apiKey: string
): Promise<string[]> {
  const res = await fetch(
    `https://vision.googleapis.com/v1/files:annotate?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{
          inputConfig: { content: pdfBase64, mimeType: "application/pdf" },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          pages,
          imageContext: { languageHints: ["de", "en", "fr", "es"] }
        }]
      })
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(`Google Vision: ${data.error.message}`);
  const pageResponses = data.responses?.[0]?.responses || [];
  return pageResponses.map((r: any) => r.fullTextAnnotation?.text || "");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const GOOGLE_VISION_KEY = Deno.env.get("GOOGLE_CLOUD_VISION_API_KEY");
    if (!GOOGLE_VISION_KEY) throw new Error("GOOGLE_CLOUD_VISION_API_KEY nicht konfiguriert");

    const { imageBase64, mimeType } = await req.json();
    if (!imageBase64) throw new Error("Keine Datei übermittelt");

    let fullText = "";

    if (mimeType === "application/pdf") {
      // In 5er-Batches verarbeiten (Vision-Limit: max 5 Seiten pro Call)
      // Bis zu 60 Seiten = 12 Batches (reicht für 30 Schüler × 2 Seiten)
      const MAX_PAGES = 60;
      const BATCH_SIZE = 5;
      const allTexts: string[] = [];

      for (let start = 1; start <= MAX_PAGES; start += BATCH_SIZE) {
        const pages = Array.from(
          { length: BATCH_SIZE },
          (_, i) => start + i
        );
        try {
          const texts = await ocrPdfBatch(imageBase64, pages, GOOGLE_VISION_KEY);
          const hasContent = texts.some(t => t.trim().length > 10);
          if (!hasContent && start > 1) break; // Keine weiteren Seiten
          allTexts.push(...texts.filter(t => t.trim().length > 0));
          if (texts.length < BATCH_SIZE) break; // Letzte Seite erreicht
        } catch (e: any) {
          // Wenn Seite nicht existiert → fertig
          if (e.message.includes("page") || e.message.includes("Page")) break;
          throw e;
        }
      }

      fullText = allTexts.join("\n\n--- SEITENUMBRUCH ---\n\n");

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

    if (!fullText.trim()) throw new Error("Kein Text erkannt — bitte Scan-Qualität prüfen");

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
