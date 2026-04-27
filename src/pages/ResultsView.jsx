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
  const disabledRules = rules.filter(r => !r.enabled).map(r => `- NICHT anwenden: ${r.label}`).join("\n");
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
  "results": [{"username": "<n>", "points": <Zahl max ${q.points}>, "comment": "<1 Satz Begründung>"}]
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
export default function ResultsView({ navigate, onLogout, currentUser, assignment }) {
  const [submissions, setSubmissions] = useState([]);
  const [groupUsernames, setGroupUsernames] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
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
    return () => supabase.removeChannel(channel);
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
          if (!merged[q.id] && !merged[qId] && !hasAnswer) {
            merged[qId] = { points: 0, correct: false, comment: "Keine Antwort gegeben.", aiReviewed: true, needsReview: false, maxPoints: Number(q.points) };
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
        await supabase.from("submissions").update({ ai_corrections: merged, score: newScore, grade: newGrade, reviewed: true }).eq("id", s.id);
        setSubmissions(prev => prev.map(sub => sub.id === s.id ? { ...sub, ai_corrections: merged, score: newScore, grade: newGrade, reviewed: true } : sub));
        if (selectedSubmission?.id === s.id) setSelectedSubmission(prev => ({ ...prev, ai_corrections: merged, score: newScore, grade: newGrade, reviewed: true }));
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
        }
        setAnalyzingRules(false);
      }

      setTimeout(() => { setAiProgress(""); setAiRunning(false); setReleaseModal(true); }, 2000);
    } catch (e) {
      setAiProgress("❌ Fehler bei der Korrektur.");
      setTimeout(() => { setAiProgress(""); setAiRunning(false); }, 3000);
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

  const toggleRuleInPanel = (rule, newEnabled) => {
    const sameLabel = detectedRules.filter(r => r.label === rule.label && r.id !== rule.id);
    if (sameLabel.length > 0) {
      setRulePropagateModal({ rule, newEnabled, sameLabel });
      return;
    }
    setDetectedRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: newEnabled } : r));
  };

  const applyRulePropagation = (propagate) => {
    if (!rulePropagateModal) return;
    const { rule, newEnabled, sameLabel } = rulePropagateModal;
    const ids = new Set([rule.id, ...(propagate ? sameLabel.map(r => r.id) : [])]);
    setDetectedRules(prev => prev.map(r => ids.has(r.id) ? { ...r, enabled: newEnabled } : r));
    setRulePropagateModal(null);
  };

  const saveOverrides = async () => {
    if (!selectedSubmission) return;
    setSaving(true);
    const updatedOverrides = { ...selectedSubmission.manual_overrides, ...overrides };
    const corrections = selectedSubmission.ai_corrections || {};
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
    await supabase.from("submissions").update({ manual_overrides: updatedOverrides, score: newScore, grade: newGrade, reviewed: true }).eq("id", selectedSubmission.id);
    setSubmissions(prev => prev.map(s => s.id === selectedSubmission.id ? { ...s, manual_overrides: updatedOverrides, score: newScore, grade: newGrade, reviewed: true } : s));
    setOverrides({});
    setSaving(false);
    setSelectedSubmission(null);
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
      setQuestionFeedback(prev => ({ ...prev, [qId]: "" }));
      const toReset = submissions.map(s => ({
        ...s,
        ai_corrections: Object.fromEntries(Object.entries(s.ai_corrections || {}).map(([k, v]) => [k, { ...v, aiReviewed: false, needsReview: true }])),
        reviewed: false,
      }));
      await startBatchCorrection(toReset, { ...assignmentData, question_data: updatedAsgn });
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
      await supabase.from("submissions").update({ ai_corrections: newCorrections, score: newScore, grade: newGrade, reviewed: true }).eq("id", selectedSubmission.id);
      const updated = { ...selectedSubmission, ai_corrections: newCorrections, score: newScore, grade: newGrade };
      setSubmissions(prev => prev.map(s => s.id === selectedSubmission.id ? updated : s));
      setSelectedSubmission(updated);
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
  const missingStudents = relevantUsernames.filter(u => !submittedUsernames.has(u));
  const avg = submissions.length > 0
    ? (submissions.reduce((s, r) => s + ((r.score || 0) / (r.total_points || 1)) * 100, 0) / submissions.length).toFixed(1)
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
            {submissions.some(s => !s.released) && (
              <button onClick={releaseAll} style={{ marginLeft: "12px", padding: "4px 12px", background: "#16a34a", color: "#fff", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>✓ Alle freigeben</button>
            )}
          </p>
        </div>

        {aiProgress && (
          <div style={{ background: aiProgress.startsWith("✅") ? "#f0fdf4" : "#f0f7ff", border: `1px solid ${aiProgress.startsWith("✅") ? "#bbf7d0" : "#bfdbfe"}`, borderRadius: "10px", padding: "10px 16px", marginBottom: "16px", fontSize: "13px", color: aiProgress.startsWith("✅") ? "#16a34a" : "#1e3a5f", fontWeight: 600, display: "flex", alignItems: "center", gap: "10px" }}>
            {!aiProgress.startsWith("✅") && <div style={{ width: "14px", height: "14px", border: "2px solid #bfdbfe", borderTop: "2px solid #2563a8", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />}
            {aiProgress}
          </div>
        )}
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

            {submissions.length === 0 ? (
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
                        {["Schüler/in", "Punkte", "Note", "Status", "Freigabe", ""].map(h => (
                          <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "#94a3b8", borderBottom: "1px solid #f1f5f9" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {submissions.map((s, i) => {
                        const hasAiPending = Object.values(s.ai_corrections || {}).some(c => c.needsReview && !c.aiReviewed);
                        return (
                          <tr key={s.id} style={{ borderBottom: i < submissions.length - 1 ? "1px solid #f8fafc" : "none", background: selectedSubmission?.id === s.id ? "#f0f7ff" : "transparent" }}>
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
                              {s.reviewed
                                ? <span style={{ background: "#dcfce7", color: "#16a34a", borderRadius: "6px", padding: "3px 8px", fontSize: "12px", fontWeight: 600 }}>✓ Geprüft</span>
                                : hasAiPending
                                ? <span style={{ background: "#eff6ff", color: "#2563a8", borderRadius: "6px", padding: "3px 8px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }} onClick={() => startBatchCorrection([s])}>🤖 KI wiederholen</span>
                                : <span style={{ background: "#fef9c3", color: "#ca8a04", borderRadius: "6px", padding: "3px 8px", fontSize: "12px", fontWeight: 600 }}>Offen</span>}
                            </td>
                            <td style={{ padding: "13px 16px" }}>
                              {s.released
                                ? <span style={{ background: "#dcfce7", color: "#16a34a", borderRadius: "6px", padding: "3px 8px", fontSize: "12px", fontWeight: 600 }}>✓ Freigegeben</span>
                                : <button onClick={() => releaseSubmissions([s.id])} style={{ padding: "4px 10px", background: "#f0f7ff", color: "#2563a8", border: "1px solid #bfdbfe", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>Freigeben</button>}
                            </td>
                            <td style={{ padding: "13px 16px" }}>
                              <button onClick={() => { setSelectedSubmission(s); setOverrides({}); }} style={{ padding: "5px 12px", border: "1px solid #e2e8f0", borderRadius: "7px", background: "#fff", fontSize: "12px", cursor: "pointer" }}>Details</button>
                            </td>
                          </tr>
                        );
                      })}
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
                      const orderedKeys = allQs.length > 0
                        ? allQs.map(q => String(q.id)).filter(id => corrections[id] !== undefined)
                        : Object.keys(corrections);
                      const missingKeys = Object.keys(corrections).filter(k => !orderedKeys.includes(k));

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
                          <div key={qId} style={{ marginBottom: "16px", background: "#f8fafc", borderRadius: "12px", padding: "14px", border: `1px solid ${correction.correct === true ? "#bbf7d0" : correction.correct === false ? "#fecaca" : isAiReviewed ? "#bfdbfe" : "#e2e8f0"}` }}>
                            <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                              Aufgabe {i + 1}
                              {correction.correct === true && <span style={{ color: "#16a34a" }}>✓</span>}
                              {correction.correct === false && <span style={{ color: "#dc2626" }}>✗</span>}
                              {isAiReviewed && <span style={{ fontSize: "10px", background: "#eff6ff", color: "#2563a8", borderRadius: "4px", padding: "1px 6px", fontWeight: 700 }}>🤖 KI</span>}
                            </div>
                            <div style={{ fontSize: "13px", color: "#374151", marginBottom: "6px" }}>
                              <em style={{ color: "#94a3b8" }}>Antwort:</em> {(() => {
                                const ans = selectedSubmission.answers?.[qId] ?? selectedSubmission.answers?.[Number(qId)];
                                if (ans === undefined || ans === null || ans === "") return "–";
                                if (Array.isArray(ans)) return ans.join(", ");
                                return String(ans);
                              })()}
                            </div>
                            {correction.comment && (
                              <div style={{ background: isStillOpen ? "#fef9c3" : isAiReviewed ? "#eff6ff" : correction.correct ? "#dcfce7" : "#fef2f2", borderRadius: "8px", padding: "8px 10px", marginBottom: "6px", fontSize: "12px", color: isStillOpen ? "#92400e" : isAiReviewed ? "#1e40af" : correction.correct ? "#16a34a" : "#dc2626" }}>
                                {correction.comment}
                              </div>
                            )}
                            {correction.usedCriteria && (
                              <div style={{ background: "#f8fafc", borderRadius: "6px", padding: "6px 10px", marginBottom: "6px", fontSize: "11px", color: "#64748b", border: "1px solid #e2e8f0" }}>
                                <span style={{ fontWeight: 600, color: "#94a3b8" }}>📐 </span>{correction.usedCriteria}
                              </div>
                            )}

                            {/* Klickbare Regeln pro Aufgabe */}
                            {relevantRules.length > 0 && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "8px" }}>
                                {relevantRules.map(r => (
                                  <button key={r.id} onClick={() => toggleRuleInPanel(r, !r.enabled)}
                                    style={{ padding: "3px 9px", borderRadius: "20px", border: `1.5px solid ${r.enabled ? "#16a34a" : "#e2e8f0"}`, background: r.enabled ? "#f0fdf4" : "#f8fafc", color: r.enabled ? "#16a34a" : "#94a3b8", fontSize: "11px", fontWeight: 600, cursor: "pointer", transition: "all 0.15s" }}>
                                    {r.enabled ? "✓" : "○"} {r.label}
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* Maßstab vorschlagen */}
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

                            {/* Maßstab anpassen */}
                            {isAiReviewed && (
                              <div style={{ background: "#faf5ff", border: "1px solid #e9d5ff", borderRadius: "8px", padding: "8px 10px", marginBottom: "8px" }}>
                                <div style={{ fontSize: "11px", fontWeight: 600, color: "#6d28d9", marginBottom: "5px" }}>💬 Maßstab anpassen</div>
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

                            {(correction.partialPoints?.length > 0) && (
                              <details style={{ marginBottom: "8px" }}>
                                <summary style={{ cursor: "pointer", fontSize: "11px", fontWeight: 600, color: "#64748b", userSelect: "none" }}>📋 Bewertungsmaßstab ({correction.partialPoints.length} Kriterien)</summary>
                                <div style={{ marginTop: "6px", background: "#f8fafc", borderRadius: "6px", padding: "8px 10px", border: "1px solid #e2e8f0" }}>
                                  {correction.partialPoints.map((p, pi) => (
                                    <div key={pi} style={{ fontSize: "12px", color: "#374151", display: "flex", gap: "6px", marginBottom: "3px" }}>
                                      <span style={{ background: "#eff6ff", borderRadius: "4px", padding: "1px 6px", fontWeight: 700, color: "#2563a8", flexShrink: 0 }}>{p.points} Pkt.</span>
                                      <span>{p.description}</span>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            )}

                            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                              <label style={{ fontSize: "12px", color: "#64748b" }}>Punkte:</label>
                              <input type="number" min={0} max={correction.maxPoints} step={0.5}
                                value={currentPoints ?? ""} onChange={e => setOverrides(prev => ({ ...prev, [qId]: Number(e.target.value) }))}
                                style={{ width: "64px", padding: "4px 8px", border: "2px solid #e5e7eb", borderRadius: "6px", fontSize: "13px", fontWeight: 700, textAlign: "center" }} />
                              <span style={{ fontSize: "12px", color: "#94a3b8" }}>/ {correction.maxPoints}</span>
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
              <button onClick={() => { releaseAll(); setReleaseModal(false); }} style={{ padding: "12px", background: "#16a34a", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "14px", cursor: "pointer" }}>✓ Ja, alle freigeben</button>
              <button onClick={() => setReleaseModal(false)} style={{ padding: "12px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "10px", fontWeight: 600, fontSize: "14px", cursor: "pointer" }}>Nein, ich schaue zuerst drüber</button>
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
    </TeacherLayout>
  );
}
