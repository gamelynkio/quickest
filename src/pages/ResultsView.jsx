import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import TeacherLayout from "../components/TeacherLayout";

const GRADE_COLOR = { "1": "#16a34a", "2": "#22c55e", "3": "#eab308", "4": "#f97316", "5": "#ef4444", "6": "#dc2626" };

const flattenQs = (qs) => {
  const result = [];
  for (const q of (qs || [])) {
    if (q.type === "section") { for (const t of (q.tasks||[])) for (const tq of (t.questions||[])) result.push(tq); }
    else if (q.type === "task") { for (const tq of (q.questions||[])) result.push(tq); }
    else result.push(q);
  }
  return result;
};

// ─── Batch-Korrektur ────────────────────────────────────────────────────────
const runBatchCorrection = async ({ pending, allSubs, aData, supabaseUrl, supabaseAnonKey }) => {
  const openQs = flattenQs(aData?.question_data || []).filter(q => q.type === "open" || q.type === "qa");
  if (openQs.length === 0) return {};

  const rules = aData?.detected_rules || [];
  const activeRules = rules.filter(r => r.enabled).map(r => `- ${r.label}${r.description ? `: ${r.description}` : ""}`).join("\n");
  const disabledRules = rules.filter(r => !r.enabled).map(r => `- DEAKTIVIERT — überschreibt alle Kriterien: "${r.label}" DARF NICHT angewendet werden, auch nicht mit Teilpunkten. Ignoriere alle Bewertungskriterien die dieser Regel entsprechen.`).join("\n");
  const customRulesText = aData?.custom_rules ? `\nZusatzregeln:\n${aData.custom_rules}` : "";
  const rulesBlock = (activeRules || disabledRules) ? `\nVerbindliche Regeln:\n${activeRules}${disabledRules ? "\n" + disabledRules : ""}${customRulesText}\n` : customRulesText;

  // Großschreibung: prüfe ob Regel aktiv
  const capitalizeRule = rules.find(r => r.label?.toLowerCase().includes("groß") && r.label?.toLowerCase().includes("klein"));
  const ignoreCase = capitalizeRule ? capitalizeRule.enabled : true;

  const batchResults = {};

  for (const q of openQs) {
    const normalizeText = (t) => ignoreCase ? (t || "").toLowerCase() : (t || "");
    const answers = pending
      .filter(s => s.answers?.[q.id]?.trim())
      .map(s => ({ id: s.id, username: s.username, answer: normalizeText(s.answers[q.id]), original: s.answers[q.id] }));
    if (answers.length === 0) continue;

    const calibRef = (allSubs || [])
      .filter(s => s.reviewed && s.ai_corrections?.[q.id]?.aiReviewed && !pending.find(p => p.id === s.id))
      .slice(0, 3)
      .map(s => `- "${s.answers?.[q.id]}" → ${s.ai_corrections[q.id].points} Pkt.`)
      .join("\n");

    const capitalizeRule2 = ignoreCase
      ? "Groß-/Kleinschreibung ist irrelevant — \"hund\" = \"Hund\" = \"HUND\""
      : "Groß-/Kleinschreibung MUSS korrekt sein — \"hund\" ist FALSCH wenn die Musterlösung \"Hund\" lautet";

    const prompt = `Du bist ein Schullehrer und bewertest alle Schülerantworten auf dieselbe Frage gleichzeitig und einheitlich.

Frage: ${q.text || "(Fragetext)"}
Musterlösung: ${normalizeText(q.solution) || "(keine)"}
Maximale Punktzahl: ${q.points}
${rulesBlock}
GRUNDREGEL: ${capitalizeRule2}
${calibRef ? `\nReferenz-Bewertungen:\n${calibRef}\n` : ""}
${(q.partialPoints || []).length > 0
  ? `Bewertungskriterien (verbindlich):\n${q.partialPoints.map(p => `- ${p.points} Pkt. für: ${p.description}`).join("\n")}`
  : "Vergib anteilige Punkte bei Teilantworten. Schritte von 0.5 möglich."}

Schülerantworten:
${answers.map((a, i) => `${i + 1}. ${a.username}: "${a.answer}"`).join("\n")}

Gib deine Bewertung als JSON zurück:
{
  "criteria": "<1-2 Sätze welche Kriterien du angewendet hast>",
  "results": [{"username": "<n>", "points": <Zahl max ${q.points}>, "comment": "<1 Satz Begründung>", "confidence": <0.0-1.0>}]\n\nconfidence: 1.0 = eindeutig, 0.5 = unklar ob Antwort als korrekt gilt, 0.0 = völlig unklar
}`;

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/anthropic-proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseAnonKey}`, "apikey": supabaseAnonKey },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 2000, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await res.json();
      const text = data.content?.map(b => b.text || "").join("") || "";
      let parsed;
      try { parsed = JSON.parse(text.replace(/```json|```/g, "").trim()); } catch { continue; }
      const results = Array.isArray(parsed) ? parsed : (parsed.results || []);
      const usedCriteria = parsed.criteria || null;
      results.forEach((r, i) => {
        const sub = answers[i];
        if (!sub) return;
        if (!batchResults[sub.id]) batchResults[sub.id] = {};
        batchResults[sub.id][q.id] = {
          points: Math.min(Math.max(0, Number(r.points) || 0), Number(q.points)),
          comment: `🤖 ${r.comment}`,
          usedCriteria,
          confidence: r.confidence ?? 1.0,
          aiReviewed: true, needsReview: false,
          correct: Number(r.points) >= Number(q.points),
          maxPoints: Number(q.points),
        };
      });
    } catch (e) { console.error("Batch error q", q.id, e); }
  }
  return batchResults;
};

// ─── Regelanalyse ────────────────────────────────────────────────────────────
const analyzeRules = async ({ allSubs, aData, previousRules, supabaseUrl, supabaseAnonKey }) => {
  const openQs = flattenQs(aData?.question_data || []).filter(q => q.type === "open" || q.type === "qa");
  if (openQs.length === 0) return null;

  const qSummaries = openQs.map(q => {
    const answers = allSubs.filter(s => s.answers?.[q.id]?.trim()).map(s => s.answers[q.id]);
    return `ID: ${q.id} | Frage: ${q.text || "(Fragetext)"} | Musterlösung: ${q.solution || "(keine)"}\nAntworten: ${answers.slice(0, 6).map((a, i) => `${i+1}."${a}"`).join(", ")}`;
  }).join("\n\n");

  const prevRulesText = (previousRules || []).length > 0
    ? `\nDieser Lehrer hat in früheren Tests folgende Regeln aktiviert (Vorschlag: wieder aktivieren):\n${previousRules.map(r => `- ${r.label}: ${r.description || ""} (${r.source || "frühere Tests"})`).join("\n")}\n`
    : "";

  const prompt = `Du analysierst Schülerantworten und schlägst Bewertungsregeln vor.

${qSummaries}
${prevRulesText}
Schlage 3-7 konkrete Toggle-Regeln vor. Trenne allgemeine (scope:"all") von aufgabenspezifischen (scope:"task").
Allgemeine Regeln gelten für alle Aufgaben. Aufgabenspezifische nur für bestimmte Fragen — gib taskId und taskIds an.
Alle vorgeschlagenen Regeln haben enabled:true (der Lehrer deaktiviert was er nicht will).
Aus früheren Tests übernommene Regeln bekommen source:"history".

Fragen-IDs: ${openQs.map(q => q.id).join(", ")}

Gib NUR JSON zurück:
[
  {"id":"capitalize","label":"Groß-/Kleinschreibung ignorieren","description":"hund = Hund = HUND","enabled":true,"scope":"all","taskIds":${JSON.stringify(openQs.map(q => String(q.id)))},"source":"detected"},
  {"id":"typo_q1","label":"Einzelne Tippfehler tolerieren","description":"z.B. feeed statt feed","enabled":true,"scope":"task","taskId":"<ID>","taskIds":["<ID>"],"source":"detected"}
]`;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/anthropic-proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseAnonKey}`, "apikey": supabaseAnonKey },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await res.json();
    const text = data.content?.map(b => b.text || "").join("") || "";
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch (e) { console.error("Rule analysis failed", e); return null; }
};

