import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Konvertiert eine PDF-Seite zu einem Bild via Google Vision PDF-Support
async function ocrPdfPage(pdfBase64: string, pageNum: number, apiKey: string): Promise<string> {
  const res = await fetch(
    `https://vision.googleapis.com/v1/files:annotate?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{
          inputConfig: {
            content: pdfBase64,
            mimeType: "application/pdf"
          },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          pages: [pageNum],
          imageContext: {
            languageHints: ["de", "en", "fr", "es"]
          }
        }]
      })
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(`Google Vision PDF: ${data.error.message}`);
  return data.responses?.[0]?.fullTextAnnotation?.text || "";
}

// Erkennt Anzahl der Seiten aus PDF-Struktur
function getPdfPageCount(pdfBase64: string): number {
  try {
    const pdfBytes = atob(pdfBase64);
    const matches = pdfBytes.match(/\/Type\s*\/Page[^s]/g);
    return matches ? matches.length : 1;
  } catch {
    return 1;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const GOOGLE_VISION_KEY = Deno.env.get("GOOGLE_CLOUD_VISION_API_KEY");
    if (!GOOGLE_VISION_KEY) throw new Error("GOOGLE_CLOUD_VISION_API_KEY nicht konfiguriert");

    const body = await req.json();
    const { imageBase64, mimeType } = body;
    if (!imageBase64) throw new Error("Keine Datei übermittelt");

    let fullText = "";

    if (mimeType === "application/pdf") {
      // PDF direkt an Vision API — unterstützt mehrseitige PDFs
      const pageCount = Math.min(getPdfPageCount(imageBase64), 30);
      const texts: string[] = [];
      for (let i = 1; i <= pageCount; i++) {
        const pageText = await ocrPdfPage(imageBase64, i, GOOGLE_VISION_KEY);
        texts.push(pageText);
      }
      fullText = texts.join("\n\n--- SEITENUMBRUCH ---\n\n");
    } else {
      // Bild (JPG/PNG) direkt
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
