import { useState } from "react";
import LoginPage from "./pages/LoginPage";
import TeacherDashboard from "./pages/TeacherDashboard";
import TestEditor from "./pages/TestEditor";
import StudentTestView from "./pages/StudentTestView";
import GroupManager from "./pages/GroupManager";
import ResultsView from "./pages/ResultsView";

const DEMO_GROUPS = [
  { id: 1, name: "Klasse 6a", subject: "Mathematik", count: 24, usernames: [] },
  { id: 2, name: "Klasse 7b", subject: "Deutsch", count: 22, usernames: [] },
];

const DEMO_TESTS = [
  { id: 1, title: "Mathe – Bruchrechnung Kl. 6", questions: 12, group: "6a", status: "aktiv", submissions: 18, total: 24, avgScore: 76 },
  { id: 2, title: "Deutsch – Grammatik", questions: 8, group: "7b", status: "beendet", submissions: 22, total: 22, avgScore: 82 },
  { id: 3, title: "Englisch – Simple Past", questions: 15, group: "8c", status: "entwurf", submissions: 0, total: 28, avgScore: null },
];

export default function App() {
  const [currentPage, setCurrentPage] = useState("login");
  const [userRole, setUserRole] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [editingTest, setEditingTest] = useState(null);
  const [activeTest, setActiveTest] = useState(null);
  const [groups, setGroups] = useState(DEMO_GROUPS);
  const [tests, setTests] = useState(DEMO_TESTS);

  const navigate = (page, data = null) => {
    if (page === "testEditor") setEditingTest(data);
    if (page === "studentTest") setActiveTest(data);
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
    if (currentPage === "dashboard") return <TeacherDashboard {...teacherNav} tests={tests} />;
    if (currentPage === "testEditor") return <TestEditor {...teacherNav} editingTest={editingTest} tests={tests} setTests={setTests} />;
    if (currentPage === "groups") return <GroupManager {...teacherNav} groups={groups} setGroups={setGroups} />;
    if (currentPage === "results") return <ResultsView {...teacherNav} />;
  }

  if (userRole === "student") {
    return <StudentTestView test={activeTest} currentUser={currentUser} onFinish={handleLogout} />;
  }

  return <LoginPage onLogin={handleLogin} />;
}
