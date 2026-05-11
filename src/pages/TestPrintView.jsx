import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

const flattenQs = (qs) => {
  const result = [];
  for (const q of (qs || [])) {
    if (q.type === "section") {
      for (const t of (q.tasks || [])) for (const tq of (t.questions || [])) result.push({ ...tq, _taskTitle: t.taskTitle });
    } else if (q.type === "task") {
      for (const tq of (q.questions || [])) result.push({ ...tq, _taskTitle: q.taskTitle });
    } else {
      result.push(q);
    }
  }
  return result;
};

const LINES_FOR_TYPE = { qa: 4, open: 4, fill_blank: 2, multiple_choice: 0, true_false: 0, assignment: 0 };

export default function TestPrintView({ assignment, navigate }) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data: group } = await supabase.from("groups").select("usernames").eq("id", assignment.group_id).single();
      let names = group?.usernames || [];
      if (typeof names === "string") try { names = JSON.parse(names); } catch { names = []; }
      // Nur relevante Schüler — bei Nachtest makeup_usernames
      if (assignment.makeup_usernames?.length) names = assignment.makeup_usernames;
      setStudents(names);
      setLoading(false);
    };
    load();
  }, []);

  const questions = flattenQs(assignment.question_data || []);
  const openQs = questions.filter(q => ["qa", "open", "fill_blank", "multiple_choice", "true_false", "assignment"].includes(q.type));
  const totalPoints = openQs.reduce((s, q) => s + Number(q.points || 0), 0);
  const date = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const testCode = String(assignment.id).slice(-6).toUpperCase();

  if (loading) return (
    <div style={{ padding: "40px", textAlign: "center", fontFamily: "Arial, sans-serif" }}>
      Wird geladen...
    </div>
  );

  return (
    <div style={{ fontFamily: "Arial, sans-serif" }}>
      {/* Toolbar — verschwindet beim Drucken */}
      <div className="no-print" style={{ position: "fixed", top: 0, left: 0, right: 0, background: "#1e3a5f", padding: "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 1000, boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }}>
        <div style={{ color: "#fff", fontWeight: 700, fontSize: "16px" }}>
          🖨️ Druckvorschau — {assignment.title} · {students.length} Schüler/innen
        </div>
        <div style={{ display: "flex", gap: "12px" }}>
          <button onClick={() => navigate("dashboard")} style={{ padding: "8px 16px", background: "rgba(255,255,255,0.15)", color: "#fff", border: "1px solid rgba(255,255,255,0.3)", borderRadius: "8px", cursor: "pointer", fontWeight: 600, fontSize: "14px" }}>
            ← Zurück
          </button>
          <button onClick={() => window.print()} style={{ padding: "8px 20px", background: "#16a34a", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: 700, fontSize: "14px" }}>
            🖨️ Drucken
          </button>
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-page { page-break-after: always; margin: 0; padding: 20mm 18mm 15mm 18mm; }
          .print-page:last-child { page-break-after: auto; }
          body { margin: 0; }
        }
        @media screen {
          .print-page { max-width: 794px; margin: 80px auto 0; padding: 32px 40px; background: #fff; box-shadow: 0 2px 16px rgba(0,0,0,0.12); margin-bottom: 24px; }
          body { background: #f1f5f9; }
        }
        .answer-line { border-bottom: 1px solid #999; margin: 6px 0; height: 22px; }
        .mc-option { display: flex; align-items: center; gap: 8px; margin: 4px 0; font-size: 13px; }
        .mc-box { width: 14px; height: 14px; border: 1.5px solid #333; display: inline-block; flex-shrink: 0; }
      `}</style>

      {students.map((username, si) => (
        <div key={username} className="print-page">
          {/* Header */}
          <div style={{ borderBottom: "2px solid #000", paddingBottom: "10px", marginBottom: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: "20px", fontWeight: 900, letterSpacing: "-0.3px" }}>{assignment.title}</div>
                <div style={{ fontSize: "12px", color: "#444", marginTop: "3px" }}>
                  Datum: {date} &nbsp;·&nbsp; Gesamt: {totalPoints} Punkte &nbsp;·&nbsp; Zeit: {Math.round((assignment.time_limit || 0) / 60)} Min.
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "13px", fontWeight: 700 }}>{username}</div>
                <div style={{ fontSize: "10px", color: "#666", marginTop: "2px", fontFamily: "monospace" }}>
                  [SCHÜLER: {username} | TEST: {testCode}]
                </div>
              </div>
            </div>
          </div>

          {/* Aufgaben */}
          {(() => {
            let qNum = 0;
            return (assignment.question_data || []).map((item, ti) => {
              if (item.type === "task") {
                const taskQs = item.questions || [];
                return (
                  <div key={item.id} style={{ marginBottom: "16px" }}>
                    {item.taskTitle && (
                      <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "6px", background: "#f0f0f0", padding: "4px 8px", borderRadius: "3px" }}>
                        {ti + 1}. {item.taskTitle}
                      </div>
                    )}
                    {item.taskText && (
                      <div style={{ fontSize: "12px", color: "#333", marginBottom: "8px", padding: "6px 8px", border: "1px solid #ddd", borderRadius: "3px" }}
                        dangerouslySetInnerHTML={{ __html: item.taskText }} />
                    )}
                    {taskQs.map((q, qi) => {
                      qNum++;
                      const num = qNum;
                      const lines = LINES_FOR_TYPE[q.type] ?? 3;
                      return (
                        <div key={q.id} style={{ marginBottom: "12px", paddingLeft: "8px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
                            <div style={{ fontSize: "13px", fontWeight: 600 }}>
                              {ti + 1}.{qi + 1} &nbsp;
                              {q.text ? <span dangerouslySetInnerHTML={{ __html: q.text }} /> : <span style={{ color: "#999", fontWeight: 400 }}>(Fragetext)</span>}
                            </div>
                            <div style={{ fontSize: "11px", color: "#666", flexShrink: 0, marginLeft: "8px" }}>/{q.points} Pkt.</div>
                          </div>
                          {q.type === "multiple_choice" && (
                            <div style={{ paddingLeft: "12px" }}>
                              {(q.options || []).map((opt, oi) => (
                                <div key={oi} className="mc-option">
                                  <span className="mc-box" /> {String.fromCharCode(65 + oi)}) {opt}
                                </div>
                              ))}
                            </div>
                          )}
                          {q.type === "true_false" && (
                            <div style={{ paddingLeft: "12px", display: "flex", gap: "20px" }}>
                              <div className="mc-option"><span className="mc-box" /> Wahr</div>
                              <div className="mc-option"><span className="mc-box" /> Falsch</div>
                            </div>
                          )}
                          {q.type === "assignment" && (
                            <div style={{ paddingLeft: "12px" }}>
                              {(q.pairs || []).map((p, pi) => (
                                <div key={pi} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", fontSize: "12px" }}>
                                  <span style={{ fontWeight: 600, minWidth: "80px" }}>{p.left}</span>
                                  <span style={{ flex: 1, borderBottom: "1px solid #999" }}>&nbsp;</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {q.type === "fill_blank" && (
                            <div style={{ fontSize: "12px", paddingLeft: "12px", lineHeight: 2 }}
                              dangerouslySetInnerHTML={{ __html: (q.fullText || q.text || "").replace(/\[Lücke\]/g, '<span style="display:inline-block;min-width:60px;border-bottom:1.5px solid #333;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>') }} />
                          )}
                          {(q.type === "qa" || q.type === "open") && Array.from({ length: lines }).map((_, li) => (
                            <div key={li} className="answer-line" />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              }
              return null;
            });
          })()}

          {/* Footer */}
          <div style={{ marginTop: "20px", borderTop: "1px solid #ccc", paddingTop: "8px", display: "flex", justifyContent: "space-between", fontSize: "10px", color: "#888" }}>
            <span>QuickTest · {assignment.title} · {date}</span>
            <span>Seite {si + 1} von {students.length}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
