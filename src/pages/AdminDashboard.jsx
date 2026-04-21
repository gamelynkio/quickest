import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const ADMIN_PASSWORD = "quick123";

const STAT_COLORS = {
  users: "#6366f1",
  tests: "#0ea5e9",
  assignments: "#10b981",
  submissions: "#f59e0b",
};

export default function AdminDashboard() {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  const login = () => {
    if (pw === ADMIN_PASSWORD) { setAuthed(true); setPwError(false); }
    else { setPwError(true); }
  };

  useEffect(() => {
    if (!authed) return;
    setLoading(true);
    Promise.all([
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("templates").select("id, title, subject, grade_level, created_at, teacher_id").order("created_at", { ascending: false }),
      supabase.from("assignments").select("id, title, status, timing_mode, created_at, teacher_id").order("created_at", { ascending: false }),
      supabase.from("submissions").select("id, username, submitted_at, score, grade, assignment_id").order("submitted_at", { ascending: false }),
    ]).then(([p, t, a, s]) => {
      setProfiles(p.data || []);
      setTemplates(t.data || []);
      setAssignments(a.data || []);
      setSubmissions(s.data || []);
      setLoading(false);
    });
  }, [authed]);

  if (!authed) return (
    <div style={{ minHeight: "100vh", background: "#0f0f13", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      <div style={{ width: "340px", textAlign: "center" }}>
        <div style={{ fontSize: "32px", fontWeight: 900, color: "#fff", letterSpacing: "-1px", marginBottom: "4px" }}>⚡ QuickTest</div>
        <div style={{ fontSize: "12px", color: "#6b7280", letterSpacing: "3px", textTransform: "uppercase", marginBottom: "40px" }}>Founder Dashboard</div>
        <input
          type="password" value={pw} onChange={e => { setPw(e.target.value); setPwError(false); }}
          onKeyDown={e => e.key === "Enter" && login()}
          placeholder="Passwort"
          style={{ width: "100%", padding: "14px 16px", background: "#1a1a24", border: `1px solid ${pwError ? "#ef4444" : "#2a2a38"}`, borderRadius: "10px", color: "#fff", fontSize: "15px", fontFamily: "inherit", boxSizing: "border-box", outline: "none", marginBottom: "10px" }}
        />
        {pwError && <div style={{ color: "#ef4444", fontSize: "13px", marginBottom: "10px" }}>Falsches Passwort</div>}
        <button onClick={login} style={{ width: "100%", padding: "14px", background: "#6366f1", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "15px", cursor: "pointer" }}>
          Einloggen
        </button>
      </div>
    </div>
  );

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#0f0f13", display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280", fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      Lade Daten...
    </div>
  );

  // Stats
  const today = new Date();
  const last30 = new Date(today - 30 * 864e5);
  const last7 = new Date(today - 7 * 864e5);
  const newUsersMonth = profiles.filter(p => new Date(p.created_at) >= last30).length;
  const newUsersWeek = profiles.filter(p => new Date(p.created_at) >= last7).length;
  const testsMonth = templates.filter(t => new Date(t.created_at) >= last30).length;
  const assignmentsMonth = assignments.filter(a => new Date(a.created_at) >= last30).length;
  const submissionsMonth = submissions.filter(s => new Date(s.submitted_at) >= last30).length;

  // Templates by subject
  const bySubject = templates.reduce((acc, t) => { acc[t.subject || "Sonstiges"] = (acc[t.subject || "Sonstiges"] || 0) + 1; return acc; }, {});
  const subjectsSorted = Object.entries(bySubject).sort((a, b) => b[1] - a[1]);

  // Assignments by timing_mode
  const byMode = assignments.reduce((acc, a) => { acc[a.timing_mode || "countdown"] = (acc[a.timing_mode || "countdown"] || 0) + 1; return acc; }, {});

  // Enrich profiles with their activity
  const profilesWithStats = profiles.map(p => ({
    ...p,
    templatesCount: templates.filter(t => t.teacher_id === p.id).length,
    assignmentsCount: assignments.filter(a => a.teacher_id === p.id).length,
  }));

  const TABS = ["overview", "users", "tests", "assignments"];
  const TAB_LABELS = { overview: "Übersicht", users: "Nutzer", tests: "Vorlagen", assignments: "Zuweisungen" };

  const S = {
    page: { minHeight: "100vh", background: "#0f0f13", fontFamily: "'Segoe UI', system-ui, sans-serif", color: "#fff" },
    header: { background: "#14141f", borderBottom: "1px solid #1e1e2e", padding: "16px 32px", display: "flex", alignItems: "center", gap: "16px" },
    card: { background: "#14141f", border: "1px solid #1e1e2e", borderRadius: "12px", padding: "20px 24px" },
    label: { fontSize: "11px", color: "#6b7280", fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase", marginBottom: "6px" },
    val: { fontSize: "32px", fontWeight: 800, lineHeight: 1 },
    sub: { fontSize: "12px", color: "#6b7280", marginTop: "4px" },
    th: { padding: "10px 16px", textAlign: "left", fontSize: "11px", color: "#6b7280", fontWeight: 600, letterSpacing: "0.5px", borderBottom: "1px solid #1e1e2e" },
    td: { padding: "12px 16px", fontSize: "13px", borderBottom: "1px solid #1a1a24" },
  };

  const fmt = (d) => new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const fmtFull = (d) => new Date(d).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <span style={{ fontSize: "18px", fontWeight: 900, letterSpacing: "-0.5px" }}>⚡ QuickTest</span>
        <span style={{ fontSize: "11px", color: "#6b7280", letterSpacing: "2px", textTransform: "uppercase" }}>Founder Dashboard</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "4px" }}>
          {TABS.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{ padding: "6px 14px", background: activeTab === tab ? "#6366f1" : "transparent", color: activeTab === tab ? "#fff" : "#6b7280", border: "none", borderRadius: "7px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
        <button onClick={() => setAuthed(false)} style={{ padding: "6px 12px", background: "none", border: "1px solid #2a2a38", color: "#6b7280", borderRadius: "7px", fontSize: "12px", cursor: "pointer", marginLeft: "8px" }}>
          Abmelden
        </button>
      </div>

      <div style={{ padding: "32px", maxWidth: "1100px" }}>

        {/* OVERVIEW TAB */}
        {activeTab === "overview" && (
          <>
            {/* Stat Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "28px" }}>
              {[
                { label: "Lehrer gesamt", val: profiles.length, sub: `+${newUsersWeek} diese Woche`, color: STAT_COLORS.users },
                { label: "Vorlagen erstellt", val: templates.length, sub: `+${testsMonth} diesen Monat`, color: STAT_COLORS.tests },
                { label: "Tests zugewiesen", val: assignments.length, sub: `+${assignmentsMonth} diesen Monat`, color: STAT_COLORS.assignments },
                { label: "Abgaben total", val: submissions.length, sub: `+${submissionsMonth} diesen Monat`, color: STAT_COLORS.submissions },
              ].map(s => (
                <div key={s.label} style={{ ...S.card, borderLeft: `3px solid ${s.color}` }}>
                  <div style={S.label}>{s.label}</div>
                  <div style={{ ...S.val, color: s.color }}>{s.val}</div>
                  <div style={S.sub}>{s.sub}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              {/* Neue Nutzer */}
              <div style={S.card}>
                <div style={{ fontWeight: 700, marginBottom: "16px", fontSize: "14px" }}>Neue Lehrer (letzte 30 Tage)</div>
                {profilesWithStats.filter(p => new Date(p.created_at) >= last30).length === 0
                  ? <div style={{ color: "#6b7280", fontSize: "13px" }}>Keine neuen Nutzer</div>
                  : profilesWithStats.filter(p => new Date(p.created_at) >= last30).map(p => (
                    <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #1e1e2e" }}>
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: 600 }}>{p.name || "–"}</div>
                        <div style={{ fontSize: "11px", color: "#6b7280" }}>{p.email}</div>
                      </div>
                      <div style={{ fontSize: "11px", color: "#6b7280" }}>{fmt(p.created_at)}</div>
                    </div>
                  ))
                }
              </div>

              {/* Fächer */}
              <div style={S.card}>
                <div style={{ fontWeight: 700, marginBottom: "16px", fontSize: "14px" }}>Vorlagen nach Fach</div>
                {subjectsSorted.slice(0, 8).map(([subject, count]) => (
                  <div key={subject} style={{ marginBottom: "8px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                      <span style={{ fontSize: "12px" }}>{subject}</span>
                      <span style={{ fontSize: "12px", color: "#6b7280" }}>{count}</span>
                    </div>
                    <div style={{ height: "4px", background: "#1e1e2e", borderRadius: "4px" }}>
                      <div style={{ height: "4px", borderRadius: "4px", background: "#6366f1", width: `${(count / (subjectsSorted[0]?.[1] || 1)) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Test-Modi */}
              <div style={S.card}>
                <div style={{ fontWeight: 700, marginBottom: "16px", fontSize: "14px" }}>Zuweisungen nach Modus</div>
                {Object.entries(byMode).map(([mode, count]) => (
                  <div key={mode} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1e1e2e", fontSize: "13px" }}>
                    <span style={{ textTransform: "capitalize" }}>{mode === "lobby" ? "🎮 Lobby" : mode === "countdown" ? "⏱ Countdown" : mode === "window" ? "📅 Zeitfenster" : mode}</span>
                    <span style={{ color: "#6b7280" }}>{count} ({Math.round(count / assignments.length * 100)}%)</span>
                  </div>
                ))}
              </div>

              {/* Top-Lehrer nach Aktivität */}
              <div style={S.card}>
                <div style={{ fontWeight: 700, marginBottom: "16px", fontSize: "14px" }}>Aktivste Lehrer</div>
                {profilesWithStats.sort((a, b) => b.assignmentsCount - a.assignmentsCount).slice(0, 6).map(p => (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1e1e2e", fontSize: "13px" }}>
                    <span>{p.name || p.email}</span>
                    <span style={{ color: "#6b7280" }}>{p.assignmentsCount} Tests · {p.templatesCount} Vorlagen</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* USERS TAB */}
        {activeTab === "users" && (
          <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #1e1e2e", fontSize: "14px", fontWeight: 700 }}>
              Alle Lehrer ({profiles.length})
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Name", "E-Mail", "Registriert", "Vorlagen", "Zuweisungen"].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {profilesWithStats.map(p => (
                  <tr key={p.id}>
                    <td style={S.td}>{p.name || "–"}</td>
                    <td style={{ ...S.td, color: "#6b7280" }}>{p.email}</td>
                    <td style={{ ...S.td, color: "#6b7280" }}>{fmtFull(p.created_at)}</td>
                    <td style={{ ...S.td, color: "#10b981", fontWeight: 600 }}>{p.templatesCount}</td>
                    <td style={{ ...S.td, color: "#0ea5e9", fontWeight: 600 }}>{p.assignmentsCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TESTS TAB */}
        {activeTab === "tests" && (
          <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #1e1e2e", fontSize: "14px", fontWeight: 700 }}>
              Alle Vorlagen ({templates.length})
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Titel", "Fach", "Klasse", "Erstellt", "Lehrer"].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {templates.map(t => {
                  const teacher = profiles.find(p => p.id === t.teacher_id);
                  return (
                    <tr key={t.id}>
                      <td style={{ ...S.td, fontWeight: 600 }}>{t.title}</td>
                      <td style={{ ...S.td, color: "#6b7280" }}>{t.subject || "–"}</td>
                      <td style={{ ...S.td, color: "#6b7280" }}>{t.grade_level ? `${t.grade_level}. Klasse` : "–"}</td>
                      <td style={{ ...S.td, color: "#6b7280" }}>{fmt(t.created_at)}</td>
                      <td style={{ ...S.td, color: "#6b7280" }}>{teacher?.name || teacher?.email || "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ASSIGNMENTS TAB */}
        {activeTab === "assignments" && (
          <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #1e1e2e", fontSize: "14px", fontWeight: 700 }}>
              Alle Zuweisungen ({assignments.length})
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Titel", "Status", "Modus", "Abgaben", "Erstellt", "Lehrer"].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {assignments.map(a => {
                  const teacher = profiles.find(p => p.id === a.teacher_id);
                  const subCount = submissions.filter(s => s.assignment_id === a.id).length;
                  const statusColor = a.status === "aktiv" ? "#10b981" : a.status === "beendet" ? "#6b7280" : "#f59e0b";
                  return (
                    <tr key={a.id}>
                      <td style={{ ...S.td, fontWeight: 600 }}>{a.title}</td>
                      <td style={S.td}>
                        <span style={{ background: statusColor + "22", color: statusColor, borderRadius: "5px", padding: "2px 8px", fontSize: "11px", fontWeight: 700 }}>{a.status}</span>
                      </td>
                      <td style={{ ...S.td, color: "#6b7280" }}>{a.timing_mode || "–"}</td>
                      <td style={{ ...S.td, color: "#0ea5e9", fontWeight: 600 }}>{subCount}</td>
                      <td style={{ ...S.td, color: "#6b7280" }}>{fmt(a.created_at)}</td>
                      <td style={{ ...S.td, color: "#6b7280" }}>{teacher?.name || teacher?.email || "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      </div>
    </div>
  );
}