// ─── Rubric suggestion ───────────────────────────────────────────────────────
const suggestRubric = async ({ question, submissions, supabaseUrl, supabaseAnonKey }) => {
  const answers = submissions.filter(s => s.answers?.[question.id]?.trim()).map(s => s.answers[question.id]);
  if (answers.length === 0) return null;
  const prompt = `Du bist ein Schullehrer und erstellst einen Bewertungsmaßstab.

Frage: ${question.text || "(Fragetext)"}
Musterlösung: ${question.solution || "(keine)"}
Maximale Punktzahl: ${question.points}
Schülerantworten: ${answers.map((a, i) => `${i+1}."${a}"`).join(", ")}

Erstelle 2-4 Kriterien. Summe = ${question.points} Punkte.
Gib NUR JSON zurück: {"partialPoints": [{"points": <Zahl>, "description": "<Kriterium>"}]}`;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/anthropic-proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseAnonKey}`, "apikey": supabaseAnonKey },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 800, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await res.json();
    const text = data.content?.map(b => b.text || "").join("") || "";
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch { return null; }
};

// ─── RegelwerkModal ──────────────────────────────────────────────────────────
function RegelwerkModal({ assignmentData, customRules, detectedRules, setDetectedRules, saveAllRules, analyzingRules, savingRules, onClose }) {
  const [localRules, setLocalRules] = useState(customRules || "");
  const [localDetected, setLocalDetected] = useState(detectedRules || []);
  const [newRuleLabel, setNewRuleLabel] = useState("");
  const [newRuleDesc, setNewRuleDesc] = useState("");

  useEffect(() => { setLocalDetected(detectedRules || []); }, [detectedRules]);

  const openQs = flattenQs(assignmentData?.question_data || []).filter(q => q.type === "open" || q.type === "qa");
  const generalRules = localDetected.filter(r => !r.taskId);
  const taskRules = localDetected.filter(r => r.taskId);

  const toggle = (id) => setLocalDetected(prev => prev.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));

  const addCustomRule = () => {
    if (!newRuleLabel.trim()) return;
    const newRule = {
      id: `custom_${Date.now()}`,
      label: newRuleLabel.trim(),
      description: newRuleDesc.trim(),
      enabled: true,
      scope: "all",
      taskIds: openQs.map(q => String(q.id)),
      source: "teacher",
    };
    setLocalDetected(prev => [...prev, newRule]);
    setNewRuleLabel("");
    setNewRuleDesc("");
  };

  const RuleToggle = ({ rule }) => (
    <div onClick={() => toggle(rule.id)}
      style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "10px 12px",
        background: rule.enabled ? "#f0fdf4" : "#f8fafc",
        border: `2px solid ${rule.enabled ? "#16a34a" : "#e2e8f0"}`,
        borderRadius: "8px", cursor: "pointer", userSelect: "none", transition: "all 0.15s", marginBottom: "6px" }}>
      <div style={{ width: "20px", height: "20px", borderRadius: "5px",
        background: rule.enabled ? "#16a34a" : "#e2e8f0",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: "1px" }}>
        {rule.enabled && <span style={{ color: "#fff", fontSize: "12px", fontWeight: 800 }}>✓</span>}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "13px", fontWeight: 600, color: rule.enabled ? "#16a34a" : "#374151" }}>{rule.label}</span>
          {rule.source === "history" && <span style={{ fontSize: "10px", background: "#f0f7ff", color: "#2563a8", borderRadius: "4px", padding: "1px 5px", fontWeight: 600 }}>📚 Frühere Tests</span>}
          {rule.source === "teacher" && <span style={{ fontSize: "10px", background: "#fdf4ff", color: "#7c3aed", borderRadius: "4px", padding: "1px 5px", fontWeight: 600 }}>✏️ Eigene Regel</span>}
        </div>
        {rule.description && <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>{rule.description}</div>}
      </div>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1001, padding: "20px" }}>
      <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "560px", width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#0f172a" }}>📋 Bewertungsregelwerk</h3>
          <button onClick={onClose} style={{ background: "#f1f5f9", border: "none", borderRadius: "6px", padding: "4px 10px", cursor: "pointer", fontSize: "16px", color: "#64748b" }}>✕</button>
        </div>

        {/* Allgemeine Regeln */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.5px", marginBottom: "8px" }}>
            ALLGEMEINE REGELN
            {analyzingRules && <span style={{ marginLeft: "8px", color: "#6d28d9", fontWeight: 400 }}>⏳ KI analysiert...</span>}
          </div>
          {generalRules.length === 0 ? (
            <div style={{ fontSize: "12px", color: "#94a3b8", fontStyle: "italic", marginBottom: "8px" }}>
              {analyzingRules ? "Wird analysiert..." : "Erscheinen nach der ersten KI-Korrektur."}
            </div>
          ) : generalRules.map(r => <RuleToggle key={r.id} rule={r} />)}
        </div>

        {/* Aufgabenspezifische Regeln */}
        {openQs.length > 0 && taskRules.length > 0 && (
          <div style={{ marginBottom: "16px" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.5px", marginBottom: "8px" }}>AUFGABENSPEZIFISCHE REGELN</div>
            {openQs.map((q, i) => {
              const qRules = taskRules.filter(r => String(r.taskId) === String(q.id));
              if (qRules.length === 0) return null;
              return (
                <div key={q.id} style={{ marginBottom: "10px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "#374151", marginBottom: "5px" }}>
                    Aufgabe {i + 1}{q.solution ? ` — ${q.solution}` : ""}
                  </div>
                  {qRules.map(r => <RuleToggle key={r.id} rule={r} />)}
                </div>
              );
            })}
          </div>
        )}

        {/* Eigene Regel hinzufügen */}
        <div style={{ background: "#f8fafc", borderRadius: "10px", padding: "14px", marginBottom: "16px", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", marginBottom: "8px" }}>+ EIGENE REGEL HINZUFÜGEN</div>
          <input value={newRuleLabel} onChange={e => setNewRuleLabel(e.target.value)}
            placeholder='Regelname, z.B. "Beide Bedeutungen akzeptieren"'
            style={{ width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: "6px", fontSize: "13px", fontFamily: "inherit", marginBottom: "6px", boxSizing: "border-box" }} />
          <input value={newRuleDesc} onChange={e => setNewRuleDesc(e.target.value)}
            placeholder='Beschreibung, z.B. "dog = Hund oder Köter"'
            style={{ width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: "6px", fontSize: "13px", fontFamily: "inherit", marginBottom: "8px", boxSizing: "border-box" }} />
          <button onClick={addCustomRule} disabled={!newRuleLabel.trim()}
            style={{ padding: "7px 14px", background: newRuleLabel.trim() ? "#6d28d9" : "#e2e8f0", color: newRuleLabel.trim() ? "#fff" : "#94a3b8", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 700, cursor: newRuleLabel.trim() ? "pointer" : "not-allowed" }}>
            Regel hinzufügen
          </button>
        </div>

        {/* Freitext-Zusatzregeln */}
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.5px", marginBottom: "6px" }}>FREITEXT-ZUSATZREGELN</div>
          <textarea value={localRules} onChange={e => setLocalRules(e.target.value)} rows={3}
            placeholder='z.B. "Antworten auf Englisch akzeptieren" oder "Vergangenheitsform zählt auch"'
            style={{ width: "100%", padding: "10px 12px", border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "13px", fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
        </div>

        <div style={{ background: "#fef9c3", border: "1px solid #fde68a", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", fontSize: "12px", color: "#92400e" }}>
          ⚠️ Speichern löst eine Neu-Korrektur aller Abgaben aus.
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button onClick={onClose} style={{ flex: 1, padding: "11px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "10px", fontWeight: 600, cursor: "pointer" }}>Schließen</button>
          <button onClick={() => saveAllRules(localDetected, localRules)} disabled={savingRules}
            style={{ flex: 1, padding: "11px", background: "#6d28d9", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, cursor: savingRules ? "not-allowed" : "pointer" }}>
            {savingRules ? "⏳ Wird gespeichert..." : "✓ Speichern & neu korrigieren"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── RubricModal ─────────────────────────────────────────────────────────────
function RubricModal({ rubricModal, setRubricModal, savingRubric, setSavingRubric, onSave }) {
  if (!rubricModal) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1002, padding: "20px" }}>
      <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "480px", width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ fontSize: "48px", textAlign: "center", marginBottom: "12px" }}>🎯</div>
        <h3 style={{ fontSize: "18px", fontWeight: 800, margin: "0 0 6px", color: "#0f172a", textAlign: "center" }}>KI schlägt Bewertungsmaßstab vor</h3>
        <p style={{ color: "#64748b", fontSize: "13px", marginBottom: "20px", textAlign: "center" }}>
          Basierend auf den echten Schülerantworten. Wird in der Vorlage gespeichert.
        </p>
        <div style={{ background: "#f8fafc", borderRadius: "12px", padding: "16px", marginBottom: "20px", border: "1px solid #e2e8f0" }}>
          {(rubricModal.suggested || []).map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
              <div style={{ background: "#6d28d9", color: "#fff", borderRadius: "6px", padding: "3px 10px", fontSize: "12px", fontWeight: 700, flexShrink: 0 }}>{p.points} Pkt.</div>
              <input value={p.description} onChange={e => setRubricModal(prev => ({ ...prev, suggested: prev.suggested.map((pp, pi) => pi === i ? { ...pp, description: e.target.value } : pp) }))}
                style={{ flex: 1, padding: "6px 10px", border: "1px solid #e2e8f0", borderRadius: "6px", fontSize: "13px", fontFamily: "inherit" }} />
              <input type="number" value={p.points} min={0} step={0.5} onChange={e => setRubricModal(prev => ({ ...prev, suggested: prev.suggested.map((pp, pi) => pi === i ? { ...pp, points: Number(e.target.value) } : pp) }))}
                style={{ width: "54px", padding: "6px 8px", border: "1px solid #e2e8f0", borderRadius: "6px", fontSize: "12px", textAlign: "center" }} />
            </div>
          ))}
          <div style={{ fontSize: "12px", color: "#64748b", marginTop: "8px", textAlign: "right" }}>
            Summe: <strong style={{ color: (rubricModal.suggested || []).reduce((s, p) => s + Number(p.points), 0) === Number(rubricModal.question?.points) ? "#16a34a" : "#dc2626" }}>
              {(rubricModal.suggested || []).reduce((s, p) => s + Number(p.points), 0)} / {rubricModal.question?.points} Pkt.
            </strong>
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button onClick={() => setRubricModal(null)} style={{ flex: 1, padding: "11px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "10px", fontWeight: 600, cursor: "pointer" }}>Abbrechen</button>
          <button onClick={() => onSave(rubricModal)} disabled={savingRubric}
            style={{ flex: 1, padding: "11px", background: "#6d28d9", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, cursor: savingRubric ? "not-allowed" : "pointer" }}>
            {savingRubric ? "Wird gespeichert..." : "✓ In Vorlage speichern"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ResultsView ─────────────────────────────────────────────────────────────
const DEFAULT_RULES_FALLBACK = [
  { id: "capitalize", label: "Groß-/Kleinschreibung ignorieren", enabled: true },
  { id: "typo", label: "Einzelne Tippfehler tolerieren", enabled: true },
  { id: "synonym", label: "Synonyme akzeptieren", enabled: true },
  { id: "article", label: "Artikel ignorieren", enabled: false },
  { id: "to", label: "Infinitivpartikel 'to' optional", enabled: false },
];

export default function ResultsView({ navigate, onLogout, currentUser, assignment }) {
  const [submissions, setSubmissions] = useState([]);
  const [groupUsernames, setGroupUsernames] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSubmission, setSelectedSubmission] = useState(null);

  // Detail-Panel automatisch aktualisieren wenn KI die Korrektur abschließt
  useEffect(() => {
    if (!selectedSubmission) return;
    const fresh = submissions.find(s => s.id === selectedSubmission.id);
    if (fresh && JSON.stringify(fresh.ai_corrections) !== JSON.stringify(selectedSubmission.ai_corrections)) {
      setSelectedSubmission(prev => ({ ...prev, ...fresh }));
    }
  }, [submissions]);
  const [overrides, setOverrides] = useState({});
  const [saving, setSaving] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiProgress, setAiProgress] = useState("");
  const [assignmentData, setAssignmentData] = useState(null);
  const [detectedRules, setDetectedRules] = useState([]);
  const [customRules, setCustomRules] = useState("");
  const [analyzingRules, setAnalyzingRules] = useState(false);
  const [savingRules, setSavingRules] = useState(false);
  const [regelwerkModal, setRegelwerkModal] = useState(false);
  const [rubricModal, setRubricModal] = useState(null);
  const [savingRubric, setSavingRubric] = useState(false);
  const [suggestingRubric, setSuggestingRubric] = useState(false);
  const [releaseModal, setReleaseModal] = useState(false);
  const [makeupModal, setMakeupModal] = useState(false);
  const [makeupSelected, setMakeupSelected] = useState(new Set());
  const [makeupTemplateId, setMakeupTemplateId] = useState("");
  const [makeupTimeLimit, setMakeupTimeLimit] = useState(20);
  const [makeupAntiCheat, setMakeupAntiCheat] = useState(false);
  const [makeupRequireSeb, setMakeupRequireSeb] = useState(true);
  const [creatingMakeup, setCreatingMakeup] = useState(false);
  const [questionFeedback, setQuestionFeedback] = useState({});
  const [solutionEdits, setSolutionEdits] = useState({});
  const [teacherComments, setTeacherComments] = useState({});
  const [maxPointEdits, setMaxPointEdits] = useState({});
  const [scanModal, setScanModal] = useState(false);
  const [scanFile, setScanFile] = useState(null);
  const [scanProcessing, setScanProcessing] = useState(false);
  const [scanProcessingStep, setScanProcessingStep] = useState("");
  const [scanResult, setScanResult] = useState(null);
  const [scanError, setScanError] = useState("");
  const [scanDebug, setScanDebug] = useState("");
  const [calibration, setCalibration] = useState(null); // {qId, qText, cases:[{subId,username,answer,points,maxPoints}], examples:{}}
  const [savingSolution, setSavingSolution] = useState(null);

  const [refiningQuestion, setRefiningQuestion] = useState(null);
  const [quickPrompt, setQuickPrompt] = useState("");
  const [rulePropagateModal, setRulePropagateModal] = useState(null);
  const [rulesConfirmed, setRulesConfirmed] = useState(false);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  useEffect(() => {
    if (!assignment?.id) return;
    fetchAll();
    const channel = supabase.channel(`submissions-${assignment.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "submissions", filter: `assignment_id=eq.${assignment.id}` }, () => fetchSubmissions())
      .subscribe();

    // Assignment-Änderungen beobachten — bei Lobby-Reset sofort Submissions leeren
    const assignmentChannel = supabase.channel(`assignment-reset-${assignment.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "assignments", filter: `id=eq.${assignment.id}` }, (payload) => {
        const wasReset = !payload.new.lobby_started_at && assignment.lobby_started_at;
        if (wasReset) {
          setSubmissions([]);
          setSelectedSubmission(null);
          setDetectedRules([]);
        }
      })
      .subscribe();

    // Polling als Backup — alle 5 Sek. neue Abgaben laden
    const poll = setInterval(() => { if (!aiRunning) fetchSubmissions(); }, 3000);
    return () => { supabase.removeChannel(channel); supabase.removeChannel(assignmentChannel); clearInterval(poll); };
  }, [assignment]);

  // Auto-Batch wenn neue unkorrigierte Abgaben da sind
  useEffect(() => {
    if (!assignmentData || submissions.length === 0 || aiRunning) return;
    const pending = submissions.filter(s =>
      !s.reviewed && Object.values(s.ai_corrections || {}).some(c => c.needsReview && !c.aiReviewed)
    );
    if (pending.length === 0) return;
    // Immer starten — beim ersten Mal werden Regeln nach der Korrektur analysiert
    startBatchCorrection(pending);
  }, [assignmentData, submissions.length]);

  const fetchAll = async () => {
    setLoading(true);
    await Promise.all([fetchSubmissions(), fetchGroup(), fetchTemplates(), fetchAssignmentData()]);
    setLoading(false);
  };

  const fetchAssignmentData = async () => {
    const { data } = await supabase.from("assignments").select("*").eq("id", assignment.id).single();
    setAssignmentData(data);
    setDetectedRules(data?.detected_rules || []);
    setCustomRules(data?.custom_rules || "");
    setRulesConfirmed(!!(data?.detected_rules?.length));
  };

  const fetchSubmissions = async () => {
    const { data: makeupAssignments } = await supabase.from("assignments").select("id").eq("parent_assignment_id", assignment.id);
    const allIds = [assignment.id, ...((makeupAssignments || []).map(a => a.id))];
    const { data } = await supabase.from("submissions").select("*, assignments(title)").in("assignment_id", allIds).order("submitted_at", { ascending: false });
    setSubmissions(data || []);
  };

  const fetchGroup = async () => {
    const { data } = await supabase.from("groups").select("usernames").eq("id", assignment.group_id).single();
    setGroupUsernames(data?.usernames || []);
  };

  const fetchTemplates = async () => {
    const { data } = await supabase.from("templates").select("id, title").order("created_at", { ascending: false });
    setTemplates(data || []);
  };

  const startBatchCorrection = async (pendingOverride, aDataOverride) => {
    const pending = pendingOverride || submissions.filter(s =>
      !s.reviewed && Object.values(s.ai_corrections || {}).some(c => c.needsReview && !c.aiReviewed)
    );
    if (pending.length === 0) return;
    const aData = aDataOverride || assignmentData;
    setAiRunning(true);
    setAiProgress(`🤖 KI bewertet ${pending.length} Abgabe${pending.length !== 1 ? "n" : ""}...`);

    try {
      const batchResults = await runBatchCorrection({ pending, allSubs: submissions, aData, supabaseUrl, supabaseAnonKey });
      const openQs = flattenQs(aData?.question_data || []).filter(q => q.type === "open" || q.type === "qa");

      for (const s of pending) {
        const newCorr = batchResults[s.id] || {};
        const merged = { ...(s.ai_corrections || {}), ...newCorr };
        // Fehlende offene Fragen markieren
        for (const q of openQs) {
          const qId = String(q.id);
          const hasAnswer = s.answers?.[q.id]?.trim() || s.answers?.[qId]?.trim();
          const existingNeedsReview = merged[qId]?.needsReview && !merged[qId]?.aiReviewed;
          if ((!merged[qId] || existingNeedsReview) && !hasAnswer) {
            merged[qId] = { ...(merged[qId] || {}), points: 0, correct: false, comment: "Keine Antwort gegeben.", aiReviewed: true, needsReview: false, maxPoints: Number(q.points) };
          }
        }
        let newScore = 0;
        for (const [qId, c] of Object.entries(merged)) {
          const ov = (s.manual_overrides || {})[qId];
          newScore += ov !== undefined ? Number(ov) : (c.points ?? 0);
        }
        const percent = (newScore / (s.total_points || 1)) * 100;
        const gs = [...(aData?.grading_scale || [])].sort((a, b) => b.minPercent - a.minPercent);
        let newGrade = "6";
        for (const g of gs) { if (percent >= Number(g.minPercent)) { newGrade = g.grade; break; } }
        const updatePayload = { ai_corrections: merged, score: newScore, grade: newGrade, reviewed: true };
        if (s.released) updatePayload.released = true;
        await supabase.from("submissions").update(updatePayload).eq("id", s.id);
        const updatedSub = { ...s, ...updatePayload };
        setSubmissions(prev => prev.map(sub => sub.id === s.id ? updatedSub : sub));
        if (selectedSubmission?.id === s.id) setSelectedSubmission(prev => ({ ...prev, ...updatePayload }));
      }

      setAiProgress("✅ Korrektur abgeschlossen!");

      // Regeln analysieren wenn noch keine vorhanden
      if ((aData?.detected_rules || []).length === 0) {
        setAiProgress("🔍 KI analysiert Bewertungsregeln...");
        setAnalyzingRules(true);
        // Frühere Regeln dieses Lehrers laden
        const { data: prevAssignments } = await supabase
          .from("assignments")
          .select("detected_rules")
          .eq("teacher_id", currentUser?.id)
          .neq("id", assignment.id)
          .not("detected_rules", "is", null)
          .limit(5);
        const previousRules = (prevAssignments || [])
          .flatMap(a => (a.detected_rules || []).filter(r => r.enabled && r.source !== "history"))
          .reduce((acc, r) => {
            if (!acc.find(x => x.label === r.label)) acc.push({ ...r, source: "history" });
            return acc;
          }, []);

        const allSubsNow = await supabase.from("submissions").select("*").in("id", pending.map(s => s.id));
        const rules = await analyzeRules({
          allSubs: allSubsNow.data || pending,
          aData,
          previousRules,
          supabaseUrl,
          supabaseAnonKey,
        });
        if (rules) {
          await supabase.from("assignments").update({ detected_rules: rules }).eq("id", aData.id);
          setDetectedRules(rules);
          setAssignmentData(prev => ({ ...prev, detected_rules: rules }));
          setRulesConfirmed(true);

          // Regeln in Vorlage übertragen — entfernt (Regeln bleiben im Assignment)
        }
        setAnalyzingRules(false);
      }

      setTimeout(() => { setAiProgress(""); setAiRunning(false); setReleaseModal(true); }, 2000);

      // Niedrige Konfidenz-Fälle pro Aufgabe sammeln und Kalibrierung anbieten
      const LOW_CONF = 0.72;
      const qMap = {};
      submissions.forEach(s => {
        Object.entries(s.ai_corrections || {}).forEach(([qId, c]) => {
          if ((c.confidence ?? 1) < LOW_CONF && c.aiReviewed) {
            if (!qMap[qId]) qMap[qId] = { qId, cases: [] };
            qMap[qId].cases.push({ subId: s.id, username: s.username, answer: s.answers?.[qId] || "–", points: c.points, maxPoints: c.maxPoints });
          }
        });
      });
      const lowConfQs = Object.values(qMap).filter(q => q.cases.length >= 2);
      if (lowConfQs.length > 0) {
        const first = lowConfQs[0];
        const qData = flattenQs(aData?.question_data || []).find(q => String(q.id) === first.qId);
        setTimeout(() => setCalibration({ ...first, qText: qData?.text?.replace(/<[^>]+>/g, "") || "", solution: qData?.solution || "", examples: {} }), 2500);
      }
    } catch (e) {
      setAiProgress("❌ Fehler bei der Korrektur.");
      setTimeout(() => { setAiProgress(""); setAiRunning(false); }, 3000);
    }
  };


  const runCalibrationCorrection = async () => {
    if (!calibration) return;
    const { qId, solution, examples } = calibration;
    const qData = flattenQs(assignmentData?.question_data || []).find(q => String(q.id) === qId);
    if (!qData) return;

    setAiProgress("🎯 Kalibrierte Neu-Korrektur läuft...");
    setAiRunning(true);
    setCalibration(null);

    const exampleLines = Object.entries(examples)
      .map(([subId, pts]) => {
        const s = submissions.find(s => s.id === subId);
        return s ? `- "${s.answers?.[qId] || "–"}" → ${pts} / ${qData.points} Pkt. (Lehrer)` : null;
      })
      .filter(Boolean).join("
");

    const toRecorrect = submissions.filter(s => s.ai_corrections?.[qId]?.aiReviewed && !examples[s.id]);

    const answers = toRecorrect
      .filter(s => s.answers?.[qId]?.trim())
      .map((s, i) => `${i + 1}. ${s.username}: "${s.answers[qId]}"`).join("
");
    if (!answers) { setAiRunning(false); setAiProgress(""); return; }

    const prompt = `Du bewertest Schülerantworten. Passe deinen Maßstab an diese Lehrer-Beispiele an:

${exampleLines}

Frage: ${qData.text?.replace(/<[^>]+>/g, "") || ""}
Musterlösung: ${solution}
Max. Punkte: ${qData.points}

Bewerte jetzt konsistent nach demselben Maßstab:
${answers}

Antworte NUR als JSON: {"results": [{"username": "<n>", "points": <Zahl>, "comment": "<1 Satz>"}]}`;

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/anthropic-proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseAnonKey}`, "apikey": supabaseAnonKey },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await res.json();
      const text = data.content?.map(b => b.text || "").join("") || "";
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      const results = parsed.results || [];

      for (const r of results) {
        const s = toRecorrect.find(s => s.username === r.username);
        if (!s) continue;
        const newPoints = Math.min(Math.max(0, Number(r.points)), Number(qData.points));
        const updated = {
          ...s.ai_corrections,
          [qId]: { ...s.ai_corrections[qId], points: newPoints, comment: `🤖 ${r.comment}`, correct: newPoints >= Number(qData.points), confidence: 0.95 }
        };
        const newScore = Object.entries(updated).reduce((sum, [, c]) => sum + (c.points ?? 0), 0);
        const total = flattenQs(assignmentData?.question_data || []).reduce((sum, q) => sum + Number(q.points || 0), 0);
        const newGrade = calcGrade(newScore, total);
        await supabase.from("submissions").update({ ai_corrections: updated, score: newScore, grade: newGrade }).eq("id", s.id);
        setSubmissions(prev => prev.map(sub => sub.id === s.id ? { ...sub, ai_corrections: updated, score: newScore, grade: newGrade } : sub));
      }
      setAiProgress("✅ Kalibrierte Korrektur abgeschlossen.");
      setTimeout(() => { setAiProgress(""); setAiRunning(false); }, 2000);
    } catch (e) {
      setAiProgress("❌ Fehler bei der Neu-Korrektur.");
      setTimeout(() => { setAiProgress(""); setAiRunning(false); }, 2000);
    }
  };

  const saveAllRules = async (newDetected, newCustom) => {
    setSavingRules(true);
    setDetectedRules(newDetected);
    setCustomRules(newCustom);
    await supabase.from("assignments").update({ detected_rules: newDetected, custom_rules: newCustom }).eq("id", assignment.id);
    const updatedAData = { ...assignmentData, detected_rules: newDetected, custom_rules: newCustom };
    setAssignmentData(updatedAData);
    const toReset = submissions.map(s => ({
      ...s,
      ai_corrections: Object.fromEntries(Object.entries(s.ai_corrections || {}).map(([k, v]) => [k, { ...v, aiReviewed: false, needsReview: true }])),
      reviewed: false,
    }));
    await startBatchCorrection(toReset, updatedAData);
    setSavingRules(false);
  };

  const toggleRuleInPanel = async (rule, newEnabled) => {
    const sameLabel = detectedRules.filter(r => r.label === rule.label && r.id !== rule.id);
    if (sameLabel.length > 0) {
      setRulePropagateModal({ rule, newEnabled, sameLabel });
      return;
    }
    const updatedRules = detectedRules.map(r => r.id === rule.id ? { ...r, enabled: newEnabled } : r);
    setDetectedRules(updatedRules);

    // Wenn eine Lehrer-Regel deaktiviert wird: die zugehörigen partialPoints aus question_data entfernen
    if (!newEnabled && rule.source === "teacher" && rule.taskId) {
      const removeFromQd = (qs) => (qs || []).map(q => {
        if (String(q.id) === String(rule.taskId)) return { ...q, partialPoints: [] };
        if (q.tasks) return { ...q, tasks: q.tasks.map(t => ({ ...t, questions: (t.questions||[]).map(tq => String(tq.id) === String(rule.taskId) ? { ...tq, partialPoints: [] } : tq) })) };
        if (q.questions) return { ...q, questions: removeFromQd(q.questions) };
        return q;
      });
      const updatedQd = removeFromQd(assignmentData?.question_data || []);
      await supabase.from("assignments").update({ question_data: updatedQd, detected_rules: updatedRules }).eq("id", assignmentData.id);
      if (assignmentData?.template_id) {
        const { data: tmpl } = await supabase.from("templates").select("question_data").eq("id", assignmentData.template_id).single();
        if (tmpl) await supabase.from("templates").update({ question_data: removeFromQd(tmpl.question_data) }).eq("id", assignmentData.template_id);
      }
      setAssignmentData(prev => ({ ...prev, question_data: updatedQd, detected_rules: updatedRules }));
    }
  };

  const applyRulePropagation = (propagate) => {
    if (!rulePropagateModal) return;
    const { rule, newEnabled, sameLabel } = rulePropagateModal;
    const ids = new Set([rule.id, ...(propagate ? sameLabel.map(r => r.id) : [])]);
    setDetectedRules(prev => prev.map(r => ids.has(r.id) ? { ...r, enabled: newEnabled } : r));
    setRulePropagateModal(null);
  };


  const processScan = async () => {
    if (!scanFile) return;
    setScanProcessing(true);
    setScanError("");
    setScanResult(null);
    try {
      const fileExt = scanFile.name.split(".").pop().toLowerCase();
      const mimeType = fileExt === "pdf" ? "application/pdf"
        : fileExt === "png" ? "image/png"
        : "image/jpeg";

      // Datei → base64
      setScanProcessingStep("Datei wird vorbereitet...");
      const fileBase64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result.split(",")[1]);
        reader.onerror = rej;
        reader.readAsDataURL(scanFile);
      });

      // Edge Function erledigt OCR komplett serverseitig
      setScanProcessingStep("Handschrift wird erkannt...");
      const visionRes = await fetch(
        `${supabaseUrl}/functions/v1/vision-ocr`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseAnonKey}`,
            "apikey": supabaseAnonKey,
          },
          body: JSON.stringify({ imageBase64: fileBase64, mimeType })
        }
      );
      const visionData = await visionRes.json();
      if (visionData.error) throw new Error(`OCR: ${visionData.error}`);
      const ocrText = visionData.text || "";
      if (!ocrText.trim()) throw new Error("Kein Text erkannt — bitte prüfe ob der Scan lesbar ist");

      // Direkte Extraktion ohne LLM — kein Autokorrektur-Risiko
      setScanProcessingStep("Antworten werden zugeordnet...");
      const testCode = String(assignmentData?.id || "").slice(-6).toUpperCase();
      const openQs = flattenQs(assignmentData?.question_data || []).filter(q => q.type === "qa" || q.type === "open");

      // Bekannte gedruckte Zeilen die NICHT Antworten sind
      const printedLines = new Set([
        "vokabeltest", "datum", "gesamt", "seite", "quicktest",
        "übersetze", "vocabulary", "zeit", "pkt", "punkte",
        ...(openQs.map(q => q.text?.replace(/<[^>]+>/g, "").toLowerCase().trim() || "")),
        ...(assignmentData?.question_data || []).flatMap(t =>
          [t.taskTitle?.toLowerCase() || "", t.taskText?.toLowerCase() || ""]
        )
      ]);

      const isPrinted = (line) => {
        const l = line.toLowerCase().trim();
        if (!l || l.length < 2) return true;
        if (l.match(/^\/\d+\s*pkt/i)) return true;           // /1 Pkt.
        if (l.match(/^\d+\.\d*/)) return true;               // 1.1, 1.2 etc.
        if (l.match(/^seite\s+\d+/i)) return true;            // Seite 2 von 29
        if (l.match(/schüler:/i)) return true;                  // [SCHÜLER:...]
        if (l.match(/^datum:/i)) return true;
        if (l.match(/^edit with/i)) return true;
        // Prüfe ob Zeile einer bekannten gedruckten Zeile ähnelt
        return [...printedLines].some(p => p && l.includes(p.slice(0, 6)));
      };

      // Seiten aufteilen — Vision trennt Seiten mit SEITENUMBRUCH
      // WICHTIG: Marker steht am ENDE jeder Seite (Vision liest Header zuletzt)
      const markerRe = /[\[|r]?S[CK]H[ÜU]LER:?\s*([^|\]\n]+)[|\]]?\s*TEST:?\s*([^\]|\n\r]+)/i;
      const rawPages = ocrText.split(/---\s*SEITENUMBRUCH\s*---/i);
      const parsed = [];

      const extractFromPage = (pageText) => {
        const mm = pageText.match(markerRe);
        if (!mm) return null;
        const studentName = mm[1].trim().replace(/^[-\s]+|[-\s]+$/g, "");
        if (!studentName || studentName.length < 2) return null;
        const answerLines = pageText.split("\n")
          .map(l => l.trim())
          .filter(l => l.length >= 1 && !isPrinted(l) && l !== studentName);
        const answers = {};
        openQs.forEach((q, qi) => { answers[String(q.id)] = answerLines[qi] || ""; });
        return { student: studentName, answers };
      };

      for (const rawPage of rawPages) {
        const result = extractFromPage(rawPage);
        if (result) parsed.push(result);
      }

      if (parsed.length === 0) {
        // Fallback: gesamter Text ist eine Seite
        const result = extractFromPage(ocrText);
        if (result) parsed.push(result);
      }

      if (parsed.length === 0) throw new Error("Keine Schüler erkannt. Enthält der Scan den Code [SCHÜLER: name | TEST: " + testCode + "]?");

      setScanDebug(ocrText.slice(0, 1000));
      setScanResult(parsed);
    } catch (e) {
      setScanError(`Fehler: ${e.message}`);
    }
    setScanProcessing(false);
    setScanProcessingStep("");
  };


  const applyScanResult = async () => {
    if (!scanResult) return;
    setScanProcessing(true);
    try {
      // Für jeden erkannten Schüler: Submission erstellen oder updaten
      const { data: existingSubs } = await supabase
        .from("submissions").select("id, username, answers")
        .eq("assignment_id", assignmentData.id);
      const subMap = {};
      (existingSubs || []).forEach(s => { subMap[s.username] = s; });

      const openQs = flattenQs(assignmentData?.question_data || []).filter(q => q.type === "qa" || q.type === "open");
      const totalPoints = flattenQs(assignmentData?.question_data || []).reduce((s, q) => s + Number(q.points || 0), 0);

      for (const { student, answers } of scanResult) {
        const existing = subMap[student];
        if (existing) {
          // Antworten aktualisieren
          await supabase.from("submissions").update({
            answers: { ...(existing.answers || {}), ...answers },
            reviewed: false,
          }).eq("id", existing.id);
        } else {
          // Neue Submission anlegen
          const { data: studentData } = await supabase
            .from("students").select("id")
            .eq("username", student).eq("group_id", assignmentData.group_id).single();
          if (studentData) {
            await supabase.from("submissions").insert({
              assignment_id: assignmentData.id,
              student_id: studentData.id,
              username: student,
              answers,
              score: 0,
              total_points: totalPoints,
              grade: null,
              ai_corrections: {},
              reviewed: false,
              cheat_log: [],
            });
          }
        }
      }

      // Submissions neu laden
      const { data: freshSubs } = await supabase
        .from("submissions").select("*")
        .eq("assignment_id", assignmentData.id);
      const updated = freshSubs || [];
      setSubmissions(updated);

      // Batch-Korrektur direkt starten
      const toCorrect = updated.filter(s =>
        !s.reviewed && Object.keys(s.ai_corrections || {}).length === 0
      );
      if (toCorrect.length > 0) {
        setScanModal(false);
        setScanFile(null);
        setScanResult(null);
        startBatchCorrection(toCorrect);
      } else {
        setScanModal(false);
        setScanFile(null);
        setScanResult(null);
      }
    } catch (e) {
      setScanError(`Fehler beim Speichern: ${e.message}`);
    }
    setScanProcessing(false);
  };

  const saveOverrides = async () => {
    if (!selectedSubmission) return;
    setSaving(true);
    const updatedOverrides = { ...selectedSubmission.manual_overrides, ...overrides };
    // Apply maxPoint edits to corrections
    const corrections = { ...(selectedSubmission.ai_corrections || {}) };
    if (Object.keys(maxPointEdits).length > 0) {
      for (const [qId, newMax] of Object.entries(maxPointEdits)) {
        if (corrections[qId]) corrections[qId] = { ...corrections[qId], maxPoints: newMax };
      }
    }
    let newScore = 0;
    for (const [qId, correction] of Object.entries(corrections)) {
      if (updatedOverrides[qId] !== undefined) newScore += Number(updatedOverrides[qId]);
      else newScore += correction.points ?? 0;
    }
    const percent = (newScore / (selectedSubmission.total_points || 1)) * 100;
    const { data: aData } = await supabase.from("assignments").select("grading_scale").eq("id", selectedSubmission.assignment_id).single();
    const gs = [...(aData?.grading_scale || [])].sort((a, b) => b.minPercent - a.minPercent);
    let newGrade = "6";
    for (const g of gs) { if (percent >= Number(g.minPercent)) { newGrade = g.grade; break; } }

    // Wenn bereits freigegeben: Änderung sofort für Schüler sichtbar (released bleibt true)
    const wasReleased = selectedSubmission.released;
    // Lehrer-Kommentare in Korrekturen einarbeiten
    if (Object.keys(teacherComments).length > 0) {
      for (const [qId, tc] of Object.entries(teacherComments)) {
        if (corrections[qId]) corrections[qId] = { ...corrections[qId], teacherComment: tc || null };
      }
    }
    const updatedCorrections = (Object.keys(maxPointEdits).length > 0 || Object.keys(teacherComments).length > 0) ? corrections : undefined;
    await supabase.from("submissions").update({
      manual_overrides: updatedOverrides,
      score: newScore,
      grade: newGrade,
      reviewed: true,
      ...(wasReleased ? { released: true } : {}),
      ...(updatedCorrections ? { ai_corrections: updatedCorrections } : {}),
    }).eq("id", selectedSubmission.id);

    const updated = { ...selectedSubmission, manual_overrides: updatedOverrides, score: newScore, grade: newGrade, reviewed: true, ai_corrections: corrections };
    setSubmissions(prev => prev.map(s => s.id === selectedSubmission.id ? updated : s));
    setOverrides({});
    setMaxPointEdits({});
    setTeacherComments({});
    setSaving(false);
    setSelectedSubmission(null);

    // Kurze Bestätigung wenn bereits freigegeben
    if (wasReleased) {
      setAiProgress("✅ Gespeichert — Schüler sieht die aktualisierte Bewertung sofort.");
      setTimeout(() => setAiProgress(""), 3000);
    }
  };

  const releaseSubmissions = async (ids) => {
    await Promise.all(ids.map(id => supabase.from("submissions").update({ released: true }).eq("id", id)));
    setSubmissions(prev => prev.map(s => ids.includes(s.id) ? { ...s, released: true } : s));
    if (selectedSubmission && ids.includes(selectedSubmission.id)) setSelectedSubmission(prev => ({ ...prev, released: true }));
  };

  const releaseAll = () => releaseSubmissions(submissions.map(s => s.id));

  const handleSuggestRubric = async (question) => {
    setSuggestingRubric(true);
    const result = await suggestRubric({ question, submissions, supabaseUrl, supabaseAnonKey });
    if (result?.partialPoints?.length) setRubricModal({ question, suggested: result.partialPoints });
    setSuggestingRubric(false);
  };

  const saveRubricToTemplate = async (modal) => {
    if (!modal || !assignmentData?.template_id) return;
    setSavingRubric(true);
    const updateQd = (qs) => (qs || []).map(q => {
      if (String(q.id) === String(modal.question.id)) return { ...q, partialPoints: modal.suggested };
      if (q.tasks) return { ...q, tasks: q.tasks.map(t => ({ ...t, questions: (t.questions || []).map(tq => String(tq.id) === String(modal.question.id) ? { ...tq, partialPoints: modal.suggested } : tq) })) };
      if (q.questions) return { ...q, questions: updateQd(q.questions) };
      return q;
    });
    const { data: tmpl } = await supabase.from("templates").select("question_data").eq("id", assignmentData.template_id).single();
    if (tmpl) await supabase.from("templates").update({ question_data: updateQd(tmpl.question_data) }).eq("id", assignmentData.template_id);
    const updatedAsgn = updateQd(assignmentData.question_data || []);
    await supabase.from("assignments").update({ question_data: updatedAsgn }).eq("id", assignmentData.id);
    setAssignmentData(prev => ({ ...prev, question_data: updatedAsgn }));
    setRubricModal(null);
    setSavingRubric(false);
    // Alle neu korrigieren mit dem Maßstab
    const toReset = submissions.map(s => ({
      ...s,
      ai_corrections: Object.fromEntries(Object.entries(s.ai_corrections || {}).map(([k, v]) => [k, { ...v, aiReviewed: false, needsReview: true }])),
      reviewed: false,
    }));
    await startBatchCorrection(toReset, { ...assignmentData, question_data: updatedAsgn });
  };



  const saveSolution = async (qId, newSolution) => {
    setSavingSolution(qId);
    const updateQd = (qs) => (qs || []).map(q => {
      if (String(q.id) === qId) return { ...q, solution: newSolution };
      if (q.tasks) return { ...q, tasks: q.tasks.map(t => ({ ...t, questions: (t.questions||[]).map(tq => String(tq.id) === qId ? { ...tq, solution: newSolution } : tq) })) };
      if (q.questions) return { ...q, questions: updateQd(q.questions) };
      return q;
    });
    const updatedQd = updateQd(assignmentData?.question_data || []);
    await supabase.from("assignments").update({ question_data: updatedQd }).eq("id", assignmentData.id);
    if (assignmentData?.template_id) {
      const { data: tmpl } = await supabase.from("templates").select("question_data").eq("id", assignmentData.template_id).single();
      if (tmpl) await supabase.from("templates").update({ question_data: updateQd(tmpl.question_data) }).eq("id", assignmentData.template_id);
    }
    setAssignmentData(prev => ({ ...prev, question_data: updatedQd }));
    setSolutionEdits(prev => { const next = { ...prev }; delete next[qId]; return next; });
    setSavingSolution(null);
    // Alle Abgaben neu korrigieren
    const toReset = submissions.map(s => ({ ...s, ai_corrections: Object.fromEntries(Object.entries(s.ai_corrections||{}).map(([k,v])=>[k,{...v,aiReviewed:false,needsReview:true}])), reviewed: false }));
    startBatchCorrection(toReset, { ...assignmentData, question_data: updatedQd });
  };

  const refineQuestionWithFeedback = async (qId, feedbackText) => {
    setRefiningQuestion(qId);
    try {
      const q = flattenQs(assignmentData?.question_data || []).find(q => String(q.id) === String(qId));
      if (!q) return;
      const answers = submissions.filter(s => s.answers?.[qId]?.trim()).map(s => s.answers[qId]);
      const currentCriteria = (q.partialPoints || []).map(p => `- ${p.points} Pkt.: ${p.description}`).join("\n");
      const prompt = `Überarbeite den Bewertungsmaßstab basierend auf dem Feedback.
