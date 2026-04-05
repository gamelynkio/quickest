import { useState } from "react";
import TeacherLayout from "../components/TeacherLayout";

export default function TestPreview({ navigate, onLogout, currentUser, editingTest, questions }) {
  const [answers, setAnswers] = useState({});
  const [currentSection, setCurrentSection] = useState(null);

  const allItems = questions || [];
  const realQuestions = allItems.filter(q => q.type !== "section");

  const S = {
    page: { minHeight: "100vh", background: "linear-gradient(135deg, #1e3a5f 0%, #2563a8 100%)", fontFamily: "'Segoe UI', system-ui, sans-serif", padding: "20px" },
    card: { background: "#fff", borderRadius: "20px", padding: "28px 28px", maxWidth: "720px", margin: "0 auto", marginBottom: "16px" },
    qCard: { background: "#fff", borderRadius: "16px", padding: "22px 24px", maxWidth: "720px", margin: "0 auto 14px" },
  };

  const renderMedia = (section) => {
    if (!section.sectionMedia) return null;
    if (section.sectionMediaType === "image") return (
      <img src={section.sectionMedia} alt="" style={{ maxWidth: "100%", borderRadius: "10px", marginBottom: "14px" }} />
    );
    if (section.sectionMediaType === "video") return (
      <div style={{ position: "relative", paddingBottom: "56.25%", height: 0, marginBottom: "14px" }}>
        <iframe src={section.sectionMedia} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", borderRadius: "10px" }} frameBorder="0" allowFullScreen />
      </div>
    );
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
              So sehen Schüler diesen Test — {realQuestions.length} Aufgaben
            </p>
          </div>
          <div style={{ background: "#fef9c3", border: "1px solid #fde68a", borderRadius: "10px", padding: "10px 16px", fontSize: "13px", color: "#92400e", fontWeight: 600 }}>
            👁 Vorschau-Modus — keine echten Antworten werden gespeichert
          </div>
        </div>

        {/* Simulated test */}
        <div style={S.page}>
          {/* Test header card */}
          <div style={S.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <span style={{ fontSize: "22px" }}>⚡</span>
              <div style={{ background: "#f1f5f9", borderRadius: "8px", padding: "6px 14px", fontSize: "14px", fontWeight: 700, color: "#374151" }}>
                ⏱ {editingTest?.time_limit ? Math.round(editingTest.time_limit / 60) : 20} Min.
              </div>
            </div>
            <h2 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: "0 0 6px" }}>{editingTest?.title || "Test"}</h2>
            {editingTest?.description && <p style={{ color: "#64748b", fontSize: "14px", margin: 0 }}>{editingTest.description}</p>}
          </div>

          {/* Questions */}
          {allItems.map((item, idx) => {
            if (item.type === "section") return (
              <div key={item.id} style={{ ...S.card, background: "#f0f7ff", border: "1px solid #bfdbfe" }}>
                {item.sectionTitle && <h3 style={{ fontSize: "18px", fontWeight: 800, color: "#1e40af", margin: "0 0 10px" }}>{item.sectionTitle}</h3>}
                {item.sectionInstruction && <p style={{ fontSize: "14px", color: "#374151", margin: "0 0 12px", fontStyle: "italic" }}>{item.sectionInstruction}</p>}
                {renderMedia(item)}
                {item.sectionText && (
                  <div style={{ fontSize: "15px", lineHeight: 1.7, color: "#1e293b", wordBreak: "break-word", overflowWrap: "break-word", overflow: "hidden" }}
                    dangerouslySetInnerHTML={{ __html: item.sectionText }} />
                )}
              </div>
            );

            const qNum = allItems.slice(0, idx).filter(q => q.type !== "section").length + 1;
            return (
              <div key={item.id} style={S.qCard}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#64748b" }}>Aufgabe {qNum}</span>
                  <span style={{ fontSize: "12px", background: "#f1f5f9", borderRadius: "6px", padding: "2px 8px", color: "#64748b" }}>{item.points || 1} Pkt.</span>
                </div>
                <p style={{ fontSize: "15px", fontWeight: 600, color: "#0f172a", margin: "0 0 16px", lineHeight: 1.5 }}>{item.text || <em style={{ color: "#94a3b8" }}>Kein Aufgabentext</em>}</p>

                {item.type === "multiple_choice" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {(item.options || []).map((opt, i) => (
                      <button key={i} onClick={() => setAnswers(a => ({ ...a, [item.id]: i }))}
                        style={{ padding: "12px 16px", border: `2px solid ${answers[item.id] === i ? "#2563a8" : "#e2e8f0"}`, borderRadius: "10px", background: answers[item.id] === i ? "#eff6ff" : "#f8fafc", textAlign: "left", cursor: "pointer", fontSize: "14px", color: answers[item.id] === i ? "#1e40af" : "#374151", fontWeight: answers[item.id] === i ? 600 : 400 }}>
                        {opt || <em style={{ color: "#94a3b8" }}>Option {i + 1}</em>}
                      </button>
                    ))}
                  </div>
                )}

                {item.type === "true_false" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    {["Wahr", "Falsch"].map((opt, i) => (
                      <button key={i} onClick={() => setAnswers(a => ({ ...a, [item.id]: i }))}
                        style={{ padding: "16px", border: `2px solid ${answers[item.id] === i ? "#2563a8" : "#e2e8f0"}`, borderRadius: "12px", background: answers[item.id] === i ? "#2563a8" : "#f8fafc", cursor: "pointer", fontWeight: 700, fontSize: "16px", color: answers[item.id] === i ? "#fff" : "#374151" }}>
                        {opt}
                      </button>
                    ))}
                  </div>
                )}

                {item.type === "open" && (
                  <textarea value={answers[item.id] || ""} onChange={e => setAnswers(a => ({ ...a, [item.id]: e.target.value }))}
                    placeholder="Deine Antwort..."
                    rows={4}
                    style={{ width: "100%", padding: "12px 14px", border: "2px solid #e2e8f0", borderRadius: "10px", fontSize: "14px", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
                )}

                {item.type === "flashcard" && (
                  <div>
                    <div style={{ background: "#f8fafc", borderRadius: "12px", padding: "20px", textAlign: "center", marginBottom: "12px", border: "2px solid #e2e8f0" }}>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", marginBottom: "8px" }}>A-SEITE</div>
                      <div style={{ fontSize: "20px", fontWeight: 800, color: "#0f172a" }}>{item.cardFront || <em style={{ color: "#94a3b8" }}>Vorderseite</em>}</div>
                    </div>
                    <input value={answers[item.id] || ""} onChange={e => setAnswers(a => ({ ...a, [item.id]: e.target.value }))}
                      placeholder="B-Seite eingeben..."
                      style={{ width: "100%", padding: "14px", border: "2px solid #e2e8f0", borderRadius: "10px", fontSize: "16px", textAlign: "center", fontFamily: "inherit", boxSizing: "border-box" }} />
                  </div>
                )}

                {item.type === "fill_blank" && (
                  <div style={{ fontSize: "15px", lineHeight: 2.5, background: "#f8fafc", borderRadius: "10px", padding: "14px" }}>
                    {(item.fullText || item.text || "").split("[Lücke]").map((part, i, arr) => (
                      <span key={i}>
                        {part}
                        {i < arr.length - 1 && (
                          <input style={{ display: "inline-block", width: "100px", padding: "2px 6px", border: "none", borderBottom: "2px solid #2563a8", background: "transparent", fontSize: "15px", textAlign: "center", fontFamily: "inherit" }} placeholder="___" />
                        )}
                      </span>
                    ))}
                  </div>
                )}

                {item.type === "assignment" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#64748b", marginBottom: "8px" }}>BEGRIFFE</div>
                      {(item.pairs || []).map((p, i) => (
                        <div key={i} style={{ background: "#f8fafc", borderRadius: "8px", padding: "10px 14px", marginBottom: "6px", fontSize: "14px", fontWeight: 600 }}>{p.left || `Begriff ${i + 1}`}</div>
                      ))}
                    </div>
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#64748b", marginBottom: "8px" }}>DEFINITIONEN</div>
                      {(item.pairs || []).map((p, i) => (
                        <div key={i} style={{ background: "#eff6ff", borderRadius: "8px", padding: "10px 14px", marginBottom: "6px", fontSize: "14px", color: "#1e40af" }}>{p.right || `Definition ${i + 1}`}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Submit button preview */}
          <div style={{ maxWidth: "720px", margin: "0 auto", paddingBottom: "40px" }}>
            <button disabled style={{ width: "100%", padding: "16px", background: "#dc2626", color: "#fff", border: "none", borderRadius: "12px", fontWeight: 700, fontSize: "16px", cursor: "not-allowed", opacity: 0.7 }}>
              Test abgeben (nur im echten Test aktiv)
            </button>
          </div>
        </div>
      </div>
    </TeacherLayout>
  );
}
