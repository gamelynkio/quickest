import { useState } from "react";
import TeacherLayout from "../components/TeacherLayout";

const ADJECTIVES = ["blauer", "roter", "grüner", "schneller", "kluger", "starker", "leiser", "großer", "freier", "alter"];
const ANIMALS = ["Adler", "Tiger", "Fuchs", "Wolf", "Bär", "Luchs", "Falke", "Dachs", "Hirsch", "Storch"];

const generateUsername = () => {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${adj}-${animal}`;
};

const DEMO_GROUPS = [
  { id: 1, name: "Klasse 6a", subject: "Mathematik", count: 24, usernames: [] },
  { id: 2, name: "Klasse 7b", subject: "Deutsch", count: 22, usernames: [] },
];

export default function GroupManager({ navigate, onLogout, currentUser }) {
  const [groups, setGroups] = useState(DEMO_GROUPS);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const [newCount, setNewCount] = useState(20);
  const [expandedGroup, setExpandedGroup] = useState(null);

  const createGroup = () => {
    const usernames = Array.from({ length: newCount }, () => generateUsername());
    setGroups(prev => [...prev, { id: Date.now(), name: newName, subject: newSubject, count: newCount, usernames }]);
    setNewName(""); setNewSubject(""); setNewCount(20);
    setShowForm(false);
  };

  const generateForGroup = (id) => {
    setGroups(prev => prev.map(g =>
      g.id === id ? { ...g, usernames: Array.from({ length: g.count }, () => generateUsername()) } : g
    ));
    setExpandedGroup(id);
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
                <input type="number" value={newCount} min={1} max={40} onChange={e => setNewCount(Number(e.target.value))}
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
                <button style={{
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