Frage: ${q.text || ""}\nMusterlösung: ${q.solution || ""}\nPunkte: ${q.points}
${currentCriteria ? `Aktuell:\n${currentCriteria}` : ""}
Schülerantworten: ${answers.map((a, i) => `${i+1}."${a}"`).join(", ")}
Feedback: ${feedbackText}
Summe muss ${q.points} Punkte ergeben. Gib NUR JSON zurück:
{"partialPoints": [{"points": <Zahl>, "description": "<Kriterium>"}]}`;
      const res = await fetch(`${supabaseUrl}/functions/v1/anthropic-proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseAnonKey}`, "apikey": supabaseAnonKey },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await res.json();
      const text = data.content?.map(b => b.text || "").join("") || "";
      const result = JSON.parse(text.replace(/```json|```/g, "").trim());
      if (!result?.partialPoints?.length) return;
      const updateQd = (qs) => (qs || []).map(q2 => {
        if (String(q2.id) === String(qId)) return { ...q2, partialPoints: result.partialPoints };
        if (q2.tasks) return { ...q2, tasks: q2.tasks.map(t => ({ ...t, questions: (t.questions || []).map(tq => String(tq.id) === String(qId) ? { ...tq, partialPoints: result.partialPoints } : tq) })) };
        if (q2.questions) return { ...q2, questions: updateQd(q2.questions) };
        return q2;
      });
      if (assignmentData?.template_id) {
        const { data: tmpl } = await supabase.from("templates").select("question_data").eq("id", assignmentData.template_id).single();
        if (tmpl) await supabase.from("templates").update({ question_data: updateQd(tmpl.question_data) }).eq("id", assignmentData.template_id);
      }
      const updatedAsgn = updateQd(assignmentData?.question_data || []);
      await supabase.from("assignments").update({ question_data: updatedAsgn }).eq("id", assignmentData.id);
      setAssignmentData(prev => ({ ...prev, question_data: updatedAsgn }));

      // Regel als Toggle-Chip in detected_rules speichern
      const newRule = {
        id: `teacher_${Date.now()}`,
        label: feedbackText.length > 50 ? feedbackText.slice(0, 47) + "…" : feedbackText,
        description: feedbackText,
        enabled: true,
        scope: "task",
        taskId: String(qId),
        taskIds: [String(qId)],
        source: "teacher",
      };
      const updatedRules = [...detectedRules, newRule];
      setDetectedRules(updatedRules);
      await supabase.from("assignments").update({ detected_rules: updatedRules }).eq("id", assignmentData.id);
      setAssignmentData(prev => ({ ...prev, detected_rules: updatedRules }));

      setQuestionFeedback(prev => ({ ...prev, [qId]: "" }));
      const toReset = submissions.map(s => ({
        ...s,
        ai_corrections: Object.fromEntries(Object.entries(s.ai_corrections || {}).map(([k, v]) => [k, { ...v, aiReviewed: false, needsReview: true }])),
        reviewed: false,
      }));
      await startBatchCorrection(toReset, { ...assignmentData, question_data: updatedAsgn, detected_rules: updatedRules });
    } catch (e) { console.error("Refine failed", e); }
    setRefiningQuestion(null);
  };

  const applyQuickPrompt = async (promptText) => {
    if (!promptText.trim() || !selectedSubmission) return;
    setRefiningQuestion("all");
    try {
      const openQs = flattenQs(assignmentData?.question_data || []).filter(q => q.type === "open" || q.type === "qa");
      const corrections = selectedSubmission.ai_corrections || {};
      const answersBlock = openQs.map(q => {
        const ans = selectedSubmission.answers?.[q.id] || "(keine Antwort)";
        const c = corrections[q.id];
        return `ID:${q.id} Frage:${q.text || ""} | Musterlösung:${q.solution || ""} | Antwort:${ans} | Aktuell:${c?.points ?? "–"}/${q.points} Pkt.`;
      }).join("\n");
      const prompt = `Überarbeite Korrekturen für einen Schüler.\n${answersBlock}\nAnweisung: ${promptText}\nGib JSON zurück: [{"qId":"<id>","points":<Zahl>,"comment":"<Begründung>"}]`;
      const res = await fetch(`${supabaseUrl}/functions/v1/anthropic-proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseAnonKey}`, "apikey": supabaseAnonKey },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 2000, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await res.json();
      const text = data.content?.map(b => b.text || "").join("") || "";
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      const newCorrections = { ...corrections };
      let newScore = 0;
      for (const r of parsed) {
        const q = openQs.find(q => String(q.id) === String(r.qId));
        if (!q) continue;
        newCorrections[r.qId] = { ...(corrections[r.qId] || {}), points: Math.min(Math.max(0, Number(r.points)), Number(q.points)), comment: `🤖 ${r.comment}`, aiReviewed: true, needsReview: false, correct: Number(r.points) >= Number(q.points), maxPoints: Number(q.points) };
      }
      for (const [qId, c] of Object.entries(newCorrections)) {
        const ov = (selectedSubmission.manual_overrides || {})[qId];
        newScore += ov !== undefined ? Number(ov) : (c.points ?? 0);
      }
      const percent = (newScore / (selectedSubmission.total_points || 1)) * 100;
      const gs = [...(assignmentData?.grading_scale || [])].sort((a, b) => b.minPercent - a.minPercent);
      let newGrade = "6";
      for (const g of gs) { if (percent >= Number(g.minPercent)) { newGrade = g.grade; break; } }
      const quickUpdatePayload = { ai_corrections: newCorrections, score: newScore, grade: newGrade, reviewed: true };
      if (selectedSubmission.released) quickUpdatePayload.released = true;
      await supabase.from("submissions").update(quickUpdatePayload).eq("id", selectedSubmission.id);
      const updated = { ...selectedSubmission, ...quickUpdatePayload };
      setSubmissions(prev => prev.map(s => s.id === selectedSubmission.id ? updated : s));
      setSelectedSubmission(updated);

      // Schnell-Prompt als globale Toggle-Regel speichern
      const newGlobalRule = {
        id: `teacher_global_${Date.now()}`,
        label: promptText.length > 50 ? promptText.slice(0, 47) + "…" : promptText,
        description: promptText,
        enabled: true,
        scope: "all",
        taskIds: flattenQs(assignmentData?.question_data || []).filter(q => q.type === "open" || q.type === "qa").map(q => String(q.id)),
        source: "teacher",
      };
      const updatedRulesGlobal = [...detectedRules, newGlobalRule];
      setDetectedRules(updatedRulesGlobal);
      await supabase.from("assignments").update({ detected_rules: updatedRulesGlobal }).eq("id", assignmentData.id);

      setQuickPrompt("");
    } catch (e) { console.error("Quick prompt failed", e); }
    setRefiningQuestion(null);
  };

  const createMakeupTest = async () => {
    if (!makeupTemplateId || makeupSelected.size === 0) return;
    setCreatingMakeup(true);
    const { data: t } = await supabase.from("templates").select("*").eq("id", makeupTemplateId).single();
    await supabase.from("assignments").insert({
      template_id: Number(makeupTemplateId), group_id: assignment.group_id, teacher_id: currentUser?.id,
      title: `${t.title} (Nachtest)`, status: "aktiv", time_limit: makeupTimeLimit * 60,
      timing_mode: "lobby", anti_cheat: makeupAntiCheat, require_seb: makeupRequireSeb,
      question_data: t.question_data, grading_scale: t.grading_scale || assignment.grading_scale,
      parent_assignment_id: assignment.id, makeup_usernames: [...makeupSelected],
    });
    setCreatingMakeup(false);
    setMakeupModal(false);
    setMakeupSelected(new Set());
    await fetchSubmissions();
  };

  const submittedUsernames = new Set(submissions.map(s => s.username));
  const relevantUsernames = assignment?.makeup_usernames?.length ? assignment.makeup_usernames : groupUsernames;
  const missingStudents = [...relevantUsernames].sort((a, b) => a.localeCompare(b, "de")).filter(u => !submittedUsernames.has(u));
  const participated = submissions.filter(s => !s.not_participated);
  const avg = participated.length > 0
    ? (participated.reduce((s, r) => s + ((r.score || 0) / (r.total_points || 1)) * 100, 0) / participated.length).toFixed(1)
    : null;

  if (!assignment) return (
    <TeacherLayout navigate={navigate} onLogout={onLogout} currentUser={currentUser} activePage="results">
      <div style={{ padding: "32px", color: "#94a3b8", textAlign: "center" }}>Kein Test ausgewählt.</div>
    </TeacherLayout>
  );

  return (
    <TeacherLayout navigate={navigate} onLogout={onLogout} currentUser={currentUser} activePage="results">
      <div style={{ padding: "32px", maxWidth: "960px" }}>
        <div style={{ marginBottom: "28px" }}>
          <button onClick={() => navigate("dashboard")} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "13px", marginBottom: "8px", padding: 0 }}>← Zurück zum Dashboard</button>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: 0 }}>{assignment.title}</h1>
          <p style={{ color: "#64748b", fontSize: "14px", marginTop: "4px" }}>
            {submissions.length} Abgaben{avg ? ` · Ø ${avg}%` : ""}
            <button onClick={fetchSubmissions} style={{ marginLeft: "12px", background: "none", border: "none", color: "#2563a8", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>🔄 Aktualisieren</button>
            <button onClick={() => setScanModal(true)} style={{ marginLeft: "8px", padding: "4px 12px", background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0", borderRadius: "7px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>📄 Scan hochladen</button>
            {submissions.some(s => !s.released) && (
              <button onClick={releaseAll} style={{ marginLeft: "12px", padding: "4px 12px", background: "#16a34a", color: "#fff", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>✓ Alle freigeben</button>
            )}
          </p>
        </div>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

        {loading ? (
          <div style={{ padding: "48px", textAlign: "center", color: "#94a3b8" }}>Wird geladen...</div>
        ) : (
          <>
            {missingStudents.length > 0 && (
              <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "14px", padding: "18px 20px", marginBottom: "20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: "#92400e" }}>⚠️ {missingStudents.length} Schüler/in{missingStudents.length !== 1 ? "nen haben" : " hat"} nicht teilgenommen</div>
                  <button onClick={() => { setMakeupModal(true); setMakeupSelected(new Set(missingStudents)); setMakeupTemplateId(""); setMakeupTimeLimit(Math.round((assignment.time_limit || 1200) / 60)); setMakeupAntiCheat(assignment.anti_cheat || false); }}
                    style={{ padding: "7px 14px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
                    + Nachtest erstellen
                  </button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {missingStudents.map(u => <span key={u} style={{ background: "#fff", border: "1px solid #fde68a", borderRadius: "6px", padding: "4px 10px", fontSize: "13px", fontWeight: 600, color: "#374151" }}>{u}</span>)}
                </div>
              </div>
            )}

            {submissions.length === 0 && relevantUsernames.length === 0 ? (
              <div style={{ background: "#fff", borderRadius: "16px", padding: "48px", textAlign: "center", border: "1px solid #e2e8f0", color: "#94a3b8" }}>
                <div style={{ fontSize: "40px", marginBottom: "12px" }}>📭</div>
                <div style={{ fontWeight: 600 }}>Noch keine Abgaben</div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "20px" }}>
                <div style={{ background: "#fff", borderRadius: "16px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        {["Nr.", "Schüler/in", "Punkte", "Note", "Status", "Freigabe", ""].map(h => (
                          <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "#94a3b8", borderBottom: "1px solid #f1f5f9" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        // Alle Gruppenmitglieder alphabetisch — fehlende als Platzhalter
                        const subMap = {};
                        submissions.forEach(s => { subMap[s.username] = s; });
                        const allNames = [...new Set([
                          ...(relevantUsernames || []),
                          ...submissions.map(s => s.username)
                        ])].sort((a, b) => a.localeCompare(b, "de"));

                        return allNames.map((username, i) => {
                          const s = subMap[username];
                          const isPlaceholder = !s;

                          if (isPlaceholder) {
                            return (
                              <tr key={username} style={{ borderBottom: i < allNames.length - 1 ? "1px solid #f8fafc" : "none", opacity: 0.45 }}>
                                <td style={{ padding: "13px 16px", fontSize: "12px", color: "#94a3b8", fontWeight: 600 }}>{i + 1}.</td>
                                <td style={{ padding: "13px 16px", fontWeight: 600, fontSize: "14px", color: "#94a3b8" }}>{username}</td>
                                <td colSpan={5} style={{ padding: "13px 16px", fontSize: "12px", color: "#94a3b8", fontStyle: "italic" }}>nicht teilgenommen</td>
                              </tr>
                            );
                          }

                        const hasAiPending = Object.values(s.ai_corrections || {}).some(c => c.needsReview && !c.aiReviewed);
                        return (
                          <tr key={s.id} style={{ borderBottom: i < allNames.length - 1 ? "1px solid #f8fafc" : "none", background: selectedSubmission?.id === s.id ? "#f0f7ff" : "transparent" }}>
                            <td style={{ padding: "13px 16px", fontSize: "12px", color: "#94a3b8", fontWeight: 600 }}>{i + 1}.</td>
                            <td style={{ padding: "13px 16px", fontWeight: 600, fontSize: "14px", color: "#0f172a" }}>
                              {s.username}
                              {s.cheat_log?.length > 0 && <span title={`${s.cheat_log.length}× Tab-Wechsel`} style={{ marginLeft: "6px", fontSize: "11px", background: "#fef2f2", color: "#dc2626", borderRadius: "4px", padding: "1px 6px", fontWeight: 700 }}>⚠️ {s.cheat_log.length}×</span>}
                              {s.assignments?.title !== assignment.title && <span style={{ marginLeft: "6px", fontSize: "10px", background: "#f0f7ff", color: "#2563a8", borderRadius: "4px", padding: "1px 6px" }}>Nachtest</span>}
                            </td>
                            <td style={{ padding: "13px 16px", fontSize: "14px" }}>
                              <span style={{ fontWeight: 700 }}>{s.score ?? "–"}</span>
                              {s.total_points && <span style={{ color: "#94a3b8", fontSize: "12px" }}>/{s.total_points}</span>}
                            </td>
                            <td style={{ padding: "13px 16px" }}>
                              {s.grade ? <span style={{ fontWeight: 800, fontSize: "18px", color: GRADE_COLOR[s.grade] || "#374151" }}>{s.grade}</span> : <span style={{ color: "#94a3b8" }}>–</span>}
                            </td>
                            <td style={{ padding: "13px 16px" }}>
                              {(() => {
                              const openRequests = Object.values(s.correction_requests || {}).filter(r => r.status === "open").length;
                              return openRequests > 0 ? (
                                <span style={{ background: "#fff7ed", color: "#ea580c", borderRadius: "6px", padding: "3px 8px", fontSize: "12px", fontWeight: 600, marginRight: "6px" }}>
                                  🔁 {openRequests} Anfrage{openRequests > 1 ? "n" : ""}
                                </span>
                              ) : null;
                            })()}
                            {aiRunning && !s.reviewed
                                ? <span style={{ background: "#eff6ff", color: "#2563a8", borderRadius: "6px", padding: "3px 8px", fontSize: "12px", fontWeight: 600, display: "flex", alignItems: "center", gap: "5px" }}>
                                    <div style={{ width: "10px", height: "10px", border: "2px solid #bfdbfe", borderTop: "2px solid #2563a8", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
                                    KI korrigiert
                                  </span>
                                : s.reviewed
                                ? <span style={{ background: "#dcfce7", color: "#16a34a", borderRadius: "6px", padding: "3px 8px", fontSize: "12px", fontWeight: 600 }}>✓ Geprüft</span>
                                : hasAiPending
                                ? <span style={{ background: "#eff6ff", color: "#2563a8", borderRadius: "6px", padding: "3px 8px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }} onClick={() => startBatchCorrection([s])}>🤖 KI wiederholen</span>
                                : <span style={{ background: "#fef9c3", color: "#ca8a04", borderRadius: "6px", padding: "3px 8px", fontSize: "12px", fontWeight: 600 }}>Offen</span>}
                            </td>
                            <td style={{ padding: "13px 16px" }}>
                              {s.not_participated
                                ? <span style={{ fontSize: "11px", color: "#94a3b8", fontStyle: "italic" }}>–</span>
                                : s.released
                                ? <span style={{ background: "#dcfce7", color: "#16a34a", borderRadius: "6px", padding: "3px 8px", fontSize: "12px", fontWeight: 600 }}>✓ Freigegeben</span>
                                : <button onClick={() => releaseSubmissions([s.id])} style={{ padding: "4px 10px", background: "#f0f7ff", color: "#2563a8", border: "1px solid #bfdbfe", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>Freigeben</button>}
                            </td>
                            <td style={{ padding: "13px 16px" }}>
                              {!s.not_participated && (
                                <button onClick={async () => {
                                  // Frische Daten inkl. correction_requests laden
                                  const { data: fresh } = await supabase.from("submissions").select("*").eq("id", s.id).single();
                                  const sub = { ...(fresh || s), assignments: s.assignments };
                                  setSelectedSubmission(sub);
                                  setOverrides({});
                                  setMaxPointEdits({});
                                  const initComments = {};
                                  Object.entries(sub.ai_corrections || {}).forEach(([qId, c]) => {
                                    if (c.teacherComment) initComments[qId] = c.teacherComment;
                                  });
                                  setTeacherComments(initComments);
                                }} style={{ padding: "5px 12px", border: "1px solid #e2e8f0", borderRadius: "7px", background: "#fff", fontSize: "12px", cursor: "pointer" }}>Details</button>
                              )}
                            </td>
                          </tr>
                        );
                      });
                        })()}
                    </tbody>
                  </table>
                </div>

                {/* Detail Panel */}
                {selectedSubmission && <div onClick={() => setSelectedSubmission(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.15)", zIndex: 499 }} />}
                {selectedSubmission && (
                  <div style={{ position: "fixed", top: 0, right: 0, width: "480px", height: "100vh", background: "#fff", borderLeft: "1px solid #e2e8f0", padding: "24px", overflowY: "auto", zIndex: 500, boxShadow: "-4px 0 24px rgba(0,0,0,0.08)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
                      <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>{selectedSubmission.username}</h3>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <button onClick={() => { const toReset = [{ ...selectedSubmission, ai_corrections: Object.fromEntries(Object.entries(selectedSubmission.ai_corrections || {}).map(([k,v]) => [k, {...v, aiReviewed: false, needsReview: true}])), reviewed: false }]; startBatchCorrection(toReset); }} disabled={aiRunning}
                          style={{ padding: "6px 12px", background: "#f0f7ff", color: "#2563a8", border: "1px solid #bfdbfe", borderRadius: "7px", fontSize: "12px", fontWeight: 700, cursor: aiRunning ? "not-allowed" : "pointer" }}>
                          {aiRunning ? "⏳" : "🔄 Neu korrigieren"}
                        </button>
                        <button onClick={() => setSelectedSubmission(null)} style={{ background: "#f1f5f9", border: "none", borderRadius: "6px", padding: "4px 10px", cursor: "pointer", fontSize: "16px", color: "#64748b" }}>✕</button>
                      </div>
                    </div>
                    <p style={{ margin: "0 0 10px", color: "#64748b", fontSize: "13px" }}>Abgegeben: {selectedSubmission.submitted_at ? new Date(selectedSubmission.submitted_at).toLocaleString("de-DE") : "–"}</p>

                    {/* Schnell-Prompt */}
                    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "10px 12px", marginBottom: "12px" }}>
                      <div style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", marginBottom: "6px" }}>KORREKTUR VERFEINERN (alle Aufgaben)</div>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <input value={quickPrompt} onChange={e => setQuickPrompt(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter" && quickPrompt.trim()) applyQuickPrompt(quickPrompt); }}
                          placeholder='z.B. "Sei kulanter" oder "Grundform zählt auch"'
                          style={{ flex: 1, padding: "6px 10px", border: "1px solid #e2e8f0", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit" }} />
                        <button onClick={() => applyQuickPrompt(quickPrompt)} disabled={!quickPrompt.trim() || refiningQuestion === "all"}
                          style={{ padding: "6px 10px", background: quickPrompt.trim() ? "#2563a8" : "#e2e8f0", color: quickPrompt.trim() ? "#fff" : "#94a3b8", border: "none", borderRadius: "6px", fontSize: "11px", fontWeight: 700, cursor: quickPrompt.trim() ? "pointer" : "not-allowed" }}>
                          {refiningQuestion === "all" ? "⏳" : "↩"}
                        </button>
                      </div>
                    </div>



                    {/* Meta-Infos */}
                    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "12px 16px", marginBottom: "18px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", fontSize: "13px" }}>
                      <div><span style={{ color: "#94a3b8", display: "block", fontSize: "11px", fontWeight: 600 }}>SCHÜLER/IN</span><span style={{ fontWeight: 600, color: "#0f172a" }}>{selectedSubmission.username}</span></div>
                      <div><span style={{ color: "#94a3b8", display: "block", fontSize: "11px", fontWeight: 600 }}>DATUM</span><span style={{ fontWeight: 600, color: "#0f172a" }}>{new Date(selectedSubmission.submitted_at).toLocaleDateString("de-DE")}</span></div>
                      <div><span style={{ color: "#94a3b8", display: "block", fontSize: "11px", fontWeight: 600 }}>LEHRKRAFT</span><span style={{ fontWeight: 600, color: "#0f172a" }}>{currentUser?.name || "–"}</span></div>
                    </div>

                    {selectedSubmission.cheat_log?.length > 0 && (
                      <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px", padding: "12px 14px", marginBottom: "16px" }}>
                        <div style={{ fontSize: "13px", fontWeight: 700, color: "#dc2626", marginBottom: "6px" }}>⚠️ {selectedSubmission.cheat_log.length}× Tab/App-Wechsel erkannt</div>
                        {selectedSubmission.cheat_log.map((e, i) => <div key={i} style={{ fontSize: "12px", color: "#64748b" }}>{new Date(e.time).toLocaleTimeString("de-DE")} — Tab verlassen</div>)}
                      </div>
                    )}

                    {/* Fragen */}
                    {(() => {
                      const allQs = flattenQs(assignmentData?.question_data || assignment?.question_data || []);
                      const corrections = selectedSubmission.ai_corrections || {};

                      // Wenn ai_corrections leer aber Fragen vorhanden: alle Fragen anzeigen
                      let orderedKeys;
                      if (allQs.length > 0) {
                        orderedKeys = allQs.map(q => String(q.id));
                        // Füge Platzhalter für fehlende Korrekturen ein
                        orderedKeys.forEach(qId => {
                          if (!corrections[qId]) {
                            corrections[qId] = { points: 0, correct: false, aiReviewed: false, needsReview: false, maxPoints: Number(allQs.find(q => String(q.id) === qId)?.points || 0), comment: "" };
                          }
                        });
                      } else {
                        orderedKeys = Object.keys(corrections);
                      }
                      const missingKeys = Object.keys(corrections).filter(k => !orderedKeys.includes(k));

                      if (orderedKeys.length === 0 && missingKeys.length === 0) {
                        return (
                          <div style={{ padding: "24px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
                            <div style={{ fontSize: "28px", marginBottom: "8px" }}>📋</div>
                            Noch keine Korrektur vorhanden.
                            <br />
                            <button onClick={() => { const toReset = [{ ...selectedSubmission, reviewed: false }]; startBatchCorrection(toReset); }} disabled={aiRunning}
                              style={{ marginTop: "12px", padding: "8px 16px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
                              🤖 Jetzt korrigieren
                            </button>
                          </div>
                        );
                      }

                      return [...orderedKeys, ...missingKeys].map((qId, i) => {
                        const correction = corrections[qId];
                        if (!correction) return null;
                        const override = overrides[qId];
                        const currentPoints = override !== undefined ? Number(override) : (selectedSubmission.manual_overrides?.[qId] !== undefined ? selectedSubmission.manual_overrides[qId] : correction.points);
                        const isAiReviewed = correction.aiReviewed;
                        const isStillOpen = correction.needsReview && !correction.aiReviewed;

                        // Relevante Regeln für diese Frage
                        const relevantRules = detectedRules.filter(r => {
                          if (r.taskId) return String(r.taskId) === qId;
                          return !r.taskId && (!r.taskIds || r.taskIds.length === 0 || r.taskIds.includes(qId));
                        });

                        return (
                          <div key={qId} style={{ marginBottom: "16px", background: "#f8fafc", borderRadius: "12px", padding: "14px", border: "1px solid #e2e8f0" }}>
                            <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                              Aufgabe {i + 1}
                              {correction.correct === true && <span style={{ color: "#16a34a" }}>✓</span>}
                              {correction.correct === false && <span style={{ color: "#dc2626" }}>✗</span>}
                              {isAiReviewed && <span style={{ fontSize: "10px", background: "#eff6ff", color: "#2563a8", borderRadius: "4px", padding: "1px 6px", fontWeight: 700 }}>🤖 KI</span>}
                            </div>
                            {(() => {
                              const q = flattenQs(assignmentData?.question_data || []).find(q => String(q.id) === qId);
                              return q?.text ? <div style={{ fontSize: "13px", color: "#0f172a", fontWeight: 600, marginBottom: "6px", padding: "6px 8px", background: "#fff", borderRadius: "6px", border: "1px solid #e2e8f0" }} dangerouslySetInnerHTML={{ __html: q.text }} /> : null;
                            })()}
                            <div style={{ fontSize: "13px", color: "#374151", marginBottom: "8px" }}>
                              <em style={{ color: "#94a3b8" }}>Antwort:</em> {(() => {
                                const ans = selectedSubmission.answers?.[qId] ?? selectedSubmission.answers?.[Number(qId)];
                                if (ans === undefined || ans === null || ans === "") return "–";
                                if (Array.isArray(ans)) return ans.join(", ");
                                return String(ans);
                              })()}
                            </div>

                            {/* Musterlösung */}
                            {(() => {
                              const q = flattenQs(assignmentData?.question_data || []).find(q => String(q.id) === qId);
                              if (!q) return null;
                              const currentSolution = solutionEdits[qId] !== undefined ? solutionEdits[qId] : (q.solution || "");
                              const isDirty = solutionEdits[qId] !== undefined && solutionEdits[qId] !== (q.solution || "");
                              return (
                                <div style={{ marginBottom: "8px" }}>
                                  <div style={{ fontSize: "11px", color: "#94a3b8", marginBottom: "4px" }}>Musterlösung</div>
                                  <div style={{ display: "flex", gap: "6px" }}>
                                    <input value={currentSolution} onChange={e => setSolutionEdits(prev => ({ ...prev, [qId]: e.target.value }))}
                                      placeholder="Musterlösung eingeben..."
                                      style={{ flex: 1, padding: "6px 10px", border: `1.5px solid ${isDirty ? "#2563a8" : "#e2e8f0"}`, borderRadius: "6px", fontSize: "13px", fontFamily: "inherit", background: isDirty ? "#f0f7ff" : "#fff" }} />
                                    {isDirty && (
                                      <button onClick={() => saveSolution(qId, solutionEdits[qId])} disabled={savingSolution === qId}
                                        style={{ padding: "6px 10px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "6px", fontSize: "11px", fontWeight: 700, cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap" }}>
                                        {savingSolution === qId ? "⏳" : "✓ Speichern"}
                                      </button>
                                    )}
                                  </div>
                                  {isDirty && <div style={{ fontSize: "10px", color: "#2563a8", marginTop: "3px" }}>Speichern aktualisiert Vorlage und löst Neu-Korrektur aus</div>}
                                </div>
                              );
                            })()}

                            {/* KI-Kommentar */}
                            {isStillOpen && (
                              <div style={{ background: "#fef9c3", borderRadius: "8px", padding: "8px 10px", marginBottom: "6px", fontSize: "12px", color: "#92400e", display: "flex", alignItems: "center", gap: "6px" }}>
                                <div style={{ width: "10px", height: "10px", border: "2px solid #fde68a", borderTop: "2px solid #92400e", borderRadius: "50%", animation: "spin 1s linear infinite", flexShrink: 0 }} />
                                Wird bewertet...
                              </div>
                            )}
                            {!isStillOpen && (correction.comment || correction.usedCriteria) && (() => {
                              const commentText = correction.comment?.replace("🤖 ", "").replace("⏳ Wartet auf Bewertung", "").trim();
                              if (!commentText && !correction.usedCriteria) return null;
                              return (
                                <div style={{ marginBottom: "6px" }}>
                                  <div style={{ fontSize: "11px", color: "#94a3b8", marginBottom: "4px" }}>Kommentar der KI</div>
                                  <div style={{ background: "#f8fafc", borderRadius: "8px", padding: "8px 10px", fontSize: "12px", color: "#374151", border: "1px solid #e2e8f0" }}>
                                    <span style={{ marginRight: "4px" }}>🤖</span>
                                    {commentText}
                                    {commentText && correction.usedCriteria && <span style={{ color: "#94a3b8", margin: "0 4px" }}>·</span>}
                                    {correction.usedCriteria && <span style={{ color: "#64748b" }}>{correction.usedCriteria}</span>}
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Nachkorrektur-Anfrage */}
                            {(() => {
                              const req = selectedSubmission.correction_requests?.[qId];
                              if (!req || req.status !== "open") return null;
                              return (
                                <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: "8px", padding: "10px 12px", marginBottom: "8px" }}>
                                  <div style={{ fontSize: "11px", color: "#ea580c", fontWeight: 700, marginBottom: "4px" }}>🔁 NACHKORREKTUR BEANTRAGT</div>
                                  <div style={{ fontSize: "12px", color: "#374151", marginBottom: "8px" }}>„{req.text}"</div>
                                  <button onClick={async () => {
                                    const updated = { ...(selectedSubmission.correction_requests || {}), [qId]: { ...req, status: "resolved" } };
                                    await supabase.from("submissions").update({ correction_requests: updated }).eq("id", selectedSubmission.id);
                                    const updatedSub = { ...selectedSubmission, correction_requests: updated };
                                    setSubmissions(prev => prev.map(s => s.id === selectedSubmission.id ? updatedSub : s));
                                    setSelectedSubmission(updatedSub);
                                  }} style={{ padding: "4px 12px", background: "#16a34a", color: "#fff", border: "none", borderRadius: "6px", fontSize: "11px", fontWeight: 700, cursor: "pointer" }}>
                                    ✓ Erledigt
                                  </button>
                                </div>
                              );
                            })()}

                            {/* Lehrer-Kommentar */}
                            {(() => {
                              const current = teacherComments[qId] !== undefined ? teacherComments[qId] : (correction.teacherComment || "");
                              const isDirty = teacherComments[qId] !== undefined;
                              return (
                                <div style={{ marginBottom: "8px" }}>
                                  <div style={{ fontSize: "11px", color: "#94a3b8", marginBottom: "4px" }}>Kommentar der Lehrkraft</div>
                                  <textarea value={current} rows={2}
                                    onChange={e => setTeacherComments(prev => ({ ...prev, [qId]: e.target.value }))}
                                    placeholder="Eigener Kommentar für den Schüler (optional)..."
                                    style={{ width: "100%", padding: "6px 10px", border: "1px solid #e2e8f0", borderRadius: "6px", fontSize: "12px", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box", background: "#fff" }} />
                                  {isDirty && <div style={{ fontSize: "10px", color: "#f97316", marginTop: "2px" }}>Wird beim Speichern für den Schüler sichtbar</div>}
                                </div>
                              );
                            })()}

                            {/* Toggle-Chips */}
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "8px" }}>
                              {(relevantRules.length > 0 ? relevantRules : DEFAULT_RULES_FALLBACK.map(r => ({ ...r, id: `default_${r.id}_${qId}`, scope: "task", taskId: String(qId), taskIds: [String(qId)], source: "default" }))).map(r => (
                                <button key={r.id} onClick={() => relevantRules.length > 0 ? toggleRuleInPanel(r, !r.enabled) : (async () => { const updated = [...detectedRules, r]; setDetectedRules(updated); await supabase.from("assignments").update({ detected_rules: updated }).eq("id", assignmentData.id); })()}
                                  style={{ padding: "3px 9px", borderRadius: "20px", border: `1px solid ${r.enabled ? "#16a34a" : "#e2e8f0"}`, background: r.enabled ? "#f0fdf4" : "#f8fafc", color: r.enabled ? "#16a34a" : "#94a3b8", fontSize: "11px", fontWeight: 500, cursor: "pointer" }}>
                                  {r.enabled ? "✓" : "○"} {r.label}
                                </button>
                              ))}
                            </div>

                            {/* Bewertungsmaßstab vorschlagen + verfeinern */}
                            {isAiReviewed && (() => {
                              const q = flattenQs(assignmentData?.question_data || []).find(q => String(q.id) === qId);
                              if (!q || (q.partialPoints?.length > 0)) return null;
                              return (
                                <button onClick={() => handleSuggestRubric({ ...q, id: qId })} disabled={suggestingRubric}
                                  style={{ marginBottom: "8px", padding: "5px 10px", background: "#f5f3ff", color: "#6d28d9", border: "1px solid #e9d5ff", borderRadius: "6px", fontSize: "11px", fontWeight: 600, cursor: suggestingRubric ? "not-allowed" : "pointer" }}>
                                  {suggestingRubric ? "⏳" : "🎯 Bewertungsmaßstab vorschlagen"}
                                </button>
                              );
                            })()}
                            {isAiReviewed && (
                              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "8px 10px", marginBottom: "8px" }}>
                                <div style={{ fontSize: "11px", color: "#94a3b8", marginBottom: "4px" }}>Bewertungsmaßstab verfeinern</div>
                                <div style={{ display: "flex", gap: "6px" }}>
                                  <input value={questionFeedback[qId] || ""} onChange={e => setQuestionFeedback(prev => ({ ...prev, [qId]: e.target.value }))}
                                    onKeyDown={e => { if (e.key === "Enter" && questionFeedback[qId]?.trim()) refineQuestionWithFeedback(qId, questionFeedback[qId]); }}
                                    placeholder='z.B. "zu streng" oder "Grundform reicht"'
                                    style={{ flex: 1, padding: "5px 8px", border: "1px solid #e9d5ff", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit", background: "#fff" }} />
                                  <button onClick={() => refineQuestionWithFeedback(qId, questionFeedback[qId])} disabled={!questionFeedback[qId]?.trim() || refiningQuestion === qId}
                                    style={{ padding: "5px 10px", background: questionFeedback[qId]?.trim() ? "#6d28d9" : "#e2e8f0", color: questionFeedback[qId]?.trim() ? "#fff" : "#94a3b8", border: "none", borderRadius: "6px", fontSize: "11px", fontWeight: 700, cursor: questionFeedback[qId]?.trim() && refiningQuestion !== qId ? "pointer" : "not-allowed" }}>
                                    {refiningQuestion === qId ? "⏳" : "↩"}
                                  </button>
                                </div>
                              </div>
                            )}


                            {/* Punkte */}
                            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                              <label style={{ fontSize: "12px", color: "#64748b" }}>Punkte:</label>
                              <input type="number" min={0} max={correction.maxPoints} step={0.5}
                                value={currentPoints ?? ""} onChange={e => setOverrides(prev => ({ ...prev, [qId]: Number(e.target.value) }))}
                                style={{ width: "64px", padding: "4px 8px", border: "2px solid #e5e7eb", borderRadius: "6px", fontSize: "13px", fontWeight: 700, textAlign: "center" }} />
                              <span style={{ fontSize: "12px", color: "#94a3b8" }}>/</span>
                              <input type="number" min={0.5} step={0.5}
                                value={maxPointEdits[qId] !== undefined ? maxPointEdits[qId] : (correction.maxPoints ?? 1)}
                                onChange={e => setMaxPointEdits(prev => ({ ...prev, [qId]: Number(e.target.value) }))}
                                title="Maximale Punktzahl anpassen"
                                style={{ width: "55px", padding: "4px 8px", border: `1px solid ${maxPointEdits[qId] !== undefined ? "#f97316" : "#e2e8f0"}`, borderRadius: "6px", fontSize: "13px", textAlign: "center", background: maxPointEdits[qId] !== undefined ? "#fff7ed" : "#fff" }} />
                              <span style={{ fontSize: "12px", color: "#94a3b8" }}>Pkt. max.</span>
                              {overrides[qId] !== undefined && <span style={{ fontSize: "11px", background: "#fef9c3", color: "#ca8a04", borderRadius: "5px", padding: "2px 6px" }}>✏️ Geändert</span>}
                            </div>
                          </div>
                        );
                      });
                    })()}

                    <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                      <button onClick={saveOverrides} disabled={saving} style={{ flex: 1, padding: "10px", background: "#16a34a", color: "#fff", border: "none", borderRadius: "9px", fontWeight: 600, fontSize: "13px", cursor: saving ? "not-allowed" : "pointer" }}>
                        {saving ? "Wird gespeichert..." : "✓ Korrekturen speichern"}
                      </button>
                      <button onClick={() => saveAllRules(detectedRules, customRules)} disabled={aiRunning || savingRules}
                        style={{ padding: "10px 14px", background: "#6d28d9", color: "#fff", border: "none", borderRadius: "9px", fontWeight: 600, fontSize: "13px", cursor: (aiRunning || savingRules) ? "not-allowed" : "pointer" }}>
                        {aiRunning ? "⏳" : "🔄 Korrektur aktualisieren"}
                      </button>
                      <button onClick={() => setSelectedSubmission(null)} style={{ padding: "10px 16px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "9px", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}>Schließen</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* REGEL-PROPAGATION MODAL */}
      {rulePropagateModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1002, padding: "20px" }}>
          <div style={{ background: "#fff", borderRadius: "16px", padding: "28px", maxWidth: "380px", width: "100%" }}>
            <div style={{ fontSize: "20px", marginBottom: "10px" }}>🔄</div>
            <h4 style={{ margin: "0 0 8px", fontSize: "15px", fontWeight: 800, color: "#0f172a" }}>Regel auch für andere Aufgaben?</h4>
            <p style={{ color: "#64748b", fontSize: "13px", marginBottom: "6px", lineHeight: 1.5 }}>
              <strong>„{rulePropagateModal.rule.label}"</strong> wurde {rulePropagateModal.newEnabled ? "aktiviert" : "deaktiviert"}.
            </p>
            <p style={{ color: "#64748b", fontSize: "13px", marginBottom: "20px", lineHeight: 1.5 }}>
              Diese Regel kommt auch bei {rulePropagateModal.sameLabel.length} anderen Aufgabe{rulePropagateModal.sameLabel.length !== 1 ? "n" : ""} vor. Auch dort übernehmen?
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <button onClick={() => applyRulePropagation(true)} style={{ padding: "11px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "9px", fontWeight: 700, fontSize: "13px", cursor: "pointer" }}>Ja, für alle Aufgaben</button>
              <button onClick={() => applyRulePropagation(false)} style={{ padding: "11px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "9px", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}>Nein, nur hier</button>
              <button onClick={() => setRulePropagateModal(null)} style={{ padding: "8px", background: "none", color: "#94a3b8", border: "none", fontSize: "12px", cursor: "pointer" }}>Abbrechen</button>
            </div>
          </div>
        </div>
      )}

      {/* REGELWERK MODAL */}
      {regelwerkModal && assignmentData && (
        <RegelwerkModal
          assignmentData={assignmentData}
          customRules={customRules}
          detectedRules={detectedRules}
          setDetectedRules={setDetectedRules}
          saveAllRules={saveAllRules}
          analyzingRules={analyzingRules}
          savingRules={savingRules}
          onClose={() => setRegelwerkModal(false)}
        />
      )}

      {/* RUBRIC MODAL */}
      <RubricModal rubricModal={rubricModal} setRubricModal={setRubricModal} savingRubric={savingRubric} setSavingRubric={setSavingRubric} onSave={saveRubricToTemplate} />

      {/* FREIGABE MODAL */}
      {releaseModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "400px", width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: "48px", marginBottom: "12px" }}>🤖✅</div>
            <h3 style={{ fontSize: "18px", fontWeight: 800, margin: "0 0 8px", color: "#0f172a" }}>Korrektur abgeschlossen</h3>
            <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "24px", lineHeight: 1.6 }}>Korrekturen jetzt für alle Schüler freigeben?</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <button onClick={() => setReleaseModal(false)} style={{ padding: "12px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "14px", cursor: "pointer" }}>Ich schaue zuerst drüber</button>
              <button onClick={() => { releaseAll(); setReleaseModal(false); }} style={{ padding: "12px", background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: "10px", fontWeight: 500, fontSize: "13px", cursor: "pointer" }}>Alle freigeben</button>
            </div>
          </div>
        </div>
      )}

      {/* NACHTEST MODAL */}
      {makeupModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "500px", width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
            <h3 style={{ fontSize: "18px", fontWeight: 800, margin: "0 0 4px", color: "#0f172a" }}>Nachtest erstellen</h3>
            <p style={{ color: "#64748b", fontSize: "13px", marginBottom: "24px" }}>Ergebnisse werden dem Original-Test „{assignment.title}" zugeordnet.</p>
            <div style={{ marginBottom: "20px" }}>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "8px" }}>Teilnehmende Schüler/innen ({makeupSelected.size} ausgewählt)</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                {missingStudents.map(u => {
                  const selected = makeupSelected.has(u);
                  return (
                    <button key={u} onClick={() => setMakeupSelected(prev => { const next = new Set(prev); next.has(u) ? next.delete(u) : next.add(u); return next; })}
                      style={{ padding: "8px 12px", borderRadius: "8px", cursor: "pointer", textAlign: "left", border: `2px solid ${selected ? "#2563a8" : "#e2e8f0"}`, background: selected ? "#eff6ff" : "#f8fafc", fontFamily: "inherit" }}>
                      <span style={{ fontSize: "12px", color: selected ? "#2563a8" : "#94a3b8", display: "block" }}>{selected ? "✓ Ausgewählt" : "Nicht ausgewählt"}</span>
                      <span style={{ fontSize: "13px", fontWeight: 600, color: selected ? "#1e40af" : "#374151" }}>{u}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>Test-Vorlage *</label>
              <select value={makeupTemplateId} onChange={e => setMakeupTemplateId(e.target.value)} style={{ width: "100%", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", fontFamily: "inherit", background: "#fff", boxSizing: "border-box" }}>
                <option value="">– Vorlage auswählen –</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "6px" }}>Bearbeitungszeit (Min.)</label>
              <input type="number" min={1} max={180} value={makeupTimeLimit} onChange={e => setMakeupTimeLimit(Number(e.target.value))} style={{ width: "160px", padding: "10px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", fontFamily: "inherit" }} />
            </div>
            <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", marginBottom: "12px" }}>
              <input type="checkbox" checked={makeupAntiCheat} onChange={e => setMakeupAntiCheat(e.target.checked)} style={{ width: "16px", height: "16px", accentColor: "#2563a8" }} />
              🛡️ Anti-Cheat aktivieren
            </label>
            <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", marginBottom: "24px" }}>
              <input type="checkbox" checked={makeupRequireSeb} onChange={e => setMakeupRequireSeb(e.target.checked)} style={{ width: "16px", height: "16px", accentColor: "#7c3aed", marginTop: "1px", flexShrink: 0 }} />
              🔒 Safe Exam Browser erforderlich
            </label>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setMakeupModal(false)} style={{ flex: 1, padding: "11px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "10px", fontWeight: 600, cursor: "pointer" }}>Abbrechen</button>
              <button onClick={createMakeupTest} disabled={!makeupTemplateId || makeupSelected.size === 0 || creatingMakeup}
                style={{ flex: 1, padding: "11px", background: (makeupTemplateId && makeupSelected.size > 0) ? "#2563a8" : "#e2e8f0", color: (makeupTemplateId && makeupSelected.size > 0) ? "#fff" : "#94a3b8", border: "none", borderRadius: "10px", fontWeight: 700, cursor: (makeupTemplateId && makeupSelected.size > 0) ? "pointer" : "not-allowed" }}>
                {creatingMakeup ? "Wird erstellt..." : `Nachtest für ${makeupSelected.size} Schüler/in →`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Kalibrierungs-Modal */}
      {calibration && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "28px", maxWidth: "540px", width: "100%", maxHeight: "85vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
              <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 800, color: "#0f172a" }}>🎯 Kalibrierung nötig</h3>
              <button onClick={() => setCalibration(null)} style={{ background: "none", border: "none", fontSize: "18px", cursor: "pointer", color: "#94a3b8" }}>✕</button>
            </div>
            <p style={{ color: "#64748b", fontSize: "13px", marginBottom: "16px", lineHeight: 1.5 }}>
              Die KI war bei dieser Aufgabe unsicher. Bewerte <strong>2–3 Beispiele</strong> kurz manuell — dann korrigiert die KI alle ähnlichen Antworten nach deinem Maßstab neu.
            </p>
            <div style={{ background: "#f8fafc", borderRadius: "10px", padding: "12px 14px", marginBottom: "16px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "11px", color: "#94a3b8", marginBottom: "3px" }}>AUFGABE</div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>{calibration.qText}</div>
              {calibration.solution && <div style={{ fontSize: "12px", color: "#64748b", marginTop: "3px" }}>Musterlösung: <em>{calibration.solution}</em></div>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "18px" }}>
              {calibration.cases.slice(0, 6).map(c => (
                <div key={c.subId} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", background: calibration.examples[c.subId] !== undefined ? "#f0fdf4" : "#f8fafc", borderRadius: "8px", border: `1px solid ${calibration.examples[c.subId] !== undefined ? "#bbf7d0" : "#e2e8f0"}` }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "11px", color: "#94a3b8" }}>{c.username}</div>
                    <div style={{ fontSize: "13px", color: "#0f172a", fontWeight: 500 }}>„{c.answer}"</div>
                    <div style={{ fontSize: "11px", color: "#94a3b8" }}>KI: {c.points}/{c.maxPoints} Pkt.</div>
                  </div>
                  <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {Array.from({ length: Math.floor(c.maxPoints / 0.5) + 1 }, (_, i) => i * 0.5).map(pts => (
                      <button key={pts} onClick={() => setCalibration(prev => ({ ...prev, examples: { ...prev.examples, [c.subId]: pts } }))}
                        style={{ padding: "3px 8px", borderRadius: "6px", border: `1.5px solid ${calibration.examples[c.subId] === pts ? "#16a34a" : "#e2e8f0"}`, background: calibration.examples[c.subId] === pts ? "#f0fdf4" : "#fff", fontSize: "12px", fontWeight: 700, color: calibration.examples[c.subId] === pts ? "#16a34a" : "#64748b", cursor: "pointer" }}>
                        {pts}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setCalibration(null)} style={{ flex: 1, padding: "11px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "9px", fontWeight: 600, cursor: "pointer" }}>
                Überspringen
              </button>
              <button onClick={runCalibrationCorrection}
                disabled={Object.keys(calibration.examples).length < 2}
                style={{ flex: 2, padding: "11px", background: Object.keys(calibration.examples).length >= 2 ? "#2563a8" : "#e2e8f0", color: Object.keys(calibration.examples).length >= 2 ? "#fff" : "#94a3b8", border: "none", borderRadius: "9px", fontWeight: 700, cursor: "pointer" }}>
                {Object.keys(calibration.examples).length >= 2 ? `🎯 ${calibration.cases.length - Object.keys(calibration.examples).length} Antworten neu korrigieren` : `Noch ${2 - Object.keys(calibration.examples).length} Beispiel(e) nötig`}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Scan-Upload Modal */}
      {scanModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "520px", width: "100%", maxHeight: "85vh", overflowY: "auto" }}>
            <h3 style={{ margin: "0 0 6px", fontSize: "18px", fontWeight: 800, color: "#0f172a" }}>📄 Gescannte Tests hochladen</h3>
            <p style={{ color: "#64748b", fontSize: "13px", marginBottom: "12px", lineHeight: 1.6 }}>
              Jede Seite muss den Code <code style={{ background: "#f1f5f9", padding: "1px 6px", borderRadius: "4px", fontSize: "12px" }}>[SCHÜLER: name | TEST: {String(assignmentData?.id || "").slice(-6).toUpperCase()}]</code> enthalten.
            </p>


            {!scanResult ? (
              <>
                <label style={{ display: "block", border: "2px dashed #e2e8f0", borderRadius: "12px", padding: "24px", textAlign: "center", cursor: "pointer", background: scanFile ? "#f0fdf4" : "#f8fafc", marginBottom: "10px" }}>
                  <div style={{ fontSize: "32px", marginBottom: "8px" }}>📁</div>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "#374151" }}>
                    {scanFile ? scanFile.name : "PDF oder Foto aus Ordner"}
                  </div>
                  {scanFile && <div style={{ fontSize: "12px", color: "#16a34a", marginTop: "4px" }}>✓ {(scanFile.size / 1024 / 1024).toFixed(1)} MB</div>}
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display: "none" }} onChange={e => { setScanFile(e.target.files[0]); setScanError(""); }} />
                </label>

                <label style={{ display: "block", border: "2px dashed #bbf7d0", borderRadius: "12px", padding: "18px", textAlign: "center", cursor: "pointer", background: "#f0fdf4", marginBottom: "16px" }}>
                  <div style={{ fontSize: "28px", marginBottom: "6px" }}>📷</div>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "#16a34a" }}>Direkt fotografieren</div>
                  <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>Rückkamera öffnen</div>
                  <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={e => { setScanFile(e.target.files[0]); setScanError(""); }} />
                </label>
                {scanError && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", padding: "10px 14px", fontSize: "13px", color: "#dc2626", marginBottom: "12px" }}>⚠️ {scanError}</div>}
                <div style={{ display: "flex", gap: "10px" }}>
                  <button onClick={() => { setScanModal(false); setScanFile(null); setScanError(""); }} style={{ flex: 1, padding: "11px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "9px", fontWeight: 600, cursor: "pointer" }}>Abbrechen</button>
                  <button onClick={processScan} disabled={!scanFile || scanProcessing}
                    style={{ flex: 2, padding: "11px", background: scanFile && !scanProcessing ? "#16a34a" : "#e2e8f0", color: scanFile && !scanProcessing ? "#fff" : "#94a3b8", border: "none", borderRadius: "9px", fontWeight: 700, cursor: scanFile && !scanProcessing ? "pointer" : "not-allowed" }}>
                    {scanProcessing ? `⏳ ${scanProcessingStep || "Wird verarbeitet..."}` : "🔍 Analysieren"}
                  </button>
                </div>
              </>
            ) : (
              <>
                {(() => {
                  // Prüfe gegen Gruppe — auch wenn noch keine Submissions vorhanden
                  const knownNames = new Set([
                    ...(submissions || []).map(s => s.username),
                    ...(assignmentData?.groups?.usernames || []),
                  ]);
                  const openQs = flattenQs(assignmentData?.question_data || []).filter(q => q.type === "qa" || q.type === "open");
                  return (
                    <div style={{ maxHeight: "55vh", overflowY: "auto" }}>
                      <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "10px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px", padding: "8px 12px" }}>
                        ✓ OCR abgeschlossen — prüfe die Antworten und korrigiere falls nötig.
                      </div>
                      {scanDebug && (
                        <details style={{ marginBottom: "10px" }}>
                          <summary style={{ fontSize: "11px", color: "#94a3b8", cursor: "pointer" }}>🔍 Roher OCR-Text (Debug)</summary>
                          <pre style={{ fontSize: "10px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "8px", overflowX: "auto", whiteSpace: "pre-wrap", maxHeight: "150px", overflowY: "auto", color: "#374151", marginTop: "6px" }}>{scanDebug}</pre>
                        </details>
                      )}
                      {scanResult.map((s, si) => {
                        const known = knownNames.has(s.student);
                        return (
                          <div key={si} style={{ marginBottom: "16px", border: `1px solid ${known ? "#e2e8f0" : "#fecaca"}`, borderRadius: "10px", overflow: "hidden" }}>
                            <div style={{ background: known ? "#f8fafc" : "#fef2f2", padding: "8px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontWeight: 700, fontSize: "13px", color: known ? "#374151" : "#dc2626" }}>
                                {!known && "⚠️ "}{s.student}
                              </span>
                              {!known && <span style={{ fontSize: "11px", color: "#dc2626" }}>nicht in Gruppe</span>}
                            </div>
                            <div style={{ padding: "10px 14px" }}>
                              {openQs.map((q, qi) => {
                                const qId = String(q.id);
                                const val = s.answers[qId] ?? "";
                                return (
                                  <div key={qId} style={{ marginBottom: "8px" }}>
                                    <div style={{ fontSize: "11px", color: "#94a3b8", marginBottom: "3px" }}>
                                      Aufgabe {qi + 1}: {q.text?.replace(/<[^>]+>/g, "").slice(0, 40) || "–"}
                                    </div>
                                    <input
                                      value={val}
                                      onChange={e => {
                                        const updated = [...scanResult];
                                        updated[si] = { ...updated[si], answers: { ...updated[si].answers, [qId]: e.target.value } };
                                        setScanResult(updated);
                                      }}
                                      placeholder="(keine Antwort erkannt)"
                                      style={{ width: "100%", padding: "5px 8px", border: "1px solid #e2e8f0", borderRadius: "6px", fontSize: "13px", fontFamily: "inherit", boxSizing: "border-box", background: val ? "#fff" : "#f8fafc", color: val ? "#0f172a" : "#94a3b8" }}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                {scanError && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", padding: "10px 14px", fontSize: "13px", color: "#dc2626", marginBottom: "12px" }}>⚠️ {scanError}</div>}
                <div style={{ display: "flex", gap: "10px" }}>
                  <button onClick={() => { setScanResult(null); setScanError(""); }} style={{ flex: 1, padding: "11px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "9px", fontWeight: 600, cursor: "pointer" }}>← Zurück</button>
                  <button onClick={applyScanResult} disabled={scanProcessing}
                    style={{ flex: 2, padding: "11px", background: scanProcessing ? "#e2e8f0" : "#2563a8", color: scanProcessing ? "#94a3b8" : "#fff", border: "none", borderRadius: "9px", fontWeight: 700, cursor: scanProcessing ? "not-allowed" : "pointer" }}>
                    {scanProcessing ? "⏳ Wird gespeichert..." : "✓ Übernehmen & korrigieren"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </TeacherLayout>
  );
}
