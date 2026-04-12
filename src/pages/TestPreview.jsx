import { useState } from "react";
import TeacherLayout from "../components/TeacherLayout";

const COLORS = ["#fff8e7", "#f0fdf4", "#f0f9ff", "#fdf2f8", "#f5f3ff", "#fff1f2"];

const flattenQuestions = (qs) => {
  const result = [];
  for (const q of qs) {
    if (q.type === "section") {
      for (const task of (q.tasks || [])) {
        for (const tq of (task.questions || [])) {
          result.push({ ...tq, _taskId: task.id, _sectionId: q.id });
        }
      }
    } else {
      result.push(q);
    }
  }
  return result;
};

export default function TestPreview({ navigate, onLogout, currentUser, editingTest, questions }) {
  const [answers, setAnswers] = useState({});

  const allItems = questions || editingTest?.question_data || [];
  const realQuestions = flattenQuestions(allItems);
  const answeredCount = realQuestions.filter(q => {
    if (q.type === "fill_blank" && q.blanks?.length > 0) return Array.isArray(answers[q.id]) && answers[q.id].some(a => a?.trim());
    return answers[q.id] !== undefined && answers[q.id] !== "";
  }).length;

  const renderQuestionInput = (q) => {
    if (q.type === "multiple_choice") {
      const multiCorrect = (q.correctAnswers?.length || 0) > 1;
      const filledOptions = (q.options || []).filter(o => o?.trim() !== "");
      const currentAnswers = Array.isArray(answers[q.id]) ? answers[q.id] : (answers[q.id] != null ? [answers[q.id]] : []);
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {multiCorrect && <div style={{ fontSize: "11px", color: "#2563a8", fontWeight: 600, background: "#eff6ff", borderRadius: "5px", padding: "3px 8px", alignSelf: "flex-start" }}>☑ Mehrere Antworten möglich</div>}
          {filledOptions.map((opt, i) => {
            const selected = currentAnswers.map(Number).includes(i);
            return (
              <button key={i} onClick={() => {
                if (multiCorrect) { const next = selected ? currentAnswers.filter(x => Number(x) !== i) : [...currentAnswers, i]; setAnswers(a => ({ ...a, [q.id]: next })); }
                else { setAnswers(a => ({ ...a, [q.id]: [i] })); }
              }} style={{ padding: "10px 14px", border: `2px solid ${selected ? "#2563a8" : "#e2e8f0"}`, borderRadius: "8px", background: selected ? "#2563a8" : "#f8fafc", color: selected ? "#fff" : "#374151", cursor: "pointer", fontWeight: selected ? 700 : 500, fontSize: "14px", textAlign: "left", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ width: "22px", height: "22px", borderRadius: multiCorrect ? "4px" : "50%", border: `2px solid ${selected ? "rgba(255,255,255,0.5)" : "#d1d5db"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, flexShrink: 0 }}>{selected ? "✓" : String.fromCharCode(65 + i)}</span>
                {opt}
              </button>
            );
          })}
        </div>
      );
    }
    if (q.type === "true_false") {
      return (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          {["Wahr", "Falsch"].map((opt, i) => (
            <button key={i} onClick={() => setAnswers(a => ({ ...a, [q.id]: i }))}
              style={{ padding: "12px", border: `2px solid ${answers[q.id] === i ? "#2563a8" : "#e2e8f0"}`, borderRadius: "8px", background: answers[q.id] === i ? "#2563a8" : "#f8fafc", color: answers[q.id] === i ? "#fff" : "#374151", cursor: "pointer", fontWeight: 700, fontSize: "14px", fontFamily: "inherit" }}>
              {opt}
            </button>
          ))}
        </div>
      );
    }
    if (q.type === "open") {
      return (
        <textarea value={answers[q.id] || ""} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}
          placeholder="Deine Antwort..." rows={3}
          style={{ width: "100%", padding: "10px 12px", border: "2px solid #e2e8f0", borderRadius: "8px", fontSize: "14px", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
      );
    }
    if (q.type === "flashcard") {
      return (
        <div>
          <div style={{ background: "#f8fafc", borderRadius: "10px", padding: "16px", textAlign: "center", marginBottom: "10px", border: "2px solid #e2e8f0" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", marginBottom: "6px" }}>A-SEITE</div>
            {q.cardFrontMedia ? (
              <img src={q.cardFrontMedia} alt="A-Seite" style={{ maxWidth: "100%", maxHeight: "200px", borderRadius: "8px", objectFit: "contain" }} />
            ) : (
              <div style={{ fontSize: "18px", fontWeight: 800, color: "#0f172a" }}>{q.cardFront || <em style={{ color: "#94a3b8" }}>Vorderseite</em>}</div>
            )}
          </div>
          <input value={answers[q.id] || ""} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}
            placeholder="B-Seite eingeben..."
            style={{ width: "100%", padding: "12px", border: "2px solid #e2e8f0", borderRadius: "8px", fontSize: "15px", textAlign: "center", fontFamily: "inherit", boxSizing: "border-box" }} />
        </div>
      );
    }
    if (q.type === "fill_blank") {
      const text = q.fullText || q.text || "";
      const hasBlanks = (q.blanks || []).length > 0 && text.includes("[Lücke]");
      if (hasBlanks) {
        return (
          <div style={{ fontSize: "15px", lineHeight: 2.5, background: "rgba(255,255,255,0.8)", borderRadius: "10px", padding: "14px", color: "#0f172a" }}>
            {text.split("[Lücke]").map((part, i, arr) => (
              <span key={i}>
                {part}
                {i < arr.length - 1 && (
                  <input value={(answers[q.id] || [])[i] || ""}
                    onChange={e => { const cur = Array.isArray(answers[q.id]) ? [...answers[q.id]] : []; cur[i] = e.target.value; setAnswers(a => ({ ...a, [q.id]: cur })); }}
                    placeholder="___"
                    style={{ display: "inline-block", width: "110px", padding: "4px 8px", border: "none", borderBottom: "3px solid #2563a8", background: "transparent", fontSize: "15px", textAlign: "center", fontFamily: "inherit", margin: "0 4px", outline: "none" }} />
                )}
              </span>
            ))}
          </div>
        );
      }
      return (
        <textarea value={answers[q.id] || ""} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}
          placeholder="Deine Antwort..." rows={3}
          style={{ width: "100%", padding: "10px 12px", border: "2px solid #e2e8f0", borderRadius: "8px", fontSize: "14px", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
      );
    }
    if (q.type === "assignment") {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {(q.pairs || []).map((pair, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", background: "rgba(255,255,255,0.8)", borderRadius: "8px", padding: "8px 12px" }}>
              <span style={{ fontWeight: 700, fontSize: "14px", minWidth: "80px" }}>{pair.left}</span>
              <span style={{ color: "#94a3b8", fontSize: "16px" }}>→</span>
              <select value={(answers[q.id] || {})[i] || ""} onChange={e => setAnswers(a => ({ ...a, [q.id]: { ...(a[q.id] || {}), [i]: e.target.value } }))}
                style={{ flex: 1, padding: "8px 10px", border: "2px solid #e5e7eb", borderRadius: "7px", fontSize: "14px", background: "#fff", fontFamily: "inherit" }}>
                <option value="">– auswählen –</option>
                {(q.pairs || []).map((p, j) => <option key={j} value={p.right}>{p.right}</option>)}
              </select>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <TeacherLayout navigate={navigate} onLogout={onLogout} currentUser={currentUser} activePage="testEditor">
      <div style={{ padding: "24px 32px" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
          <div>
            <button onClick={() => navigate("testEditor", editingTest)} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "13px", padding: 0, marginBottom: "6px", display: "block" }}>
              ← Zurück zum Editor
            </button>
            <h1 style={{ fontSize: "20px", fontWeight: 800, color: "#0f172a", margin: 0 }}>
              Vorschau: {editingTest?.title || "Unbenannter Test"}
            </h1>
            <p style={{ color: "#64748b", fontSize: "13px", marginTop: "4px" }}>
              So sehen Schüler diesen Test · {realQuestions.length} Aufgaben
            </p>
          </div>
          <div style={{ background: "#fef9c3", border: "1px solid #fde68a", borderRadius: "10px", padding: "10px 16px", fontSize: "13px", color: "#92400e", fontWeight: 600 }}>
            👁 Vorschau-Modus — keine Antworten werden gespeichert
          </div>
        </div>

        {/* Simulated test — exact same layout as StudentTestView */}
        <div style={{ minHeight: "100vh", background: "#f1f5f9", borderRadius: "16px", padding: "0 0 40px" }}>

          {/* Sticky header simulation */}
          <div style={{ background: "#fff", borderRadius: "16px 16px 0 0", borderBottom: "2px solid #e2e8f0", padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: "17px", color: "#0f172a" }}>⚡ {editingTest?.title || "Test"}</div>
              <div style={{ fontSize: "13px", color: "#64748b" }}>Vorschau · {answeredCount}/{realQuestions.length} beantwortet</div>
            </div>
            <div style={{ textAlign: "center", flexShrink: 0 }}>
              <div style={{ fontSize: "32px", fontWeight: 900, color: "#16a34a", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                {editingTest?.time_limit ? `${Math.round(editingTest.time_limit / 60)}:00` : "20:00"}
              </div>
              <div style={{ height: "5px", background: "#e2e8f0", borderRadius: "4px", width: "90px", marginTop: "5px" }}>
                <div style={{ height: "5px", borderRadius: "4px", background: "#16a34a", width: "100%" }} />
              </div>
            </div>
            <button disabled style={{ padding: "12px 20px", background: "#dc2626", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "15px", opacity: 0.5, cursor: "not-allowed" }}>
              Abgeben
            </button>
          </div>

          <div style={{ maxWidth: "800px", margin: "0 auto", padding: "0 16px" }}>
            {/* Progress bar */}
            <div style={{ marginBottom: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#64748b", marginBottom: "6px" }}>
                <span>Fortschritt</span>
                <span>{answeredCount} / {realQuestions.length}</span>
              </div>
              <div style={{ height: "6px", background: "#e2e8f0", borderRadius: "6px" }}>
                <div style={{ height: "6px", borderRadius: "6px", background: "#2563a8", width: `${realQuestions.length > 0 ? (answeredCount / realQuestions.length) * 100 : 0}%`, transition: "width 0.3s" }} />
              </div>
            </div>

            {/* Questions — same rendering as StudentTestView */}
            {(() => {
              let sectionCounter = 0;
              let globalTaskCounter = 0;
              return allItems.map((q, index) => {
                if (q.type === "section") {
                  sectionCounter++;
                  const currentSectionNum = sectionCounter;
                  const taskStartNum = globalTaskCounter + 1;
                  globalTaskCounter += (q.tasks || []).length;
                  return (
                    <div key={q.id} style={{ marginBottom: "24px", marginTop: index > 0 ? "24px" : 0, background: "linear-gradient(135deg, #1e3a5f, #2563a8)", borderRadius: "18px", padding: "20px 16px 16px", color: "#fff" }}>
                      {/* Abschnitts-Header */}
                      <div style={{ marginBottom: "14px", paddingBottom: "14px", borderBottom: "1px solid rgba(255,255,255,0.15)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                          <span style={{ background: "rgba(255,255,255,0.2)", borderRadius: "8px", padding: "2px 10px", fontSize: "13px", fontWeight: 800 }}>Abschnitt {currentSectionNum}</span>
                          {q.sectionTitle && <div style={{ fontSize: "19px", fontWeight: 800 }}>{q.sectionTitle}</div>}
                        </div>
                        {q.sectionInstruction && (
                          <div style={{ fontSize: "14px", color: "#fff", background: "rgba(255,255,255,0.18)", borderRadius: "8px", padding: "8px 12px", marginBottom: q.sectionText && q.sectionText.replace(/<[^>]*>/g, "").trim() ? "12px" : 0, fontWeight: 500 }}>
                            {q.sectionInstruction}
                          </div>
                        )}
                        {q.sectionText && q.sectionText.replace(/<[^>]*>/g, "").trim() && (
                          <div style={{ background: "rgba(255,255,255,0.12)", borderRadius: "12px", padding: "16px", fontSize: "15px", lineHeight: 1.8, marginTop: "8px", wordBreak: "break-word", overflowWrap: "break-word", overflow: "hidden", color: "#fff" }}
                            dangerouslySetInnerHTML={{ __html: q.sectionText }} />
                        )}
                        {q.sectionMedia && q.sectionMediaType === "image" && (
                          <img src={q.sectionMedia} alt="" style={{ maxWidth: "100%", borderRadius: "10px", marginTop: "12px" }} />
                        )}
                      </div>

                      {(q.tasks || []).map((task, tIdx) => {
                        const globalTaskNum = taskStartNum + tIdx;
                        return (
                          <div key={task.id} style={{ background: "rgba(255,255,255,0.06)", borderRadius: "12px", padding: "12px", marginBottom: "10px", border: "1px solid rgba(255,255,255,0.12)" }}>
                            <div style={{ background: "rgba(0,0,0,0.25)", borderRadius: "8px", padding: "10px 14px", marginBottom: "10px" }}>
                              <div style={{ fontSize: "14px", fontWeight: 700, color: "#fff", marginBottom: task.taskInstruction ? "5px" : 0 }}>
                                Aufgabe {globalTaskNum}{task.taskTitle ? `: ${task.taskTitle}` : ""}
                              </div>
                              {task.taskInstruction && (
                                <div style={{ fontSize: "13px", color: "#e2e8f0", fontStyle: "italic", lineHeight: 1.5 }}>
                                  {task.taskInstruction}
                                </div>
                              )}
                            </div>
                            {task.taskText && task.taskText.replace(/<[^>]*>/g, "").trim() && (
                              <div style={{ background: "rgba(255,255,255,0.12)", borderRadius: "10px", padding: "14px 16px", marginBottom: "10px", fontSize: "14px", lineHeight: 1.8, color: "#fff", wordBreak: "break-word" }}
                                dangerouslySetInnerHTML={{ __html: task.taskText }} />
                            )}
                            {(task.questions || []).map((tq, tqIdx) => {
                              const isAns = Array.isArray(answers[tq.id]) ? answers[tq.id].length > 0 : answers[tq.id] !== undefined && answers[tq.id] !== "";
                              return (
                                <div key={tq.id} style={{ background: "#fff", borderRadius: "10px", padding: "14px 16px", marginBottom: "6px", border: `2px solid ${isAns ? "#bfdbfe" : "#e2e8f0"}` }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                      <span style={{ background: isAns ? "#2563a8" : "#64748b", color: "#fff", borderRadius: "6px", padding: "2px 8px", fontSize: "12px", fontWeight: 700, flexShrink: 0 }}>{globalTaskNum}.{tqIdx + 1}</span>
                                      <span style={{ fontSize: "14px", fontWeight: 600, color: "#0f172a" }}>{tq.text}</span>
                                    </div>
                                    <span style={{ fontSize: "11px", color: "#94a3b8", background: "#f1f5f9", borderRadius: "5px", padding: "2px 7px", flexShrink: 0, marginLeft: "8px" }}>{tq.points} Pkt.</span>
                                  </div>
                                  {renderQuestionInput(tq)}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  );
                }

                // Reguläre Frage
                const qIndex = allItems.slice(0, index).filter(x => x.type !== "section").length;
                const isAnswered = q.type === "fill_blank" && q.blanks?.length > 0
                  ? Array.isArray(answers[q.id]) && answers[q.id].some(a => a?.trim())
                  : q.type === "multiple_choice"
                  ? Array.isArray(answers[q.id]) ? answers[q.id].length > 0 : answers[q.id] !== undefined && answers[q.id] !== ""
                  : answers[q.id] !== undefined && answers[q.id] !== "";

                return (
                  <div key={q.id} style={{ background: COLORS[qIndex % COLORS.length], borderRadius: "16px", padding: "22px", marginBottom: "14px", border: isAnswered ? "2px solid #bfdbfe" : "2px solid #e2e8f0", transition: "border-color 0.2s" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px", gap: "12px" }}>
                      <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", flex: 1 }}>
                        <span style={{ background: isAnswered ? "#2563a8" : "#64748b", color: "#fff", borderRadius: "8px", padding: "4px 12px", fontSize: "14px", fontWeight: 700, flexShrink: 0 }}>{qIndex + 1}</span>
                        <span style={{ fontSize: "16px", fontWeight: 600, color: "#0f172a", lineHeight: 1.5 }}>{q.text || <em style={{ color: "#94a3b8" }}>Kein Aufgabentext</em>}</span>
                      </div>
                      <span style={{ fontSize: "13px", color: "#94a3b8", whiteSpace: "nowrap", flexShrink: 0, background: "#f1f5f9", borderRadius: "6px", padding: "3px 8px" }}>{q.points} Pkt.</span>
                    </div>
                    {renderQuestionInput(q)}
                  </div>
                );
              });
            })()}

            <button disabled style={{ width: "100%", padding: "18px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "14px", fontWeight: 800, fontSize: "17px", cursor: "not-allowed", opacity: 0.5, marginTop: "8px" }}>
              Test abgeben (nur im echten Test aktiv)
            </button>
          </div>
        </div>
      </div>
    </TeacherLayout>
  );
}
