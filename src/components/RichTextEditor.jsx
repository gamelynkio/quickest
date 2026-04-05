import { useRef, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const COLORS = ["#000000", "#dc2626", "#2563a8", "#16a34a", "#ca8a04", "#7c3aed", "#64748b"];
const SIZES = ["14px", "16px", "18px", "20px", "24px", "28px", "32px"];

export default function RichTextEditor({ value, onChange, placeholder = "Text eingeben..." }) {
  const editorRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || "";
    }
  }, []);

  const exec = (cmd, val = null) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
    triggerChange();
  };

  const triggerChange = () => {
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };

  const uploadImage = async (file) => {
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `sections/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("test-media").upload(path, file, { upsert: true });
    if (!error) {
      const { data: { publicUrl } } = supabase.storage.from("test-media").getPublicUrl(path);
      exec("insertImage", publicUrl);
    }
    setUploading(false);
  };

  const insertVideo = () => {
    const url = prompt("YouTube oder Video-URL eingeben:");
    if (!url) return;
    let embedUrl = url;
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
    if (ytMatch) embedUrl = `https://www.youtube.com/embed/${ytMatch[1]}`;
    const html = `<div style="position:relative;padding-bottom:56.25%;height:0;margin:12px 0"><iframe src="${embedUrl}" style="position:absolute;top:0;left:0;width:100%;height:100%" frameborder="0" allowfullscreen></iframe></div>`;
    editorRef.current?.focus();
    document.execCommand("insertHTML", false, html);
    triggerChange();
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    if (html) {
      // Parse and clean HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      // Remove all style attributes and Office/Word specific elements
      doc.querySelectorAll("*").forEach(el => {
        el.removeAttribute("style");
        el.removeAttribute("class");
        el.removeAttribute("id");
        el.removeAttribute("width");
        el.removeAttribute("height");
      });
      // Remove Office XML tags
      const clean = doc.body.innerHTML
        .replace(/<o:[^>]*>.*?<\/o:[^>]*>/gi, "")
        .replace(/<w:[^>]*>.*?<\/w:[^>]*>/gi, "")
        .replace(/<m:[^>]*>.*?<\/m:[^>]*>/gi, "")
        .replace(/<!--.*?-->/gs, "");
      document.execCommand("insertHTML", false, clean);
    } else {
      document.execCommand("insertText", false, text);
    }
    triggerChange();
  };
    padding: "5px 8px", border: `1px solid ${active ? "#2563a8" : "#e2e8f0"}`,
    background: active ? "#eff6ff" : "#fff", borderRadius: "5px", cursor: "pointer",
    fontSize: "13px", color: active ? "#2563a8" : "#374151", fontWeight: active ? 700 : 400,
  });

  return (
    <div style={{ border: "2px solid #e5e7eb", borderRadius: "10px", overflow: "hidden", maxWidth: "100%" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", padding: "8px 10px", background: "#f8fafc", borderBottom: "1px solid #e5e7eb", alignItems: "center" }}>
        {/* Text style */}
        <button style={BtnStyle()} onClick={() => exec("bold")} title="Fett"><strong>B</strong></button>
        <button style={BtnStyle()} onClick={() => exec("italic")} title="Kursiv"><em>I</em></button>
        <button style={BtnStyle()} onClick={() => exec("underline")} title="Unterstrichen"><u>U</u></button>
        <div style={{ width: "1px", height: "24px", background: "#e2e8f0", margin: "0 2px" }} />

        {/* Font size */}
        <select onChange={e => exec("fontSize", e.target.value)} defaultValue=""
          style={{ padding: "4px 6px", border: "1px solid #e2e8f0", borderRadius: "5px", fontSize: "12px", cursor: "pointer", background: "#fff" }}>
          <option value="" disabled>Größe</option>
          {[1,2,3,4,5,6,7].map((s, i) => <option key={s} value={s}>{SIZES[i]}</option>)}
        </select>

        {/* Color */}
        <div style={{ display: "flex", gap: "3px", alignItems: "center" }}>
          {COLORS.map(c => (
            <button key={c} onClick={() => exec("foreColor", c)}
              style={{ width: "18px", height: "18px", background: c, border: "1px solid #e2e8f0", borderRadius: "3px", cursor: "pointer", padding: 0 }} />
          ))}
        </div>
        <div style={{ width: "1px", height: "24px", background: "#e2e8f0", margin: "0 2px" }} />

        {/* Alignment */}
        <button style={BtnStyle()} onClick={() => exec("justifyLeft")} title="Links">⬅</button>
        <button style={BtnStyle()} onClick={() => exec("justifyCenter")} title="Mitte">↔</button>
        <button style={BtnStyle()} onClick={() => exec("justifyRight")} title="Rechts">➡</button>
        <div style={{ width: "1px", height: "24px", background: "#e2e8f0", margin: "0 2px" }} />

        {/* Lists */}
        <button style={BtnStyle()} onClick={() => exec("insertUnorderedList")} title="Aufzählung">• Liste</button>
        <button style={BtnStyle()} onClick={() => exec("insertOrderedList")} title="Nummeriert">1. Liste</button>
        <div style={{ width: "1px", height: "24px", background: "#e2e8f0", margin: "0 2px" }} />

        {/* Media */}
        <button style={BtnStyle()} onClick={() => fileInputRef.current?.click()} title="Bild hochladen" disabled={uploading}>
          {uploading ? "⏳" : "🖼 Bild"}
        </button>
        <button style={BtnStyle()} onClick={insertVideo} title="Video einbetten">🎬 Video</button>
        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }}
          onChange={e => { if (e.target.files[0]) uploadImage(e.target.files[0]); e.target.value = ""; }} />
      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={triggerChange}
        onPaste={handlePaste}
        data-placeholder={placeholder}
        style={{
          minHeight: "140px", padding: "14px 16px", fontSize: "15px", lineHeight: 1.7,
          outline: "none", color: "#1e293b", background: "#fff",
          wordBreak: "break-word", overflowWrap: "break-word",
          maxWidth: "100%", boxSizing: "border-box",
        }}
      />

      <style>{`
        [contenteditable]:empty:before { content: attr(data-placeholder); color: #94a3b8; pointer-events: none; }
        [contenteditable] img { max-width: 100%; height: auto; border-radius: 8px; margin: 8px 0; display: block; }
        [contenteditable] iframe { max-width: 100%; }
        [contenteditable] ul, [contenteditable] ol { padding-left: 24px; }
        [contenteditable] p, [contenteditable] div, [contenteditable] span { max-width: 100%; }
        [contenteditable] table { max-width: 100%; overflow-x: auto; display: block; }
      `}</style>
    </div>
  );
}
