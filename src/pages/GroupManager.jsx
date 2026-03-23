import { useState } from "react";
import TeacherLayout from "../components/TeacherLayout";

const ADJECTIVES = ["blauer", "roter", "grüner", "schneller", "kluger", "starker", "leiser", "großer", "freier", "alter", "wilder", "sanfter", "mutiger", "flinker", "weiser", "treuer", "stolzer", "kühner", "wacher", "schlauer", "ruhiger", "fleißiger", "tapferer", "heller", "dunkler"];
const ANIMALS = ["Adler", "Tiger", "Fuchs", "Wolf", "Bär", "Luchs", "Falke", "Dachs", "Hirsch", "Storch", "Igel", "Otter", "Rabe", "Elch", "Biber", "Marder", "Habicht", "Wisent", "Uhu", "Fischotter", "Steinbock", "Lämmergeier", "Rotmilan", "Seehund", "Zander"];

const generateUsernames = (count) => {
  const all = [];
  for (const adj of ADJECTIVES) {
    for (const animal of ANIMALS) {
      all.push(`${adj}-${animal}`);
    }
  }
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, count);
};

export default function GroupManager({ navigate, onLogout, currentUser, groups, setGroups }) {
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const [newCount, setNewCount] = useState(20);
  const [expandedGroup, setExpandedGroup] = useState(null);

  const createGroup = () => {
    const count = parseInt(newCount, 10);
    const usernames = generateUsernames(count);
    setGroups(prev => [...prev, { id: Date.now(), name: newName, subject: newSubject, count, usernames }]);
    setNewName(""); setNewSubject(""); setNewCount(20);
    setShowForm(false);
  };

  const generateForGroup = (id) => {
    setGroups(prev => prev.map(g =>
      g.id === id ? { ...g, usernames: generateUsernames(g.count) } : g
    ));
    setExpandedGroup(id);
  };

  const exportPDF = (group) => {
    const rows = group.usernames.map((u, i) =>
      `<tr style="border-bottom:1px solid #e2e8f0">
        <td style="padding:8px 12px;color:#94a3b8">${i + 1}</td>
        <td style="padding:8px 12px;font-weight:600">${u}</td>
        <td style="padding:8px 12px;font-weight:700;color:#2563a8">1234</td>
      </tr>`
    ).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Benutzernamen - ${group.name}</title>
    <style>body{font-family:sans-serif;padding:32px}h1{font-size:20px;margin-bottom:4px}p{color:#64748b;font-size:13px;margin-bottom:24px}table{width:100%;border-collapse:collapse}th{text-align:left;padding:8px 12px;background:#f8fafc;font-size:12px;color:#94a3b8;border-bottom:2px solid #e2e8f0}</style>
    </head><body>
    <h1>QuickTest - ${group.name}</h1>
    <p>${group.subject} · ${group.count} Schüler/innen · Bitte nicht weitergeben!</p>
    <table><thead><tr><th>#</th><th>Benutzername</th><th>PIN</th></tr></thead><tbody>${rows}</tbody></table>
    </body></html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `QuickTest_${group.name.replace(/\s/g, "_")}_Benutzernamen.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <TeacherLayout navigate={navigate} onLogout={onLogout} currentUser={currentUser} activePage="groups">
      <div style={{ padding: "32px", maxWidth: "860px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "28px" }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: 0 }}>Lerngruppen</h1>
            <p style={{ color: "#64748b", fontSize: "14px", marginTop: "4px" }}>Verwalte deine Klassen und anonymisierten Benutzernamen.</p>
          </div>
          <button onClick={() => setShowForm(f => !f)} style={{
            padding: "10px 20px", background: "#2563a8", color: "#fff",
            border: "none", borderRadius: "10px", fontWeight: 600, fontSize: "13px", cursor: "pointer"
          }}>+ Neue Gruppe</button>
        </div>

        {showForm && (
          <div style={{ background: "#fff", borderRadius: "16px", padding: "24px", border: "1px solid #e2e8f0", marginBottom: "20px" }}>
            <h3 style={{ margin: "0 0 16px", fontSize: "16px", fontWeight: 700 }}>Neue Lerngruppe anlegen</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "12px", alignItems: "end" }}>
              <div>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "5px" }}>Klasse / Gruppe</label>
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="z.B. Klasse 8c"
                  style={{ width: "100%", padding: "9px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", fontFamily: "inherit" }} />
              </div>
              <div>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "5px" }}>Fach</label>
                <input value={newSubject} onChange={e => setNewSubject(e.target.value)} placeholder="z.B. Englisch"
                  style={{ width: "100%", padding: "9px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box", fontFamily: "inherit" }} />
              </div>
              <div>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "5px" }}>Schüleranzahl</label>
                <input type="number" value={newCount} min={1} max={625} onChange={e => setNewCount(e.target.value)}
                  style={{ width: "80px", padding: "9px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", fontFamily: "inherit" }} />
              </div>
            </div>
            <div style={{ marginTop: "16px", display: "flex", gap: "10px" }}>
              <button onClick={createGroup} disabled={!newName} style={{
                padding: "9px 20px", background: "#2563a8", color: "#fff",
                border: "none", borderRadius: "9px", fontWeight: 600, fontSize: "13px",
                cursor: newName ? "pointer" : "not-allowed", opacity: newName ? 1 : 0.5
              }}>Gruppe erstellen & Benutzernamen generieren</button>
              <button onClick={() => setShowForm(false)} style={{
                padding: "9px 16px", background: "#f1f5f9", color: "#374151",
                border: "none", borderRadius: "9px", fontWeight: 600, fontSize: "13px", cursor: "pointer"
              }}>Abbrechen</button>
            </div>
          </div>
        )}

        {groups.map(group => (
          <div key={group.id} style={{ background: "#fff", borderRadius: "16px", border: "1px solid #e2e8f0", marginBottom: "14px", overflow: "hidden" }}>
            <div style={{ padding: "18px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: "16px", color: "#0f172a" }}>{group.name}</div>
                <div style={{ fontSize: "13px", color: "#64748b", marginTop: "2px" }}>{group.subject} · {group.count} Schüler/innen</div>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={() => generateForGroup(group.id)} style={{
                  padding: "7px 16px", background: "#f0f7ff", color: "#2563a8",
                  border: "1px solid #bfdbfe", borderRadius: "8px", fontWeight: 600, fontSize: "13px", cursor: "pointer"
                }}>🔄 Benutzernamen generieren</button>
                <button onClick={() => setExpandedGroup(expandedGroup === group.id ? null : group.id)} style={{
                  padding: "7px 12px", background: "#f8fafc", color: "#374151",
                  border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "13px", cursor: "pointer"
                }}>{expandedGroup === group.id ? "▲" : "▼"}</button>
              </div>
            </div>
            {expandedGroup === group.id && group.usernames.length > 0 && (
              <div style={{ padding: "0 24px 20px", borderTop: "1px solid #f1f5f9" }}>
                <p style={{ fontSize: "13px", color: "#64748b", marginBottom: "12px", marginTop: "14px" }}>
                  Diese Benutzernamen an die Schüler/innen weitergeben. PIN = <strong>1234</strong>
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                  {group.usernames.map((u, i) => (
                    <div key={i} style={{ background: "#f8fafc", borderRadius: "8px", padding: "8px 12px", fontSize: "13px", color: "#374151", border: "1px solid #e2e8f0" }}>
                      <span style={{ color: "#94a3b8", fontSize: "11px", display: "block" }}>#{i + 1}</span>
                      {u}
                    </div>
                  ))}
                </div>
                <button onClick={() => exportPDF(group)} style={{
                  marginTop: "12px", padding: "8px 16px", background: "#16a34a", color: "#fff",
                  border: "none", borderRadius: "8px", fontWeight: 600, fontSize: "13px", cursor: "pointer"
                }}>📋 Als PDF exportieren</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </TeacherLayout>
  );
}
