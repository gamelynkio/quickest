import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import TeacherLayout from "../components/TeacherLayout";

const QUESTION_TYPES = [
  { id: "multiple_choice", label: "Multiple Choice", icon: "☑️" },
  { id: "true_false", label: "Wahr / Falsch", icon: "⚖️" },
  { id: "fill_blank", label: "Lückentext", icon: "✍️" },
  { id: "flashcard", label: "Karteikarte (A→B)", icon: "🃏" },
  { id: "open", label: "Offene Antwort (KI-Bewertung)", icon: "🤖" },
  { id: "assignment", label: "Zuordnungsaufgabe", icon: "🔗" },
];

const newQuestion = (type) => ({
  id: Date.now() + Math.random(),
  type, text: "", points: 1,
  options: type === "multiple_choice" ? ["", "", "", ""] : [],
  correctAnswer: null,
  cardFront: "",
  cardBack: "",
  pairs: type === "assignment" ? [{ left: "", right: "" }] : [],
  attachment: null,
});

export default function TestEditor({ navigate, onLogout, currentUser, editingTest }) {
  const [title, setTitle] = useState(editingTest?.title || "");
  const [description, setDescription] = useState(editingTest?.description || "");
  const [subject, setSubject] = useState(editingTest?.subject || "");
  const [timeLimit, setTimeLimit] = useState(editingTest?.time_limit ? Math.round(editingTest.time_limit / 60) : 20);
  const [antiCheat, setAntiCheat] = useState(editingTest?.anti_cheat || false);
  const [questions, setQuestions] = useState(editingTest?.question_data || []);
  const [gradingScale, setGradingScale] = useState(editingTest?.grading_scale?.length ? editingTest.grading_scale : [
    { grade: "1", minPercent: 87 }, { grade: "2", minPercent: 73 },
    { grade: "3", minPercent: 59 }, { grade: "4", minPercent: 45 },
    { grade: "5", minPercent: 18 }, { grade: "6", minPercent: 0 },
  ]);
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const addQuestion = (type) => { setQuestions(prev => [...prev, newQuestion(type)]); setShowTypeMenu(false); };
  const updateQuestion = (id, field, value) => setQuestions(prev => prev.map(q => q.id === id ? { ...q, [field]: value } : q));
  const removeQuestion = (id) => setQuestions(prev => prev.filter(q => q.id !== id));
  const moveQuestion = (index, dir) => {
    const next = [...questions]; const swap = index + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[index], next[swap]] = [next[swap], next[index]]; setQuestions(next);
  };

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    setImportError("");

    try {
      const ext = file.name.split(".").pop().toLowerCase();
      let contentBlocks = [];

      const PROMPT = `Analysiere diesen Test/diese Prüfungsarbeit und extrahiere alle Aufgaben. Gib das Ergebnis als reines JSON-Array zurück (keine Markdown-Backticks, kein Text drumherum). Jede Aufgabe hat folgende Felder:
- type: "multiple_choice" | "true_false" | "open" | "fill_blank" | "assignment" | "flashcard"
- text: Aufgabenstellung
- points: Punktzahl (Zahl, default 1)
- options: Array mit Antwortoptionen (nur bei multiple_choice, sonst [])
- correctAnswer: Index der richtigen Antwort (nur bei multiple_choice/true_false, sonst null)
- pairs: Array von {left, right} Objekten (nur bei assignment, sonst [])
- cardFront: Vorderseite (nur bei flashcard, sonst "")
- cardBack: Rückseite (nur bei flashcard, sonst "")
- solution: Musterlösung als Text (optional)
- partialPoints: []

Erkenne den Typ automatisch. Multiple Choice wenn Auswahloptionen (a/b/c) vorhanden. Wahr/Falsch bei solchen Fragen. Zuordnung bei Zuordnungsaufgaben. Karteikarte bei Vokabel-Paaren. Offene Antwort sonst.`;

      if (ext === "docx") {
        // Extract text from DOCX (it's a ZIP with XML inside)
        const arrayBuffer = await file.arrayBuffer();
        const JSZip = (await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm")).default;
        const zip = await JSZip.loadAsync(arrayBuffer);
        const xmlFile = zip.file("word/document.xml");
        if (!xmlFile) throw new Error("Ungültige DOCX-Datei");
        const xml = await xmlFile.async("string");
        // Extract plain text from XML by removing all tags
        const text = xml
          .replace(/<w:p[ >]/g, "\n<w:p ")
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/\n{3,}/g, "\n\n").trim();
        if (!text.trim()) throw new Error("Kein Text extrahiert");
        contentBlocks = [{ type: "text", text: `${PROMPT}\n\nInhalt der Datei:\n\n${text}` }];

      } else if (ext === "pdf" || ext === "jpg" || ext === "jpeg" || ext === "png" || ext === "webp") {
        const base64 = await new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => res(reader.result.split(",")[1]);
          reader.onerror = rej;
          reader.readAsDataURL(file);
        });
        const mediaType = ext === "pdf" ? "application/pdf" : `image/${ext === "jpg" ? "jpeg" : ext}`;
        contentBlocks = [
          ext === "pdf"
            ? { type: "document", source: { type: "base64", media_type: mediaType, data: base64 } }
            : { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: PROMPT }
        ];
      } else {
        throw new Error("Nicht unterstütztes Format");
      }

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          messages: [{ role: "user", content: contentBlocks }],
        }),
      });

      const data = await response.json();
      const text = data.content?.find(b => b.type === "text")?.text || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);

      if (!Array.isArray(parsed)) throw new Error("Kein Array erhalten");

      const importedQuestions = parsed.map(q => ({
        id: Date.now() + Math.random(),
        type: q.type || "open",
        text: q.text || "",
        points: Number(q.points) || 1,
        options: q.options || [],
        correctAnswer: q.correctAnswer ?? null,
        pairs: q.pairs || [],
        cardFront: q.cardFront || "",
        cardBack: q.cardBack || "",
        solution: q.solution || "",
        partialPoints: q.partialPoints || [],
        attachment: null,
      }));

      setQuestions(prev => [...prev, ...importedQuestions]);
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));

    } catch (err) {
      setImportError(`Fehler beim Importieren: ${err.message || "Bitte prüfe das Format der Datei."}`);
      console.error(err);
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  const totalPoints = questions.reduce((sum, q) => sum + Number(q.points || 0), 0);

  const handleSave = async () => {
    setSaving(true);
    const payload = {
      teacher_id: currentUser?.id,
      title: title || "Unbenannte Vorlage",
      description,
      subject,
      time_limit: timeLimit * 60,
      anti_cheat: antiCheat,
      question_data: questions,
      grading_scale: gradingScale,
    };
    if (editingTest?.id) {
      await supabase.from("templates").update(payload).eq("id", editingTest.id);
    } else {
      await supabase.from("templates").insert(payload);
    }
    setSaving(false); setSaved(true);
    setTimeout(() => { setSaved(false); navigate("library"); }, 1000);
  };

  const SUBJECTS = ["Mathematik", "Deutsch", "Englisch", "Sachkunde", "Geschichte", "Geographie", "Biologie", "Physik", "Chemie", "Musik", "Kunst", "Sport"];

  return (
    <TeacherLayout navigate={navigate} onLogout={onLogout} currentUser={currentUser} activePage="testEditor">
      <div style={{ padding: "32px", maxWidth: "860px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: 0 }}>{editingTest ? "Vorlage bearbeiten" : "Neue Vorlage erstellen"}</h1>
            <p style={{ color: "#64748b", fontSize: "14px", marginTop: "4px" }}><strong>{totalPoints} Punkte</strong> · {questions.length} Aufgaben</p>
          </div>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <label style={{
              padding: "10px 16px", background: importing ? "#f1f5f9" : "#f0f7ff",
              color: importing ? "#94a3b8" : "#2563a8", border: "1px solid #bfdbfe",
              borderRadius: "10px", fontWeight: 600, fontSize: "13px",
              cursor: importing ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: "6px"
            }}>
              {importing ? "⏳ Wird analysiert..." : "📄 Aus Datei importieren"}
              <input type="file" accept=".pdf,.docx,.jpg,.jpeg,.png,.webp" style={{ display: "none" }}
                onChange={handleImport} disabled={importing} />
            </label>
            <button onClick={handleSave} disabled={saving} style={{ padding: "10px 24px", background: saved ? "#16a34a" : "#2563a8", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "14px", cursor: saving ? "not-allowed" : "pointer", transition: "background 0.3s" }}>
              {saving ? "Wird gespeichert..." : saved ? "✓ Gespeichert!" : "Vorlage speichern"}
            </button>
          </div>
        </div>

        {importError && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px", padding: "12px 16px", marginBottom: "16px", fontSize: "13px", color: "#dc2626" }}>
            ⚠️ {importError}
          </div>
        )}

        {importing && (
          <div style={{ background: "#f0f7ff", border: "1px solid #bfdbfe", borderRadius: "10px", padding: "16px", marginBottom: "16px", fontSize: "13px", color: "#2563a8", textAlign: "center" }}>
            <div style={{ fontSize: "24px", marginBottom: "8px" }}>🤖</div>
            <strong>Claude analysiert die Datei...</strong>
            <div style={{ color: "#64748b", marginTop: "4px" }}>Aufgaben werden automatisch erkannt und hinzugefügt.</div>
          </div>
        )}

        <div style={{ background: "#fff", borderRadius: "16px", padding: "24px", border: "1px solid #e2e8f0", marginBottom: "20px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", marginBottom: "16px" }}>
            <div style={{ gridColumn: "span 2" }}>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>Titel *</label>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="z.B. Bruchrechnung – Grundlagen"
                style={{ width: "100%", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", fontFamily: "inherit" }} />
            </div>
            <div>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>Fach</label>
              <select value={subject} onChange={e => setSubject(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", fontFamily: "inherit", background: "#fff", boxSizing: "border-box" }}>
                <option value="">– Fach wählen –</option>
                {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", marginBottom: "16px" }}>
            <div style={{ gridColumn: "span 2" }}>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>Kurzbeschreibung</label>
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional"
                style={{ width: "100%", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", fontFamily: "inherit" }} />
            </div>
            <div>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>Standard-Zeit (Min.)</label>
              <input type="number" min={1} max={180} value={timeLimit} onChange={e => setTimeLimit(Number(e.target.value))}
                style={{ width: "100%", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", fontFamily: "inherit" }} />
            </div>
          </div>
          <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", marginBottom: "16px" }}>
            <input type="checkbox" checked={antiCheat} onChange={e => setAntiCheat(e.target.checked)} style={{ width: "16px", height: "16px", accentColor: "#2563a8" }} />
            🛡️ Anti-Cheat als Standard aktivieren
          </label>
          <details>
            <summary style={{ cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "#374151", userSelect: "none" }}>📊 Notenschlüssel anpassen</summary>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" }}>
              {gradingScale.map((g, i) => (
                <div key={i} style={{ background: "#f8fafc", borderRadius: "8px", padding: "8px 12px", border: "1px solid #e2e8f0", fontSize: "13px" }}>
                  <strong>Note {g.grade}</strong> ab <input type="number" value={g.minPercent}
                    onChange={e => { const u = [...gradingScale]; u[i].minPercent = Number(e.target.value); setGradingScale(u); }}
                    style={{ width: "48px", border: "none", background: "none", fontWeight: 700, fontSize: "13px", color: "#2563a8" }} />%
                </div>
              ))}
            </div>
          </details>
        </div>

        {questions.map((q, index) => (
          <div key={q.id} style={{ background: "#fff", borderRadius: "16px", padding: "22px", border: "1px solid #e2e8f0", marginBottom: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <button onClick={() => moveQuestion(index, -1)} disabled={index === 0} style={{ background: "none", border: "none", cursor: index === 0 ? "default" : "pointer", color: index === 0 ? "#e2e8f0" : "#94a3b8", fontSize: "12px", padding: 0 }}>▲</button>
                  <button onClick={() => moveQuestion(index, 1)} disabled={index === questions.length - 1} style={{ background: "none", border: "none", cursor: index === questions.length - 1 ? "default" : "pointer", color: index === questions.length - 1 ? "#e2e8f0" : "#94a3b8", fontSize: "12px", padding: 0 }}>▼</button>
                </div>
                <span style={{ background: "#2563a8", color: "#fff", borderRadius: "8px", padding: "3px 10px", fontSize: "13px", fontWeight: 700 }}>{index + 1}</span>
                <span style={{ fontSize: "13px", color: "#64748b" }}>{QUESTION_TYPES.find(t => t.id === q.type)?.icon} {QUESTION_TYPES.find(t => t.id === q.type)?.label}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <label style={{ fontSize: "13px", color: "#64748b" }}>Punkte:</label>
                <input type="number" value={q.points} min={0.5} step={0.5} onChange={e => updateQuestion(q.id, "points", e.target.value)}
                  style={{ width: "56px", padding: "5px 8px", border: "2px solid #e5e7eb", borderRadius: "7px", fontSize: "14px", fontWeight: 700, textAlign: "center" }} />
                <button onClick={() => removeQuestion(q.id)} style={{ background: "#fef2f2", border: "none", color: "#dc2626", borderRadius: "7px", padding: "5px 10px", cursor: "pointer" }}>✕</button>
              </div>
            </div>
            <textarea value={q.text} onChange={e => updateQuestion(q.id, "text", e.target.value)} placeholder="Aufgabenstellung eingeben..." rows={2}
              style={{ width: "100%", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }} />
            {q.type === "multiple_choice" && (
              <div style={{ marginTop: "12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                {q.options.map((opt, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input type="radio" name={`correct-${q.id}`} checked={q.correctAnswer === i} onChange={() => updateQuestion(q.id, "correctAnswer", i)} style={{ accentColor: "#2563a8" }} />
                    <input value={opt} onChange={e => { const opts = [...q.options]; opts[i] = e.target.value; updateQuestion(q.id, "options", opts); }} placeholder={`Antwort ${String.fromCharCode(65 + i)}`}
                      style={{ flex: 1, padding: "7px 10px", border: "1px solid #e5e7eb", borderRadius: "7px", fontSize: "13px", fontFamily: "inherit" }} />
                  </div>
                ))}
                <p style={{ gridColumn: "span 2", fontSize: "11px", color: "#94a3b8", margin: "2px 0 0" }}>○ Richtige Antwort markieren</p>
              </div>
            )}
            {q.type === "true_false" && (
              <div style={{ marginTop: "12px", display: "flex", gap: "10px" }}>
                {["Wahr", "Falsch"].map((opt, i) => (
                  <button key={i} onClick={() => updateQuestion(q.id, "correctAnswer", i)}
                    style={{ padding: "9px 24px", border: `2px solid ${q.correctAnswer === i ? "#2563a8" : "#e5e7eb"}`, borderRadius: "9px", background: q.correctAnswer === i ? "#2563a8" : "#fff", color: q.correctAnswer === i ? "#fff" : "#374151", fontWeight: 600, fontSize: "14px", cursor: "pointer", fontFamily: "inherit" }}>{opt}</button>
                ))}
              </div>
            )}
            {q.type === "open" && (
              <div style={{ marginTop: "10px", background: "#f0f7ff", borderRadius: "8px", padding: "10px 14px", fontSize: "13px", color: "#2563a8", border: "1px solid #bfdbfe" }}>
                🤖 Diese Aufgabe wird automatisch von der KI bewertet.
              </div>
            )}
            {q.type === "fill_blank" && (
              <div style={{ marginTop: "10px", fontSize: "13px", color: "#64748b" }}>
                Nutze <code style={{ background: "#f1f5f9", padding: "1px 5px", borderRadius: "4px" }}>[Lücke]</code> in der Aufgabenstellung.
              </div>
            )}
            {q.type === "flashcard" && (
              <div style={{ marginTop: "12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "5px" }}>🃏 A-Seite (Vorgabe für Schüler)</label>
                  <input value={q.cardFront || ""} onChange={e => updateQuestion(q.id, "cardFront", e.target.value)}
                    placeholder="z.B. der Hund"
                    style={{ width: "100%", padding: "9px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", fontFamily: "inherit" }} />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "5px" }}>✅ B-Seite (erwartete Antwort)</label>
                  <input value={q.cardBack || ""} onChange={e => updateQuestion(q.id, "cardBack", e.target.value)}
                    placeholder="z.B. the dog"
                    style={{ width: "100%", padding: "9px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", fontFamily: "inherit" }} />
                </div>
                <div style={{ gridColumn: "span 2", fontSize: "12px", color: "#94a3b8" }}>
                  Die Aufgabenstellung oben ist optional (z.B. „Übersetze ins Englische:"). Schüler sehen die A-Seite und tippen die B-Seite.
                </div>
              </div>
            )}
            {q.type === "assignment" && (
              <div style={{ marginTop: "12px" }}>
                {q.pairs.map((pair, i) => (
                  <div key={i} style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "6px" }}>
                    <input value={pair.left} placeholder={`Begriff ${i + 1}`} onChange={e => { const p = [...q.pairs]; p[i] = { ...p[i], left: e.target.value }; updateQuestion(q.id, "pairs", p); }}
                      style={{ flex: 1, padding: "7px 10px", border: "1px solid #e5e7eb", borderRadius: "7px", fontSize: "13px", fontFamily: "inherit" }} />
                    <span style={{ color: "#94a3b8" }}>→</span>
                    <input value={pair.right} placeholder={`Definition ${i + 1}`} onChange={e => { const p = [...q.pairs]; p[i] = { ...p[i], right: e.target.value }; updateQuestion(q.id, "pairs", p); }}
                      style={{ flex: 1, padding: "7px 10px", border: "1px solid #e5e7eb", borderRadius: "7px", fontSize: "13px", fontFamily: "inherit" }} />
                    {q.pairs.length > 1 && <button onClick={() => updateQuestion(q.id, "pairs", q.pairs.filter((_, pi) => pi !== i))} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: "16px" }}>✕</button>}
                  </div>
                ))}
                <button onClick={() => updateQuestion(q.id, "pairs", [...q.pairs, { left: "", right: "" }])} style={{ fontSize: "12px", color: "#2563a8", background: "none", border: "none", cursor: "pointer" }}>+ Paar hinzufügen</button>
              </div>
            )}
            <details style={{ marginTop: "12px" }}>
              <summary style={{ cursor: "pointer", fontSize: "12px", fontWeight: 600, color: "#64748b", userSelect: "none", padding: "6px 0" }}>
                📝 Lösung / Erwartungshorizont & Teilbepunktung
              </summary>
              <div style={{ marginTop: "10px", background: "#f8fafc", borderRadius: "10px", padding: "14px", border: "1px solid #e2e8f0" }}>
                <div style={{ marginBottom: "10px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "5px" }}>Musterlösung / Erwartete Antwort</label>
                  <textarea value={q.solution || ""} onChange={e => updateQuestion(q.id, "solution", e.target.value)}
                    placeholder="z.B. Der Schüler soll erklären, dass... Alternativ akzeptabel: ..."
                    rows={3}
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid #e5e7eb", borderRadius: "7px", fontSize: "13px", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>Teilbepunktung</label>
                  {(q.partialPoints || []).map((p, i) => (
                    <div key={i} style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "6px" }}>
                      <input type="number" value={p.points} min={0} max={q.points} step={0.5}
                        onChange={e => { const pp = [...(q.partialPoints || [])]; pp[i] = { ...pp[i], points: Number(e.target.value) }; updateQuestion(q.id, "partialPoints", pp); }}
                        style={{ width: "60px", padding: "6px 8px", border: "1px solid #e5e7eb", borderRadius: "6px", fontSize: "13px", textAlign: "center" }} />
                      <span style={{ fontSize: "12px", color: "#94a3b8" }}>Pkt. für:</span>
                      <input value={p.description} placeholder="z.B. Nennung des Begriffs"
                        onChange={e => { const pp = [...(q.partialPoints || [])]; pp[i] = { ...pp[i], description: e.target.value }; updateQuestion(q.id, "partialPoints", pp); }}
                        style={{ flex: 1, padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: "6px", fontSize: "13px", fontFamily: "inherit" }} />
                      <button onClick={() => updateQuestion(q.id, "partialPoints", (q.partialPoints || []).filter((_, pi) => pi !== i))}
                        style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: "16px" }}>✕</button>
                    </div>
                  ))}
                  <button onClick={() => updateQuestion(q.id, "partialPoints", [...(q.partialPoints || []), { points: 0.5, description: "" }])}
                    style={{ fontSize: "12px", color: "#2563a8", background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}>
                    + Teilpunkt hinzufügen
                  </button>
                </div>
              </div>
            </details>
            <div style={{ marginTop: "12px" }}>
              <label style={{ fontSize: "12px", color: "#94a3b8", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: "6px", padding: "5px 10px" }}>📎 Datei anhängen</span>
                <input type="file" accept="image/*,audio/*,video/*" style={{ display: "none" }} onChange={e => updateQuestion(q.id, "attachment", e.target.files[0]?.name)} />
                {q.attachment && <span style={{ fontSize: "12px", color: "#16a34a" }}>✓ {q.attachment}</span>}
              </label>
            </div>
          </div>
        ))}

        <div style={{ position: "relative" }}>
          <button onClick={() => setShowTypeMenu(m => !m)} style={{ width: "100%", padding: "14px", border: "2px dashed #cbd5e1", borderRadius: "14px", background: "#fff", color: "#2563a8", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}
            onMouseOver={e => e.currentTarget.style.borderColor = "#2563a8"}
            onMouseOut={e => e.currentTarget.style.borderColor = "#cbd5e1"}>
            + Aufgabe hinzufügen
          </button>
          {showTypeMenu && (
            <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, right: 0, background: "#fff", borderRadius: "14px", border: "1px solid #e2e8f0", boxShadow: "0 10px 40px rgba(0,0,0,0.12)", overflow: "hidden", zIndex: 10 }}>
              {QUESTION_TYPES.map(t => (
                <button key={t.id} onClick={() => addQuestion(t.id)} style={{ width: "100%", padding: "13px 20px", border: "none", background: "#fff", textAlign: "left", fontSize: "14px", cursor: "pointer", display: "flex", alignItems: "center", gap: "12px", borderBottom: "1px solid #f8fafc", fontFamily: "inherit" }}
                  onMouseOver={e => e.currentTarget.style.background = "#f0f7ff"}
                  onMouseOut={e => e.currentTarget.style.background = "#fff"}>
                  <span style={{ fontSize: "20px" }}>{t.icon}</span>
                  <div style={{ fontWeight: 600, color: "#0f172a" }}>{t.label}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </TeacherLayout>
  );
}
