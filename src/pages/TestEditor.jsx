import { useState, useEffect, useRef } from "react";import { supabase } from "@/integrations/supabase/client";
import TeacherLayout from "../components/TeacherLayout";
import RichTextEditor from "../components/RichTextEditor";

const QUESTION_TYPES = [
  { id: "multiple_choice", label: "Multiple Choice", icon: "☑️" },
  { id: "true_false", label: "Wahr / Falsch", icon: "⚖️" },
  { id: "fill_blank", label: "Lückentext", icon: "✍️" },
  { id: "qa", label: "Frage – Antwort (KI-Bewertung)", icon: "💬" },
  { id: "assignment", label: "Zuordnungsaufgabe", icon: "🔗" },
];

// Sonderzeichen-Palette für Französisch/Spanisch
const SPECIAL_CHARS = {
  fr: { label: "🇫🇷 FR", chars: ["à","â","ä","æ","ç","é","è","ê","ë","î","ï","ô","œ","ù","û","ü","ÿ","À","Â","Ç","É","È","Ê","Î","Ô","Œ","Ù","Û","«","»"] },
  es: { label: "🇪🇸 ES", chars: ["á","é","í","ó","ú","ü","ñ","¿","¡","Á","É","Í","Ó","Ú","Ü","Ñ"] },
};

