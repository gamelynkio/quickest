import { useState, useEffect } from "react";
import { supabase } from "./lib/supabase";
import LoginPage from "./pages/LoginPage";
import TeacherDashboard from "./pages/TeacherDashboard";
import TestEditor from "./pages/TestEditor";
import TestLibrary from "./pages/TestLibrary";
import StudentTestView from "./pages/StudentTestView";
import GroupManager from "./pages/GroupManager";
import ResultsView from "./pages/ResultsView";

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [profile, setProfile] = useState(null);
  const [studentUser, setStudentUser] = useState(null);
  const [currentPage, setCurrentPage] = useState("dashboard");
  const [editingTest, setEditingTest] = useState(null);
  const [viewingResults, setViewingResults] = useState(null);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) fetchProfile(session.user.id);
      else setSession(null);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) fetchProfile(session.user.id);
      else { setProfile(null); }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (userId) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
    setProfile(data);
  };

  const navigate = (page, data = null) => {
    if (page === "testEditor") setEditingTest(data);
    if (page === "results") setViewingResults(data);
    setCurrentPage(page);
  };

  const handleLogin = (_role, userData) => {
    setStudentUser(userData);
    setCurrentPage("studentTest");
  };

  const handleLogout = async () => {
    if (studentUser) {
      setStudentUser(null);
      setCurrentPage("dashboard");
    } else {
      await supabase.auth.signOut();
      setProfile(null);
    }
  };

  // Loading
  if (session === undefined) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #1e3a5f, #2563a8)", fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      <div style={{ textAlign: "center", color: "#fff" }}>
        <div style={{ fontSize: "48px", marginBottom: "16px" }}>⚡</div>
        <div style={{ fontSize: "20px", fontWeight: 700 }}>QuickTest</div>
        <div style={{ fontSize: "14px", color: "rgba(255,255,255,0.6)", marginTop: "8px" }}>Wird geladen...</div>
      </div>
    </div>
  );

  // Student view
  if (studentUser) return <StudentTestView currentUser={studentUser} onFinish={handleLogout} />;

  // Not logged in
  if (!session) return <LoginPage onLogin={handleLogin} />;

  // Teacher views
  const teacherNav = { navigate, onLogout: handleLogout, currentUser: profile };
  if (currentPage === "dashboard") return <TeacherDashboard {...teacherNav} />;
  if (currentPage === "testEditor") return <TestEditor {...teacherNav} editingTest={editingTest} />;
  if (currentPage === "library") return <TestLibrary {...teacherNav} />;
  if (currentPage === "groups") return <GroupManager {...teacherNav} />;
  if (currentPage === "results") return <ResultsView {...teacherNav} assignment={viewingResults} />;

  return <TeacherDashboard {...teacherNav} />;
}
