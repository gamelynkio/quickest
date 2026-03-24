import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import TeacherLayout from "../components/TeacherLayout";

const ADJECTIVES = ["blauer","roter","grüner","schneller","kluger","starker","leiser","großer","freier","alter","wilder","sanfter","mutiger","flinker","weiser","treuer","stolzer","kühner","wacher","schlauer","ruhiger","fleißiger","tapferer","heller","dunkler"];
const ANIMALS = ["Adler","Tiger","Fuchs","Wolf","Bär","Luchs","Falke","Dachs","Hirsch","Storch","Igel","Otter","Rabe","Elch","Biber","Marder","Habicht","Wisent","Uhu","Fischotter","Steinbock","Lämmergeier","Rotmilan","Seehund","Zander"];

const generateUsernames = (count, existing = []) => {
  const all = [];
  for (const adj of ADJECTIVES) for (const animal of ANIMALS) all.push(`${adj}-${animal}`);
  const available = all.filter(u => !existing.includes(u));
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }
  return available.slice(0, count);
};

export default function GroupManager({ navigate, onLogout, currentUser }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState(null);
  const [newName, setNewName] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const [newCount, setNewCount] = useState(20);
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [removingFrom, setRemovingFrom] = useState(null);
  const [selectedToRemove, setSelectedToRemove] = useState(new Set());
  const [regenConfirm, setRegenConfirm] = useState(null);

  useEffect(() => { fetchGroups(); }, []);

  const fetchGroups = async () => {
    setLoading(true);
    const { data } = await supabase.from("groups").select("*").order("created_at", { ascending: false });
    setGroups(data || []);
    setLoading(false);
  };

  const openNewForm = () => { setEditingGroup(null); setNewName(""); setNewSubject(""); setNewCount(20); setShowForm(true); };
  const openEditForm = (g) => { setEditingGroup(g); setNewName(g.name); setNewSubject(g.subject); setNewCount(g.count); setShowForm(true); };

  const saveGroup = async () => {
    const count = parseInt(newCount, 10);
    setSaving(true);
    try {
      if (editingGroup) {
        const existing = editingGroup.usernames || [];
        const diff = count - existing.length;
        if (diff > 0) {
          const newUsernames = generateUsernames(diff, existing);
          const updatedUsernames = [...existing, ...newUsernames];
          const { data } = await supabase.from("groups").update({ name: newName, subject: newSubject, count, usernames: updatedUsernames }).eq("id", editingGroup.id).select().single();
          const newStudents = newUsernames.map(u => ({ group_id: editingGroup.id, username: u, pin: "1234" }));
          await supabase.from("students").insert(newStudents);
          setGroups(prev => prev.map(g => g.id === editingGroup.id ? data : g));
          setShowForm(false); setEditingGroup(null);
        } else if (diff < 0) {
          setShowForm(false);
          setRemovingFrom({ group: editingGroup, newName, newSubject, count });
          setSelectedToRemove(new Set());
        } else {
          const { data } = await supabase.from("groups").update({ name: newName, subject: newSubject }).eq("id", editingGroup.id).select().single();
          setGroups(prev => prev.map(g => g.id === editingGroup.id ? data : g));
          setShowForm(false); setEditingGroup(null);
        }
      } else {
        const usernames = generateUsernames(count);
        const { data } = await supabase.from("groups").insert({ name: newName, subject: newSubject, count, usernames, teacher_id: currentUser?.id }).select().single();
        const students = usernames.map(u => ({ group_id: data.id, username: u, pin: "1234" }));
        await supabase.from("students").insert(students);
        setGroups(prev => [data, ...prev]);
        setShowForm(false);
      }
    } finally {
      setNewName(""); setNewSubject(""); setNewCount(20);
      setSaving(false);
    }
  };

  const confirmRemoval = async () => {
    const { group, newName, newSubject, count } = removingFrom;
    const toRemoveUsernames = group.usernames.filter((_, i) => selectedToRemove.has(i));
    const remaining = group.usernames.filter((_, i) => !selectedToRemove.has(i));
    const { data } = await supabase.from("groups").update({ name: newName, subject: newSubject, count, usernames: remaining }).eq("id", group.id).select().single();
    for (const u of toRemoveUsernames) await supabase.from("students").delete().eq("username", u).eq("group_id", group.id);
    setGroups(prev => prev.map(g => g.id === group.id ? data : g));
    setRemovingFrom(null); setSelectedToRemove(new Set()); setEditingGroup(null);
  };

  const deleteGroup = async (id) => {
    await supabase.from("groups").delete().eq("id", id);
    setGroups(prev => prev.filter(g => g.id !== id));
    setDeleteConfirm(null);
  };

  const generateForGroup = async (group) => {
    const usernames = generateUsernames(group.count);
    const { data } = await supabase.from("groups").update({ usernames }).eq("id", group.id).select().single();
    await supabase.from("students").delete().eq("group_id", group.id);
    const students = usernames.map(u => ({ group_id: group.id, username: u, pin: "1234" }));
    await supabase.from("students").insert(students);
    setGroups(prev => prev.map(g => g.id === group.id ? data : g));
    setExpandedGroup(group.id);
    setRegenConfirm(null);
  };

  const exportPDF = (group) => {
    const rows = group.usernames.map((u, i) => `<tr><td style="padding:8px 12px;color:#94a3b8">${i + 1}</td><td style="padding:8px 12px;font-weight:600">${u}</td><td style="padding:8px 12px;font-weight:700;color:#2563a8">1234</td></tr>`).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${group.name}</title><style>body{font-family:sans-serif;padding:32px}table{width:100%;border-collapse:collapse}th{text-align:left;padding:8px 12px;background:#f8fafc;border-bottom:2px solid #e2e8f0}</style></head><body><h1>QuickTest – ${group.name}</h1><p>${group.subject} · ${group.count} Schüler/innen · PIN: 1234</p><table><thead><tr><th>#</th><th>Benutzername</th><th>PIN</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${group.name}_Benutzernamen.html`; a.click();
    URL.revokeObjectURL(url);
  };

  const needToRemove = removingFrom ? removingFrom.group.usernames.length - removingFrom.count : 0;

  return (
    <TeacherLayout navigate={navigate} onLogout={onLogout} currentUser={currentUser} activePage="groups">
      <div style={{ padding: "32px", maxWidth: "860px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "28px" }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: 0 }}>Lerngruppen</h1>
            <p style={{ color: "#64748b", fontSize: "14px", marginTop: "4px" }}>Verwalte deine Klassen und anonymisierten Benutzernamen.</p>
          </div>
          <button onClick={openNewForm} style={{ padding: "10px 20px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}>+ Neue Gruppe</button>
        </div>

        {showForm && (
          <div style={{ background: "#fff", borderRadius: "16px", padding: "24px", border: "1px solid #e2e8f0", marginBottom: "20px" }}>
            <h3 style={{ margin: "0 0 16px", fontSize: "16px", fontWeight: 700 }}>{editingGroup ? "Gruppe bearbeiten" : "Neue Lerngruppe anlegen"}</h3>
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
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "5px" }}>Anzahl</label>
                <input type="number" value={newCount} min={1} max={625} onChange={e => setNewCount(e.target.value)}
                  style={{ width: "80px", padding: "9px 12px", border: "2px solid #e5e7eb", borderRadius: "8px", fontSize: "14px", fontFamily: "inherit" }} />
              </div>
            </div>
            {editingGroup && parseInt(newCount, 10) < (editingGroup.usernames?.length || 0) && (
              <div style={{ marginTop: "10px", background: "#fef9c3", border: "1px solid #fde68a", borderRadius: "8px", padding: "10px 14px", fontSize: "13px", color: "#92400e" }}>
                ⚠️ Du reduzierst um {(editingGroup.usernames?.length || 0) - parseInt(newCount, 10)} Schüler/in. Im nächsten Schritt wählst du aus, welche entfernt werden.
              </div>
            )}
            {editingGroup && parseInt(newCount, 10) > (editingGroup.usernames?.length || 0) && (
              <div style={{ marginTop: "10px", background: "#dcfce7", border: "1px solid #bbf7d0", borderRadius: "8px", padding: "10px 14px", fontSize: "13px", color: "#14532d" }}>
                ✓ {parseInt(newCount, 10) - (editingGroup.usernames?.length || 0)} neue Benutzernamen werden hinzugefügt. Alle bestehenden bleiben erhalten.
              </div>
            )}
            <div style={{ marginTop: "16px", display: "flex", gap: "10px" }}>
              <button onClick={saveGroup} disabled={!newName || saving} style={{ padding: "9px 20px", background: "#2563a8", color: "#fff", border: "none", borderRadius: "9px", fontWeight: 600, fontSize: "13px", cursor: "pointer", opacity: (!newName || saving) ? 0.5 : 1 }}>
                {saving ? "Wird gespeichert..." : editingGroup ? "Weiter" : "Gruppe erstellen"}
              </button>
              <button onClick={() => { setShowForm(false); setEditingGroup(null); }} style={{ padding: "9px 16px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "9px", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}>Abbrechen</button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ padding: "48px", textAlign: "center", color: "#94a3b8" }}>Wird geladen...</div>
        ) : groups.length === 0 ? (
          <div style={{ background: "#fff", borderRadius: "16px", padding: "48px", textAlign: "center", border: "1px solid #e2e8f0", color: "#94a3b8" }}>
            <div style={{ fontSize: "40px", marginBottom: "12px" }}>👥</div>
            <div style={{ fontWeight: 600 }}>Noch keine Lerngruppen vorhanden</div>
          </div>
        ) : groups.map(group => (
          <div key={group.id} style={{ background: "#fff", borderRadius: "16px", border: "1px solid #e2e8f0", marginBottom: "14px", overflow: "hidden" }}>
            <div style={{ padding: "18px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: "16px", color: "#0f172a" }}>{group.name}</div>
                <div style={{ fontSize: "13px", color: "#64748b", marginTop: "2px" }}>{group.subject} · {group.count} Schüler/innen</div>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                {!group.usernames?.length ? (
                  <button onClick={() => generateForGroup(group)} style={{ padding: "7px 14px", background: "#f0f7ff", color: "#2563a8", border: "1px solid #bfdbfe", borderRadius: "8px", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}>
                    🎲 Benutzernamen generieren
                  </button>
                ) : (
                  <button onClick={() => setExpandedGroup(expandedGroup === group.id ? null : group.id)} style={{ padding: "7px 14px", background: "#f0f7ff", color: "#2563a8", border: "1px solid #bfdbfe", borderRadius: "8px", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}>
                    👁 Benutzernamen anzeigen
                  </button>
                )}
                <button onClick={() => openEditForm(group)} style={{ padding: "7px 12px", background: "#f8fafc", color: "#374151", border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "13px", cursor: "pointer" }}>✏️</button>
                <button onClick={() => setDeleteConfirm(group.id)} style={{ padding: "7px 12px", background: "#fff", color: "#dc2626", border: "1px solid #fecaca", borderRadius: "8px", fontSize: "13px", cursor: "pointer" }}>🗑</button>
              </div>
            </div>
            {expandedGroup === group.id && (
              <div style={{ padding: "0 24px 20px", borderTop: "1px solid #f1f5f9" }}>
                {!group.usernames?.length ? (
                  <p style={{ fontSize: "13px", color: "#94a3b8", marginTop: "14px" }}>Noch keine Benutzernamen generiert.</p>
                ) : (
                  <>
                    <p style={{ fontSize: "13px", color: "#64748b", marginBottom: "12px", marginTop: "14px" }}>PIN = <strong>1234</strong></p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                      {group.usernames.map((u, i) => (
                        <div key={i} style={{ background: "#f8fafc", borderRadius: "8px", padding: "8px 12px", fontSize: "13px", color: "#374151", border: "1px solid #e2e8f0" }}>
                          <span style={{ color: "#94a3b8", fontSize: "11px", display: "block" }}>#{i + 1}</span>{u}
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: "12px", display: "flex", gap: "8px", alignItems: "center" }}>
                      <button onClick={() => exportPDF(group)} style={{ padding: "8px 16px", background: "#16a34a", color: "#fff", border: "none", borderRadius: "8px", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}>📋 Als PDF exportieren</button>
                      <button onClick={() => setRegenConfirm(group)} style={{ padding: "8px 14px", background: "#fff", color: "#dc2626", border: "1px solid #fecaca", borderRadius: "8px", fontSize: "12px", cursor: "pointer" }}>🔄 Alle neu generieren</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {removingFrom && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "500px", width: "100%", maxHeight: "80vh", overflowY: "auto" }}>
            <h3 style={{ fontSize: "18px", fontWeight: 800, margin: "0 0 8px", color: "#0f172a", textAlign: "center" }}>Welche Schüler/innen verlassen die Gruppe?</h3>
            <p style={{ color: "#64748b", marginBottom: "16px", fontSize: "14px", textAlign: "center" }}>Bitte wähle genau <strong>{needToRemove}</strong> Benutzernamen aus.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "20px" }}>
              {removingFrom.group.usernames.map((u, i) => {
                const selected = selectedToRemove.has(i);
                return (
                  <button key={i} onClick={() => {
                    setSelectedToRemove(prev => { const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next; });
                  }} style={{ padding: "10px 12px", borderRadius: "9px", cursor: "pointer", textAlign: "left", border: `2px solid ${selected ? "#dc2626" : "#e2e8f0"}`, background: selected ? "#fef2f2" : "#f8fafc", fontFamily: "inherit" }}>
                    <span style={{ fontSize: "11px", color: selected ? "#dc2626" : "#94a3b8", display: "block" }}>{selected ? "✕ Wird entfernt" : `#${i + 1}`}</span>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: selected ? "#dc2626" : "#374151" }}>{u}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => { setRemovingFrom(null); setSelectedToRemove(new Set()); }} style={{ flex: 1, padding: "10px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "9px", fontWeight: 600, cursor: "pointer" }}>Abbrechen</button>
              <button onClick={confirmRemoval} disabled={selectedToRemove.size !== needToRemove}
                style={{ flex: 1, padding: "10px", background: selectedToRemove.size === needToRemove ? "#dc2626" : "#e2e8f0", color: selectedToRemove.size === needToRemove ? "#fff" : "#94a3b8", border: "none", borderRadius: "9px", fontWeight: 700, cursor: selectedToRemove.size === needToRemove ? "pointer" : "not-allowed" }}>
                {selectedToRemove.size}/{needToRemove} – Entfernen
              </button>
            </div>
          </div>
        </div>
      )}

      {regenConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "400px", textAlign: "center" }}>
            <div style={{ fontSize: "40px", marginBottom: "12px" }}>⚠️</div>
            <h3 style={{ fontSize: "18px", fontWeight: 800, margin: "0 0 8px", color: "#0f172a" }}>Benutzernamen neu generieren?</h3>
            <p style={{ color: "#64748b", marginBottom: "8px", fontSize: "14px" }}>
              Alle bestehenden Benutzernamen für <strong>{regenConfirm.name}</strong> werden unwiderruflich ersetzt.
            </p>
            <p style={{ color: "#dc2626", marginBottom: "24px", fontSize: "13px", fontWeight: 600 }}>
              ⚠️ Schüler die sich bereits mit ihren alten Benutzernamen kennen, können sich danach nicht mehr einloggen!
            </p>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setRegenConfirm(null)} style={{ flex: 1, padding: "10px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "9px", fontWeight: 600, cursor: "pointer" }}>Abbrechen</button>
              <button onClick={() => generateForGroup(regenConfirm)} style={{ flex: 1, padding: "10px", background: "#dc2626", color: "#fff", border: "none", borderRadius: "9px", fontWeight: 700, cursor: "pointer" }}>Ja, neu generieren</button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "360px", textAlign: "center" }}>
            <div style={{ fontSize: "40px", marginBottom: "12px" }}>🗑️</div>
            <h3 style={{ fontSize: "18px", fontWeight: 800, margin: "0 0 8px" }}>Gruppe löschen?</h3>
            <p style={{ color: "#64748b", marginBottom: "24px", fontSize: "14px" }}>„{groups.find(g => g.id === deleteConfirm)?.name}" wird unwiderruflich gelöscht.</p>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ flex: 1, padding: "10px", background: "#f1f5f9", color: "#374151", border: "none", borderRadius: "9px", fontWeight: 600, cursor: "pointer" }}>Abbrechen</button>
              <button onClick={() => deleteGroup(deleteConfirm)} style={{ flex: 1, padding: "10px", background: "#dc2626", color: "#fff", border: "none", borderRadius: "9px", fontWeight: 700, cursor: "pointer" }}>Löschen</button>
            </div>
          </div>
        </div>
      )}
    </TeacherLayout>
  );
}