function SpecialCharBar({ inputRef, value, onChange }) {
  const [activeLang, setActiveLang] = useState(null);
  const insertChar = (char) => {
    if (inputRef?.current) {
      const el = inputRef.current;
      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? value.length;
      const newVal = value.slice(0, start) + char + value.slice(end);
      onChange(newVal);
      setTimeout(() => { el.focus(); el.setSelectionRange(start + char.length, start + char.length); }, 0);
    } else {
      onChange(value + char);
    }
  };
  if (!activeLang) return (
    <div style={{ display: "flex", gap: "4px", marginTop: "4px" }}>
      {Object.entries(SPECIAL_CHARS).map(([lang, { label }]) => (
        <button key={lang} type="button" onClick={() => setActiveLang(lang)}
          style={{ padding: "2px 8px", fontSize: "11px", background: "#f0f7ff", color: "#2563a8", border: "1px solid #bfdbfe", borderRadius: "5px", cursor: "pointer", fontFamily: "inherit" }}>
          {label}
        </button>
      ))}
    </div>
  );
  return (
    <div style={{ marginTop: "4px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "4px 6px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "3px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "10px", color: "#94a3b8", fontWeight: 600, marginRight: "2px" }}>{SPECIAL_CHARS[activeLang].label}:</span>
        {SPECIAL_CHARS[activeLang].chars.map((char, i) => (
          <button key={i} type="button" onClick={() => insertChar(char)}
            style={{ padding: "2px 5px", minWidth: "22px", fontSize: "13px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: "4px", cursor: "pointer", fontFamily: "inherit", lineHeight: 1.4 }}>
            {char}
          </button>
        ))}
        <button type="button" onClick={() => setActiveLang(activeLang === "fr" ? "es" : "fr")}
          style={{ padding: "2px 6px", fontSize: "10px", background: "#eff6ff", color: "#2563a8", border: "1px solid #bfdbfe", borderRadius: "4px", cursor: "pointer", marginLeft: "4px" }}>
          {activeLang === "fr" ? "🇪🇸 ES" : "🇫🇷 FR"}
        </button>
        <button type="button" onClick={() => setActiveLang(null)}
          style={{ padding: "2px 6px", fontSize: "10px", color: "#94a3b8", background: "none", border: "none", cursor: "pointer", marginLeft: "auto" }}>✕</button>
      </div>
    </div>
  );
}

const newQuestion = (type) => ({
  id: Date.now() + Math.random(),
  type, text: "", points: 1,
  options: type === "multiple_choice" ? ["", ""] : [],
  correctAnswer: null, correctAnswers: [],
  pairs: type === "assignment" ? [{ left: "", right: "" }] : [],
  solution: "", partialPoints: [], attachment: null,
});

const newTask = () => ({ id: Date.now() + Math.random(), taskTitle: "", taskInstruction: "", taskText: "", questions: [] });

const newTaskQuestion = (type) => ({
  id: Date.now() + Math.random(),
  type, text: "", points: 1,
  options: type === "multiple_choice" ? ["", ""] : [],
  correctAnswer: null, correctAnswers: [],
  pairs: type === "assignment" ? [{ left: "", right: "" }] : [],
  solution: "", partialPoints: [], blanks: [], fullText: "",
});

const newSection = () => ({
  id: Date.now() + Math.random(), type: "section",
  sectionTitle: "", sectionInstruction: "", sectionText: "",
  sectionMedia: null, sectionMediaType: null, tasks: [],
});

const suggestRubric = async (questionText, points, solution, supabaseUrl) => {
  const prompt = `Du bist ein erfahrener Schullehrer und erstellst einen Bewertungsmaßstab für die folgende offene Aufgabe.

Aufgabe: ${questionText}
${solution ? `Musterlösung/Hinweis: ${solution}` : ""}
Maximale Punktzahl: ${points}

Erstelle einen sinnvollen Bewertungsmaßstab mit Teilpunkten (in 0.5-Schritten, Summe = ${points} Punkte).
Typische Kriterien sind z.B.: korrekte Zeilenangabe, inhaltliche Richtigkeit, vollständigkeit, Fachbegriffe, Begründung.

Gib das Ergebnis NUR als JSON zurück, ohne Markdown oder Text drumherum:
{
  "solution": "<kurze Musterlösung oder Erwartungshorizont, 1-2 Sätze>",
  "partialPoints": [
    {"points": <Zahl>, "description": "<Kriterium>"},
    ...
  ]
}
Die Summe der partialPoints muss exakt ${points} ergeben.`;

  const response = await fetch(`${supabaseUrl}/functions/v1/anthropic-proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await response.json();
  const text = data.content?.map(b => b.text || "").join("") || "";
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
};

function TaskEditor({ task, tIdx, sectionId, onUpdate, onRemove, onAddQuestion, onUpdateQuestion, onRemoveQuestion }) {
  const [localTitle, setLocalTitle] = useState(task.taskTitle || "");
  const [localInstruction, setLocalInstruction] = useState(task.taskInstruction || "");
  const [localTaskText, setLocalTaskText] = useState(task.taskText || "");
  const titleRef = useRef(null);
  const localRef = useRef({});
  localRef.current = { localTitle, localInstruction, localTaskText };
  useEffect(() => { return () => { onUpdate("taskTitle", localRef.current.localTitle); onUpdate("taskInstruction", localRef.current.localInstruction); onUpdate("taskText", localRef.current.localTaskText); }; }, []);

  return (
    <div style={{ background: "rgba(0,0,0,0.25)", borderRadius: "12px", padding: "16px", marginBottom: "10px", border: "1px solid rgba(255,255,255,0.2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <span style={{ fontSize: "12px", fontWeight: 700, color: "rgba(255,255,255,0.9)", letterSpacing: "0.5px" }}>📋 AUFGABE {tIdx + 1}</span>
        <button onClick={onRemove} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "rgba(255,255,255,0.7)", borderRadius: "6px", padding: "3px 10px", cursor: "pointer", fontSize: "12px" }}>✕</button>
      </div>
      <div style={{ marginBottom: "10px" }}>
        <label style={{ fontSize: "11px", fontWeight: 600, color: "rgba(255,255,255,0.7)", display: "block", marginBottom: "4px" }}>Aufgabentitel (optional)</label>
        <input ref={titleRef} value={localTitle} onChange={e => setLocalTitle(e.target.value)} onBlur={() => onUpdate("taskTitle", localTitle)} placeholder="z.B. Right or wrong?"
          style={{ width: "100%", padding: "7px 10px", border: "1px solid rgba(255,255,255,0.25)", borderRadius: "7px", fontSize: "13px", boxSizing: "border-box", fontFamily: "inherit", background: "rgba(255,255,255,0.08)", color: "#fff" }} />
        <SpecialCharBar inputRef={titleRef} value={localTitle} onChange={val => { setLocalTitle(val); onUpdate("taskTitle", val); }} />
      </div>
      <div style={{ marginBottom: "10px" }}>
        <label style={{ fontSize: "11px", fontWeight: 600, color: "rgba(255,255,255,0.7)", display: "block", marginBottom: "4px" }}>📝 Beispieltext / Aufgabentext (optional)</label>
        <RichTextEditor value={localTaskText} onChange={val => { setLocalTaskText(val); onUpdate("taskText", val); }} placeholder="z.B. Beispielsatz, Erklärung oder Hinweis für diese Aufgabe..." />
      </div>
      {(task.questions || []).map((tq, tqIdx) => (
        <TaskQuestionEditor key={tq.id} tq={tq} tIdx={tIdx} tqIdx={tqIdx}
          onUpdate={(field, val) => onUpdateQuestion(tq.id, field, val)}
          onRemove={() => onRemoveQuestion(tq.id)} />
      ))}
      <div style={{ marginTop: "10px" }}>
        <div style={{ fontSize: "11px", fontWeight: 600, color: "rgba(255,255,255,0.5)", letterSpacing: "0.5px", marginBottom: "5px" }}>UNTERAUFGABE HINZUFÜGEN</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {QUESTION_TYPES.map(qt => (
            <button key={qt.id} onClick={() => onAddQuestion(qt.id)}
              style={{ padding: "5px 10px", background: "rgba(255,255,255,0.15)", color: "#fff", border: "1px solid rgba(255,255,255,0.25)", borderRadius: "6px", fontSize: "11px", cursor: "pointer", fontFamily: "inherit" }}>
              + {qt.icon} {qt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function TaskQuestionEditor({ tq, tIdx, tqIdx, onUpdate, onRemove }) {
  const [localText, setLocalText] = useState(tq.text || "");
  const [localSolution, setLocalSolution] = useState(tq.solution || "");
  const [localOptions, setLocalOptions] = useState(tq.options || []);
  const [correctAnswers, setCorrectAnswers] = useState(tq.correctAnswers || (tq.correctAnswer != null ? [tq.correctAnswer] : []));
  const [correctAnswer, setCorrectAnswer] = useState(tq.correctAnswer ?? null);
  const [localFullText, setLocalFullText] = useState(tq.fullText || "");
  const [localBlanks, setLocalBlanks] = useState(tq.blanks || []);
  const [localPoints, setLocalPoints] = useState(tq.points || 1);
  const [localPairs, setLocalPairs] = useState(tq.pairs?.length ? tq.pairs : [{ left: "", right: "" }]);
  const [localPartialPoints, setLocalPartialPoints] = useState(tq.partialPoints || []);
  const [suggestingRubric, setSuggestingRubric] = useState(false);
  const rubricDebounceRef = useRef(null);
  const textRef = useRef(null);
  const solutionRef = useRef(null);
  const fullTextRef = useRef(null);

  const localRef = useRef({});
  localRef.current = { localText, localSolution, localOptions, localFullText, localBlanks, localPoints, localPairs, localPartialPoints };
  useEffect(() => {
    return () => {
      const s = localRef.current;
      onUpdate("text", s.localText); onUpdate("solution", s.localSolution); onUpdate("options", s.localOptions);
      onUpdate("fullText", s.localFullText); onUpdate("blanks", s.localBlanks); onUpdate("points", s.localPoints);
      onUpdate("pairs", s.localPairs); onUpdate("partialPoints", s.localPartialPoints);
    };
  }, []);

  useEffect(() => {
    if (tq.type !== "qa" && tq.type !== "open") return;
    if (!localSolution.trim()) return;
    if (localPartialPoints.length > 0) return;
    clearTimeout(rubricDebounceRef.current);
    rubricDebounceRef.current = setTimeout(async () => {
      setSuggestingRubric(true);
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const result = await suggestRubric(localText || tq.text, localPoints, localSolution, supabaseUrl);
        if (result.partialPoints?.length) { setLocalPartialPoints(result.partialPoints); onUpdate("partialPoints", result.partialPoints); const sum = result.partialPoints.reduce((s, p) => s + Number(p.points || 0), 0); setLocalPoints(sum); onUpdate("points", sum); }
        if (result.solution && !localSolution) { setLocalSolution(result.solution); onUpdate("solution", result.solution); }
      } catch (e) {}
      setSuggestingRubric(false);
    }, 1500);
    return () => clearTimeout(rubricDebounceRef.current);
  }, [localSolution]);

  const isQaType = tq.type === "qa" || tq.type === "open";

  return (
    <div style={{ background: "rgba(255,255,255,0.95)", borderRadius: "8px", padding: "12px 14px", marginBottom: "6px", color: "#1e293b" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <span style={{ fontSize: "12px", fontWeight: 700, color: "#374151" }}>{tIdx + 1}.{tqIdx + 1} — {QUESTION_TYPES.find(t => t.id === tq.type)?.icon || "💬"} {QUESTION_TYPES.find(t => t.id === tq.type)?.label || "Frage – Antwort"}</span>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          {localPartialPoints.length > 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ width: "50px", padding: "3px 6px", border: "1px solid #bfdbfe", borderRadius: "5px", fontSize: "12px", textAlign: "center", background: "#eff6ff", color: "#2563a8", fontWeight: 700, display: "inline-block" }}>
                {localPartialPoints.reduce((s, p) => s + Number(p.points || 0), 0)}
              </span>
              <span style={{ fontSize: "11px", color: "#2563a8" }}>Pkt. (∑)</span>
            </div>
          ) : (
            <>
              <input type="number" min={0.5} step={0.5} value={localPoints}
                onChange={e => { setLocalPoints(Number(e.target.value)); onUpdate("points", Number(e.target.value)); }}
                style={{ width: "50px", padding: "3px 6px", border: "1px solid #e2e8f0", borderRadius: "5px", fontSize: "12px", textAlign: "center" }} />
              <span style={{ fontSize: "11px", color: "#94a3b8" }}>Pkt.</span>
            </>
          )}
          <button onClick={onRemove} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: "14px", padding: "0 4px" }}>×</button>
        </div>
      </div>

      {isQaType ? (
        <div style={{ marginBottom: "8px" }}>
          <label style={{ fontSize: "11px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "4px" }}>Frage / Aufgabenstellung</label>
          <RichTextEditor value={localText} onChange={val => { setLocalText(val); onUpdate("text", val); }} placeholder="Frage eingeben — Text formatieren, Bild oder Video einfügen..." />
        </div>
      ) : (
        <div style={{ marginBottom: "8px" }}>
          <input ref={textRef} value={localText} onChange={e => setLocalText(e.target.value)} onBlur={() => onUpdate("text", localText)}
            placeholder="Unteraufgabe / Frage eingeben..."
            style={{ width: "100%", padding: "7px 10px", border: "1px solid #e2e8f0", borderRadius: "7px", fontSize: "13px", fontFamily: "inherit", boxSizing: "border-box" }} />
          <SpecialCharBar inputRef={textRef} value={localText} onChange={val => { setLocalText(val); onUpdate("text", val); }} />
        </div>
      )}

      {tq.type === "multiple_choice" && (
        <div>
          {localOptions.map((opt, oi) => {
            const isCorrect = correctAnswers.includes(oi);
            return (
              <div key={oi} style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                <input type="checkbox" checked={isCorrect} onChange={() => { const next = isCorrect ? correctAnswers.filter(x => x !== oi) : [...correctAnswers, oi]; setCorrectAnswers(next); onUpdate("correctAnswers", next); }} style={{ accentColor: "#2563a8" }} />
                <input value={opt} onChange={e => { const opts = [...localOptions]; opts[oi] = e.target.value; setLocalOptions(opts); }} onBlur={() => onUpdate("options", localOptions)} placeholder={`Antwort ${String.fromCharCode(65 + oi)}`} style={{ flex: 1, padding: "5px 8px", border: "1px solid #e2e8f0", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit" }} />
                {localOptions.length > 2 && <button onClick={() => { const opts = localOptions.filter((_, j) => j !== oi); setLocalOptions(opts); onUpdate("options", opts); }} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer" }}>×</button>}
              </div>
            );
          })}
          <button onClick={() => { const opts = [...localOptions, ""]; setLocalOptions(opts); onUpdate("options", opts); }} style={{ fontSize: "11px", color: "#2563a8", background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: "2px" }}>+ Antwort</button>
        </div>
      )}

      {tq.type === "true_false" && (
        <div style={{ display: "flex", gap: "8px" }}>
          {["Wahr", "Falsch"].map((opt, oi) => (
            <button key={oi} onClick={() => { setCorrectAnswer(oi); onUpdate("correctAnswer", oi); }}
              style={{ padding: "5px 14px", border: `2px solid ${correctAnswer === oi ? "#2563a8" : "#e2e8f0"}`, borderRadius: "7px", background: correctAnswer === oi ? "#2563a8" : "#fff", color: correctAnswer === oi ? "#fff" : "#374151", fontWeight: 600, fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}>{opt}</button>
          ))}
        </div>
      )}

      {tq.type === "assignment" && (
        <div>
          {localPairs.map((pair, i) => (
            <div key={i} style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "5px" }}>
              <input value={pair.left} placeholder={`Begriff ${i + 1}`} onChange={e => { const p = [...localPairs]; p[i] = { ...p[i], left: e.target.value }; setLocalPairs(p); }} onBlur={() => onUpdate("pairs", localPairs)} style={{ flex: 1, padding: "5px 8px", border: "1px solid #e2e8f0", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit" }} />
              <span style={{ color: "#94a3b8", fontSize: "12px" }}>→</span>
              <input value={pair.right} placeholder={`Definition ${i + 1}`} onChange={e => { const p = [...localPairs]; p[i] = { ...p[i], right: e.target.value }; setLocalPairs(p); }} onBlur={() => onUpdate("pairs", localPairs)} style={{ flex: 1, padding: "5px 8px", border: "1px solid #e2e8f0", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit" }} />
              {localPairs.length > 1 && <button onClick={() => { const p = localPairs.filter((_, pi) => pi !== i); setLocalPairs(p); onUpdate("pairs", p); }} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: "14px" }}>✕</button>}
            </div>
          ))}
          <button onClick={() => { const p = [...localPairs, { left: "", right: "" }]; setLocalPairs(p); onUpdate("pairs", p); }} style={{ fontSize: "11px", color: "#2563a8", background: "none", border: "none", cursor: "pointer", padding: 0 }}>+ Paar hinzufügen</button>
        </div>
      )}

      {tq.type === "fill_blank" && (
        <div>
          <label style={{ fontSize: "11px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "4px" }}>Vollständiger Text — Wort markieren → wird zur Lücke</label>
          <textarea ref={fullTextRef} value={localFullText} onChange={e => setLocalFullText(e.target.value)} onBlur={() => onUpdate("fullText", localFullText)}
            onMouseUp={() => { const sel = window.getSelection(); const selected = sel?.toString().trim(); if (!selected || !localFullText) return; const start = localFullText.indexOf(selected); if (start === -1) return; const newText = localFullText.slice(0, start) + "[Lücke]" + localFullText.slice(start + selected.length); const newBlanks = [...localBlanks, { solution: selected, alternatives: [] }]; setLocalFullText(newText); setLocalBlanks(newBlanks); onUpdate("fullText", newText); onUpdate("blanks", newBlanks); onUpdate("text", newText); sel.removeAllRanges(); }}
            placeholder="Text eingeben, dann Wort markieren..." rows={3}
            style={{ width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: "6px", fontSize: "13px", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", marginBottom: "4px" }} />
          <SpecialCharBar inputRef={fullTextRef} value={localFullText} onChange={val => { setLocalFullText(val); onUpdate("fullText", val); onUpdate("text", val); }} />
          <div style={{ fontSize: "11px", color: "#94a3b8", marginBottom: "8px", marginTop: "2px" }}>💡 Text markieren → wird automatisch zur Lücke</div>
          {localBlanks.map((blank, bi) => (
            <div key={bi} style={{ background: "#f8fafc", borderRadius: "6px", padding: "8px 10px", marginBottom: "5px", border: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                <span style={{ background: "#2563a8", color: "#fff", borderRadius: "4px", padding: "1px 6px", fontSize: "11px", fontWeight: 700 }}>Lücke {bi + 1}</span>
                <input value={blank.solution} onChange={e => { const nb = [...localBlanks]; nb[bi] = { ...nb[bi], solution: e.target.value }; setLocalBlanks(nb); onUpdate("blanks", nb); }} placeholder="Lösung" style={{ flex: 1, padding: "4px 8px", border: "1px solid #e2e8f0", borderRadius: "5px", fontSize: "12px", fontFamily: "inherit" }} />
                <button onClick={() => { const nb = localBlanks.filter((_, i) => i !== bi); let count = 0; const newText = localFullText.replace(/\[Lücke\]/g, m => { count++; return count - 1 === bi ? blank.solution : m; }); setLocalBlanks(nb); setLocalFullText(newText); onUpdate("blanks", nb); onUpdate("fullText", newText); onUpdate("text", newText); }} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: "14px" }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isQaType && (
        <div style={{ marginTop: "10px", background: "#f0f7ff", borderRadius: "8px", padding: "10px", border: "1px solid #bfdbfe" }}>
          <div style={{ marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "11px", color: "#2563a8", fontWeight: 600 }}>
              📝 {suggestingRubric ? "⏳ KI erstellt Maßstab..." : localPartialPoints.length > 0 ? "✓ Bewertungsmaßstab hinterlegt" : "Musterlösung & Bewertungsmaßstab (KI-Bewertung)"}
            </span>
            {localPartialPoints.length > 0 && !suggestingRubric && (
              <button onClick={async () => {
                setSuggestingRubric(true);
                try {
                  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
                  const result = await suggestRubric(localText || tq.text, localPoints, localSolution, supabaseUrl);
                  if (result.partialPoints?.length) { setLocalPartialPoints(result.partialPoints); onUpdate("partialPoints", result.partialPoints); }
                  if (result.solution) { setLocalSolution(result.solution); onUpdate("solution", result.solution); }
                } catch (e) {}
                setSuggestingRubric(false);
              }} style={{ padding: "3px 8px", background: "none", color: "#2563a8", border: "1px solid #bfdbfe", borderRadius: "5px", fontSize: "10px", fontWeight: 600, cursor: "pointer" }}>
                🔄 Neu vorschlagen
              </button>
            )}
          </div>
          <textarea ref={solutionRef} value={localSolution} onChange={e => setLocalSolution(e.target.value)} onBlur={() => onUpdate("solution", localSolution)}
            placeholder="Musterlösung / Erwartungshorizont (wird von KI für Bewertung genutzt)..." rows={2}
            style={{ width: "100%", padding: "6px 10px", border: "1px solid #bfdbfe", borderRadius: "6px", fontSize: "12px", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box", marginBottom: "4px" }} />
          <SpecialCharBar inputRef={solutionRef} value={localSolution} onChange={val => { setLocalSolution(val); onUpdate("solution", val); }} />
          <div style={{ marginTop: "4px" }}>
          {localPartialPoints.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "5px" }}>
              <input type="number" value={p.points} min={0} step={0.5} onChange={e => { const pp = [...localPartialPoints]; pp[i] = { ...pp[i], points: Number(e.target.value) }; setLocalPartialPoints(pp); onUpdate("partialPoints", pp); const sum = pp.reduce((s, p) => s + Number(p.points || 0), 0); setLocalPoints(sum); onUpdate("points", sum); }} style={{ width: "50px", padding: "4px 6px", border: "1px solid #bfdbfe", borderRadius: "5px", fontSize: "12px", textAlign: "center" }} />
              <span style={{ fontSize: "11px", color: "#94a3b8" }}>Pkt. für:</span>
              <input value={p.description} placeholder="z.B. Nennung des Begriffs" onChange={e => { const pp = [...localPartialPoints]; pp[i] = { ...pp[i], description: e.target.value }; setLocalPartialPoints(pp); }} onBlur={() => onUpdate("partialPoints", localPartialPoints)} style={{ flex: 1, padding: "4px 8px", border: "1px solid #bfdbfe", borderRadius: "5px", fontSize: "12px", fontFamily: "inherit" }} />
              <button onClick={() => { const pp = localPartialPoints.filter((_, pi) => pi !== i); setLocalPartialPoints(pp); onUpdate("partialPoints", pp); const sum = pp.reduce((s, p) => s + Number(p.points || 0), 0); if (pp.length > 0) { setLocalPoints(sum); onUpdate("points", sum); } }} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: "14px" }}>✕</button>
            </div>
          ))}
          <button onClick={() => { const pp = [...localPartialPoints, { points: 0.5, description: "" }]; setLocalPartialPoints(pp); onUpdate("partialPoints", pp); const sum = pp.reduce((s, p) => s + Number(p.points || 0), 0); setLocalPoints(sum); onUpdate("points", sum); }} style={{ fontSize: "11px", color: "#2563a8", background: "none", border: "none", cursor: "pointer", padding: "2px 0" }}>+ Teilpunkt</button>
          </div>
        </div>
      )}

      {tq.type === "fill_blank" && localBlanks.length > 0 && (
        <div style={{ marginTop: "10px", background: "#f8fafc", borderRadius: "8px", padding: "10px", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", marginBottom: "8px" }}>✏️ Alternative Lösungen pro Lücke</div>
          {localBlanks.map((blank, bi) => (
            <div key={bi} style={{ marginBottom: "8px" }}>
              <div style={{ fontSize: "11px", color: "#374151", marginBottom: "3px" }}>
                <span style={{ background: "#2563a8", color: "#fff", borderRadius: "4px", padding: "1px 6px", fontSize: "10px", fontWeight: 700, marginRight: "6px" }}>Lücke {bi + 1}</span>
                Hauptlösung: <strong>{blank.solution || "–"}</strong>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", alignItems: "center" }}>
                {(blank.alternatives || []).map((alt, ai) => (
                  <span key={ai} style={{ background: "#e0f2fe", borderRadius: "4px", padding: "2px 7px", fontSize: "11px", display: "flex", alignItems: "center", gap: "3px" }}>
                    {alt}
                    <button onClick={() => { const nb = [...localBlanks]; nb[bi] = { ...nb[bi], alternatives: (nb[bi].alternatives || []).filter((_, i) => i !== ai) }; setLocalBlanks(nb); onUpdate("blanks", nb); }} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "10px", padding: 0 }}>✕</button>
                  </span>
                ))}
                <button onClick={() => { const alt = prompt(`Alternative für Lücke ${bi + 1}:`); if (!alt?.trim()) return; const nb = [...localBlanks]; nb[bi] = { ...nb[bi], alternatives: [...(nb[bi].alternatives || []), alt.trim()] }; setLocalBlanks(nb); onUpdate("blanks", nb); }} style={{ fontSize: "10px", color: "#2563a8", background: "none", border: "1px dashed #bfdbfe", borderRadius: "4px", padding: "2px 6px", cursor: "pointer" }}>+ Alternative</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TestEditor({ navigate, onLogout, currentUser, editingTest }) {
  const [title, setTitle] = useState(editingTest?.title || "");
  const [description, setDescription] = useState(editingTest?.description || "");
  const [subject, setSubject] = useState(editingTest?.subject || "");
  const [gradeLevel, setGradeLevel] = useState(editingTest?.grade_level || "");
  const [timeLimit, setTimeLimit] = useState(editingTest?.time_limit ? Math.round(editingTest.time_limit / 60) : 20);
  const [antiCheat, setAntiCheat] = useState(editingTest?.anti_cheat || false);
  const [gradingMode, setGradingMode] = useState(editingTest?.grading_mode || "standard");
  const [questions, setQuestions] = useState(editingTest?.question_data || []);
  const [gradingScale, setGradingScale] = useState(editingTest?.grading_scale?.length ? editingTest.grading_scale : [
    { grade: "1", minPercent: 87 }, { grade: "2", minPercent: 73 },
    { grade: "3", minPercent: 59 }, { grade: "4", minPercent: 45 },
    { grade: "5", minPercent: 18 }, { grade: "6", minPercent: 0 },
  ]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [pendingNavTarget, setPendingNavTarget] = useState(null);
  const [suggestingRubricId, setSuggestingRubricId] = useState(null);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const titleRef = useRef(null);
  const descRef = useRef(null);

  const safeNavigate = (target, data = null) => {
    if (saved) { navigate(target, data); return; }
    const hasContent = title.trim() || questions.length > 0;
    if (!hasContent) { navigate(target, data); return; }
    setPendingNavTarget({ target, data });
    setShowLeaveModal(true);
  };

  const addSection = () => setQuestions(prev => [...prev, newSection()]);
  const rubricDebounceRef = useRef({});

  const handleSuggestRubricForQuestion = async (q) => {
    setSuggestingRubricId(q.id);
    try {
      const result = await suggestRubric(q.text, q.points, q.solution, supabaseUrl);
      if (result.solution) updateQuestion(q.id, "solution", result.solution);
      if (result.partialPoints?.length) updateQuestion(q.id, "partialPoints", result.partialPoints);
    } catch (e) {}
    setSuggestingRubricId(null);
  };

  const triggerAutoRubric = (q) => {
    if (q.type !== "open" && q.type !== "qa") return;
    if (!q.solution?.trim()) return;
    if ((q.partialPoints || []).length > 0) return;
    clearTimeout(rubricDebounceRef.current[q.id]);
    rubricDebounceRef.current[q.id] = setTimeout(() => handleSuggestRubricForQuestion(q), 1500);
  };

  const updateQuestion = (id, field, value) => {
    setQuestions(prev => {
      const next = prev.map(q => q.id === id ? { ...q, [field]: value } : q);
      if (field === "solution") {
        const q = next.find(q => q.id === id);
        if (q) triggerAutoRubric(q);
      }
      return next;
    });
  };

  const removeQuestion = (id) => setQuestions(prev => prev.filter(q => q.id !== id));
  const addTask = (sectionId) => setQuestions(prev => prev.map(q => q.id === sectionId ? { ...q, tasks: [...(q.tasks || []), newTask()] } : q));
  const updateTask = (sectionId, taskId, field, value) => setQuestions(prev => prev.map(q => q.id === sectionId ? { ...q, tasks: (q.tasks || []).map(t => t.id === taskId ? { ...t, [field]: value } : t) } : q));
  const removeTask = (sectionId, taskId) => setQuestions(prev => prev.map(q => q.id === sectionId ? { ...q, tasks: (q.tasks || []).filter(t => t.id !== taskId) } : q));
  const addTaskQuestion = (sectionId, taskId, type) => setQuestions(prev => prev.map(q => q.id === sectionId ? { ...q, tasks: (q.tasks || []).map(t => t.id === taskId ? { ...t, questions: [...t.questions, newTaskQuestion(type)] } : t) } : q));
  const updateTaskQuestion = (sectionId, taskId, qId, field, value) => setQuestions(prev => prev.map(q => q.id === sectionId ? { ...q, tasks: (q.tasks || []).map(t => t.id === taskId ? { ...t, questions: t.questions.map(tq => tq.id === qId ? { ...tq, [field]: value } : tq) } : t) } : q));
  const removeTaskQuestion = (sectionId, taskId, qId) => setQuestions(prev => prev.map(q => q.id === sectionId ? { ...q, tasks: (q.tasks || []).map(t => t.id === taskId ? { ...t, questions: t.questions.filter(tq => tq.id !== qId) } : t) } : q));
  const moveQuestion = (index, dir) => { const next = [...questions]; const swap = index + dir; if (swap < 0 || swap >= next.length) return; [next[index], next[swap]] = [next[swap], next[index]]; setQuestions(next); };

  const getSectionPoints = (sectionIndex) => {
    const section = questions[sectionIndex];
    if (section?.type !== "section") return 0;
    return (section.tasks || []).reduce((sum, t) => sum + (t.questions || []).reduce((s, tq) => s + Number(tq.points || 0), 0), 0);
  };
  const totalPoints = questions.filter(q => q.type === "section").reduce((sum, q) => sum + getSectionPoints(questions.indexOf(q)), 0);
  const hasOpenQuestions = questions.some(q => q.type === "section" && (q.tasks || []).some(t => (t.questions || []).some(tq => tq.type === "open" || tq.type === "qa")));

  const handleImport = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setImporting(true); setImportError("");
    try {
      const ext = file.name.split(".").pop().toLowerCase();
      let contentBlocks = [];
      const PROMPT = `Analysiere diesen Test/diese Prüfungsarbeit und extrahiere alle Aufgaben. Gib das Ergebnis als reines JSON-Array zurück (keine Markdown-Backticks, kein Text drumherum). Jede Aufgabe hat folgende Felder: type, text, points, options, correctAnswer, pairs, solution, partialPoints:[]. Erkenne den Typ automatisch. Verwende 'qa' statt 'open' für offene Antworten.`;
      if (ext === "docx") {
        const arrayBuffer = await file.arrayBuffer();
        const JSZip = (await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm")).default;
        const zip = await JSZip.loadAsync(arrayBuffer);
        const xmlFile = zip.file("word/document.xml"); if (!xmlFile) throw new Error("Ungültige DOCX-Datei");
        const xml = await xmlFile.async("string");
        const text = xml.replace(/<w:p[ >]/g, "\n<w:p ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n{3,}/g, "\n\n").trim();
        if (!text.trim()) throw new Error("Kein Text extrahiert");
        contentBlocks = [{ type: "text", text: `${PROMPT}\n\nInhalt:\n\n${text}` }];
      } else if (ext === "pdf" || ["jpg","jpeg","png","webp"].includes(ext)) {
        const base64 = await new Promise((res, rej) => { const reader = new FileReader(); reader.onload = () => res(reader.result.split(",")[1]); reader.onerror = rej; reader.readAsDataURL(file); });
        const mediaType = ext === "pdf" ? "application/pdf" : `image/${ext === "jpg" ? "jpeg" : ext}`;
        contentBlocks = [ext === "pdf" ? { type: "document", source: { type: "base64", media_type: mediaType, data: base64 } } : { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } }, { type: "text", text: PROMPT }];
      } else { throw new Error("Nicht unterstütztes Format"); }
      const response = await fetch(`${supabaseUrl}/functions/v1/anthropic-proxy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 4000, messages: [{ role: "user", content: contentBlocks }] }) });
      const rawText = await response.text(); if (!response.ok) throw new Error(`Edge Function Fehler ${response.status}`);
      const data = JSON.parse(rawText); const text = data.content?.find(b => b.type === "text")?.text || "";
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim()); if (!Array.isArray(parsed)) throw new Error("Kein Array erhalten");
      setQuestions(prev => [...prev, ...parsed.map(q => ({ id: Date.now() + Math.random(), type: q.type || "qa", text: q.text || "", points: Number(q.points) || 1, options: q.options || [], correctAnswer: q.correctAnswer ?? null, pairs: q.pairs || [], solution: q.solution || "", partialPoints: [], attachment: null }))]);
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
    } catch (err) { setImportError(`Fehler beim Importieren: ${err.message}`); }
    finally { setImporting(false); e.target.value = ""; }
  };

  const handleSave = async () => {
    setSaving(true);
    const payload = { teacher_id: currentUser?.id, title: title || "Unbenannte Vorlage", description, subject, grade_level: gradeLevel, time_limit: timeLimit * 60, anti_cheat: antiCheat, grading_mode: gradingMode, question_data: questions, grading_scale: gradingScale };
    if (editingTest?.id) { await supabase.from("templates").update(payload).eq("id", editingTest.id); }
    else { await supabase.from("templates").insert(payload); }
    setSaving(false); setSaved(true);
    setTimeout(() => { setSaved(false); navigate("library"); }, 1000);
  };

  const SUBJECTS = ["Mathematik", "Deutsch", "Englisch", "Französisch", "Spanisch", "Sachkunde", "Geschichte", "Geographie", "Biologie", "Physik", "Chemie", "Musik", "Kunst", "Sport"];
  const GRADING_MODES = [
    { id: "content", label: "🎯 Nur Inhalt", description: "Rechtschreibung & Grammatik werden ignoriert" },
    { id: "standard", label: "⚖️ Standard", description: "Inhalt zählt hauptsächlich, grobe Fehler leicht abgezogen" },
    { id: "strict", label: "🔍 Streng", description: "Inhalt + Rechtschreibung + Grammatik + Zeichensetzung" },
  ];

  return (
    <TeacherLayout navigate={safeNavigate} onLogout={onLogout} currentUser={currentUser} activePage="testEditor">
      <div style={{ padding: "32px", maxWidth: "860px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: 0 }}>{editingTest ? "Vorlage bearbeiten" : "Neue Vorlage erstellen"}</h1>
            <p style={{ color: "#64748b", fontSize: "14px", marginTop: "4px" }}><strong>{totalPoints} Punkte</strong></p>
          </div>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <label style={{ padding: "10px 16px", background: importing ? "#f1f5f9" : "#f0f7ff", color: importing ? "#94a3b8" : "#2563a8", border: "1px solid #bfdbfe", borderRadius: "10px", fontWeight: 600, fontSize: "13px", cursor: importing ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: "6px" }}>
              {importing ? "⏳ Wird analysiert..." : "📄 Aus Datei importieren"}
              <input type="file" accept=".pdf,.docx,.jpg,.jpeg,.png,.webp" style={{ display: "none" }} onChange={handleImport} disabled={importing} />
            </label>
            <button onClick={() => navigate("testPreview", { ...editingTest, title, description, subject, grade_level: gradeLevel, time_limit: timeLimit * 60, question_data: questions, grading_scale: gradingScale })}
              style={{ padding: "10px 18px", background: "#f5f3ff", color: "#6d28d9", border: "1px solid #e9d5ff", borderRadius: "10px", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}>👁 Vorschau</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: "10px 24px", background: saved ? "#16a34a" : "#2563a8", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "14px", cursor: saving ? "not-allowed" : "pointer", transition: "background 0.3s" }}>
              {saving ? "Wird gespeichert..." : saved ? "✓ Gespeichert!" : "Vorlage speichern"}</button>
          </div>
        </div>

        {importError && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px", padding: "12px 16px", marginBottom: "16px", fontSize: "13px", color: "#dc2626" }}>⚠️ {importError}</div>}
        {importing && <div style={{ background: "#f0f7ff", border: "1px solid #bfdbfe", borderRadius: "10px", padding: "16px", marginBottom: "16px", fontSize: "13px", color: "#2563a8", textAlign: "center" }}><div style={{ fontSize: "24px", marginBottom: "8px" }}>🤖</div><strong>Claude analysiert die Datei...</strong></div>}

        <div style={{ background: "#fff", borderRadius: "16px", padding: "24px", border: "1px solid #e2e8f0", marginBottom: "20px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", marginBottom: "16px" }}>
            <div>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>Titel *</label>
              <input ref={titleRef} value={title} onChange={e => setTitle(e.target.value)} placeholder="z.B. Vocabulario – Unidad 4"
                style={{ width: "100%", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", fontFamily: "inherit" }} />
              <SpecialCharBar inputRef={titleRef} value={title} onChange={setTitle} />
            </div>
            <div><label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>Fach</label><select value={subject} onChange={e => setSubject(e.target.value)} style={{ width: "100%", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", fontFamily: "inherit", background: "#fff", boxSizing: "border-box" }}><option value="">– Fach –</option>{SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
            <div><label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>Klasse</label><select value={gradeLevel} onChange={e => setGradeLevel(e.target.value)} style={{ width: "100%", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", fontFamily: "inherit", background: "#fff", boxSizing: "border-box" }}><option value="">– Klasse –</option>{[5,6,7,8,9,10,11,12,13].map(g => <option key={g} value={String(g)}>{g}. Klasse</option>)}</select></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", marginBottom: "16px" }}>
            <div style={{ gridColumn: "span 2" }}>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>Kurzbeschreibung</label>
              <input ref={descRef} value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional"
                style={{ width: "100%", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", fontFamily: "inherit" }} />
              <SpecialCharBar inputRef={descRef} value={description} onChange={setDescription} />
            </div>
            <div><label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>Standard-Zeit (Min.)</label><input type="number" min={1} max={180} value={timeLimit} onChange={e => setTimeLimit(Number(e.target.value))} style={{ width: "100%", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", fontFamily: "inherit" }} /></div>
          </div>
          <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", marginBottom: "16px" }}>
            <input type="checkbox" checked={antiCheat} onChange={e => setAntiCheat(e.target.checked)} style={{ width: "16px", height: "16px", accentColor: "#2563a8" }} />
            🛡️ Anti-Cheat als Standard aktivieren
          </label>

          {hasOpenQuestions && (
            <div style={{ background: "#f8fafc", borderRadius: "12px", padding: "16px", marginBottom: "16px", border: "1px solid #e2e8f0" }}>
              <label style={{ fontSize: "13px", fontWeight: 700, color: "#374151", display: "block", marginBottom: "10px" }}>🤖 KI-Bewertungsmodus für offene Antworten</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                {GRADING_MODES.map(mode => (
                  <button key={mode.id} onClick={() => setGradingMode(mode.id)}
                    style={{ padding: "12px", border: `2px solid ${gradingMode === mode.id ? "#2563a8" : "#e2e8f0"}`, borderRadius: "10px", background: gradingMode === mode.id ? "#eff6ff" : "#fff", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: gradingMode === mode.id ? "#1e40af" : "#374151", marginBottom: "4px" }}>{mode.label}</div>
                    <div style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.4 }}>{mode.description}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <details>
            <summary style={{ cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "#374151", userSelect: "none" }}>📊 Notenschlüssel anpassen</summary>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" }}>
              {gradingScale.map((g, i) => (
                <div key={i} style={{ background: "#f8fafc", borderRadius: "8px", padding: "8px 12px", border: "1px solid #e2e8f0", fontSize: "13px" }}>
                  <strong>Note {g.grade}</strong> ab <input type="number" value={g.minPercent} onChange={e => { const u = [...gradingScale]; u[i].minPercent = Number(e.target.value); setGradingScale(u); }} style={{ width: "48px", border: "none", background: "none", fontWeight: 700, fontSize: "13px", color: "#2563a8" }} />%
                </div>
              ))}
            </div>
          </details>
        </div>

        {questions.map((q, index) => {
          if (q.type !== "section") return null;
          const pts = getSectionPoints(index);
          return (
            <div key={q.id} style={{ marginBottom: "16px" }}>
              <div style={{ background: "linear-gradient(135deg, #1e3a5f, #2563a8)", borderRadius: "14px", padding: "20px 24px", color: "#fff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      <button onClick={() => moveQuestion(index, -1)} disabled={index === 0} style={{ background: "none", border: "none", cursor: index === 0 ? "default" : "pointer", color: index === 0 ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.7)", fontSize: "12px", padding: 0 }}>▲</button>
                      <button onClick={() => moveQuestion(index, 1)} disabled={index === questions.length - 1} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.7)", fontSize: "12px", padding: 0 }}>▼</button>
                    </div>
                    <span style={{ fontSize: "16px" }}>📂</span>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "rgba(255,255,255,0.9)", letterSpacing: "0.5px" }}>ABSCHNITT</span>
                    {pts > 0 && <span style={{ fontSize: "12px", background: "rgba(255,255,255,0.15)", borderRadius: "6px", padding: "2px 8px" }}>{pts} Pkt.</span>}
                  </div>
                  <button onClick={() => removeQuestion(q.id)} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: "7px", padding: "5px 12px", cursor: "pointer", fontSize: "13px" }}>✕ Entfernen</button>
                </div>
                <div style={{ marginBottom: "12px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "rgba(255,255,255,0.8)", display: "block", marginBottom: "5px" }}>Abschnittstitel</label>
                  <SectionInput field="sectionTitle" value={q.sectionTitle || ""} onChange={val => updateQuestion(q.id, "sectionTitle", val)} placeholder="z.B. Teil A – Leseverstehen" />
                </div>
                <div style={{ marginBottom: "12px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 600, color: "rgba(255,255,255,0.8)", display: "block", marginBottom: "5px" }}>📝 Text / Lesetext (optional)</label>
                  <RichTextEditor value={q.sectionText || ""} onChange={val => updateQuestion(q.id, "sectionText", val)} placeholder="Füge hier einen Lesetext, Gedicht, Dialog o.ä. ein..." />
                </div>
                {(q.tasks || []).map((task, tIdx) => (
                  <TaskEditor key={task.id} task={task} tIdx={tIdx} sectionId={q.id}
                    onUpdate={(field, val) => updateTask(q.id, task.id, field, val)}
                    onRemove={() => removeTask(q.id, task.id)}
                    onAddQuestion={(type) => addTaskQuestion(q.id, task.id, type)}
                    onUpdateQuestion={(qId, field, val) => updateTaskQuestion(q.id, task.id, qId, field, val)}
                    onRemoveQuestion={(qId) => removeTaskQuestion(q.id, task.id, qId)} />
                ))}
                <button onClick={() => addTask(q.id)} style={{ width: "100%", padding: "10px", background: "rgba(255,255,255,0.1)", border: "2px dashed rgba(255,255,255,0.3)", borderRadius: "10px", color: "rgba(255,255,255,0.8)", fontWeight: 600, fontSize: "13px", cursor: "pointer", fontFamily: "inherit" }}>+ Aufgabe zum Abschnitt hinzufügen</button>
              </div>
            </div>
          );
        })}

        <button onClick={addSection} style={{ width: "100%", padding: "14px", border: "2px dashed #c7d2fe", borderRadius: "14px", background: "#fff", color: "#4f46e5", fontSize: "14px", fontWeight: 600, cursor: "pointer", marginBottom: "12px" }} onMouseOver={e => e.currentTarget.style.borderColor = "#4f46e5"} onMouseOut={e => e.currentTarget.style.borderColor = "#c7d2fe"}>+ Abschnitt hinzufügen</button>
      </div>

      {showLeaveModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "400px", width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: "48px", marginBottom: "12px" }}>💾</div>
            <h3 style={{ fontSize: "18px", fontWeight: 800, color: "#0f172a", margin: "0 0 8px" }}>Entwurf speichern?</h3>
            <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "24px", lineHeight: 1.5 }}>Du hast ungespeicherte Änderungen. Möchtest du die Vorlage speichern bevor du die Seite verlässt?</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <button onClick={async () => { await handleSave(); setShowLeaveModal(false); if (pendingNavTarget) navigate(pendingNavTarget.target, pendingNavTarget.data); }} style={{ padding: "12px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "14px", cursor: "pointer" }}>💾 Speichern und verlassen</button>
              <button onClick={() => { setShowLeaveModal(false); if (pendingNavTarget) navigate(pendingNavTarget.target, pendingNavTarget.data); }} style={{ padding: "12px", background: "#fff", color: "#dc2626", border: "1px solid #fecaca", borderRadius: "10px", fontWeight: 600, fontSize: "14px", cursor: "pointer" }}>Ohne Speichern verlassen</button>
              <button onClick={() => setShowLeaveModal(false)} style={{ padding: "12px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "10px", fontWeight: 600, fontSize: "14px", cursor: "pointer" }}>Abbrechen — weiter bearbeiten</button>
            </div>
          </div>
        </div>
      )}
    </TeacherLayout>
  );
}

// Hilfskomponente für Abschnittsfelder mit Sonderzeichen
function SectionInput({ value, onChange, placeholder }) {
  const inputRef = useRef(null);
  return (
    <div>
      <input ref={inputRef} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: "100%", padding: "9px 12px", border: "2px solid rgba(255,255,255,0.3)", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", fontFamily: "inherit", background: "rgba(255,255,255,0.1)", color: "#fff" }} />
      <SpecialCharBar inputRef={inputRef} value={value} onChange={onChange} />
    </div>
  );
}
