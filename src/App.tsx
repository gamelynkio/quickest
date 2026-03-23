import { useState } from "react";
import LoginPage from "./pages/LoginPage";
import TeacherDashboard from "./pages/TeacherDashboard";
import TestEditor from "./pages/TestEditor";
import TestLibrary from "./pages/TestLibrary";
import StudentTestView from "./pages/StudentTestView";
import GroupManager from "./pages/GroupManager";
import ResultsView from "./pages/ResultsView";

const DEMO_GROUPS = [
  { id: 1, name: "Klasse 6a", subject: "Mathematik", count: 24, usernames: [] },
  { id: 2, name: "Klasse 7b", subject: "Deutsch", count: 22, usernames: [] },
];

const DEMO_TEMPLATES = [
  { id: 101, title: "Bruchrechnung – Grundlagen", subject: "Mathematik", description: "Addition und Subtraktion von Brüchen", questions: 12, timeLimit: 1200, antiCheat: true, questionData: [], gradingScale: [] },
  { id: 102, title: "Grammatik – Satzglieder", subject: "Deutsch", description: "Subjekt, Prädikat, Objekt bestimmen", questions: 8, timeLimit: 900, antiCheat: false, questionData: [], gradingScale: [] },
  { id: 103, title: "Simple Past – Reguläre Verben", subject: "Englisch", description: "Bildung und Verwendung des Simple Past", questions: 15, timeLimit: 1800, antiCheat: true, questionData: [], gradingScale: [] },
];

const DEMO_TESTS = [
  { id: 1, title: "Bruchrechnung – Grundlagen", groupId: 1, status: "aktiv", submissions: 18, total: 24, avgScore: 76, timeLimit: 1200, timingMode: "countdown", templateId: 101, questions: 12 },
  { id: 2, title: "Grammatik – Satzglieder", groupId: 2, status: "beendet", submissions: 22, total: 22, avgScore: 82, timeLimit: 900, timingMode: "countdown", templateId: 102, questions: 8 },
];

export default function App() {
  const [currentPage, setCurrentPage] = useState("login");
  const [userRole, setUserRole] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [editingTest, setEditingTest] = useState(null);
  const [activeTest, setActiveTest] = useState(null);
  const [viewingResults, setViewingResults] = useState(null);
  const [groups, setGroups] = useState(DEMO_GROUPS);
  const [templates, setTemplates] = useState(DEMO_TEMPLATES);
  const [tests, setTests] = useState(DEMO_TESTS);

  const navigate = (page, data = null) => {
    if (page === "testEditor") setEditingTest(data);
    if (page === "studentTest") setActiveTest(data);
    if (page === "results") setViewingResults(data);
    setCurrentPage(page);
  };

  const handleLogin = (role, user) => {
    setUserRole(role);
    setCurrentUser(user);
    setCurrentPage(role === "teacher" ? "dashboard" : "studentTest");
  };

  const handleLogout = () => {
    setUserRole(null);
    setCurrentUser(null);
    setCurrentPage("login");
  };

  if (currentPage === "login") return <LoginPage onLogin={handleLogin} />;

  if (userRole === "teacher") {
    const teacherNav = { navigate, onLogout: handleLogout, currentUser };
    if (currentPage === "dashboard") return <TeacherDashboard {...teacherNav} tests={tests} setTests={setTests} groups={groups} />;
    if (currentPage === "testEditor") return <TestEditor {...teacherNav} editingTest={editingTest} templates={templates} setTemplates={setTemplates} groups={groups} />;
    if (currentPage === "library") return <TestLibrary {...teacherNav} templates={templates} setTemplates={setTemplates} groups={groups} tests={tests} setTests={setTests} />;
    if (currentPage === "groups") return <GroupManager {...teacherNav} groups={groups} setGroups={setGroups} tests={tests} />;
    if (currentPage === "results") return <ResultsView {...teacherNav} test={viewingResults} groups={groups} />;
  }

  if (userRole === "student") {
    return <StudentTestView test={activeTest} currentUser={currentUser} onFinish={handleLogout} />;
  }

  return <LoginPage onLogin={handleLogin} />;
}
