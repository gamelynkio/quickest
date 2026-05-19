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

    const { imageBase64 } = await req.json();
    if (!imageBase64) throw new Error("Kein Bild übermittelt");

    const visionRes = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [{
            image: { content: imageBase64 },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
            imageContext: {
              languageHints: ["de", "en", "fr", "es"]
            }
          }]
        })
      }
    );

    const data = await visionRes.json();
    if (data.error) throw new Error(`Google Vision: ${data.error.message}`);
    if (data.responses?.[0]?.error) throw new Error(`Google Vision: ${data.responses[0].error.message}`);

    const text = data.responses?.[0]?.fullTextAnnotation?.text || "";
    return new Response(JSON.stringify({ text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
