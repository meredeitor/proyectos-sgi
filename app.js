import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { createUserWithEmailAndPassword, getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, getFirestore, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBeC4HJ5l8Z9EdstgguKQOWzVWkxfAncOo",
  authDomain: "proyectos-sgi.firebaseapp.com",
  projectId: "proyectos-sgi",
  storageBucket: "proyectos-sgi.firebasestorage.app",
  messagingSenderId: "860461171847",
  appId: "1:860461171847:web:273c9d4a92aa7e89a26422"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const projectsRef = collection(db, "projects");
const usersRef = collection(db, "users");

const columns = [
  { id: "planned", title: "Planeado", hint: "Entregables definidos" },
  { id: "progress", title: "En proceso", hint: "Actividades en ejecuci\u00f3n" },
  { id: "review", title: "En revisi\u00f3n", hint: "Validaci\u00f3n o aprobaci\u00f3n" },
  { id: "done", title: "Completado", hint: "Entregable terminado" },
];

const state = {
  projects: [],
  users: [],
  currentUser: null,
  currentProfile: null,
  activeProjectId: "",
  search: "",
  filters: { status: "all", priority: "all", owner: "all", risk: "all" },
  view: "kanban",
  ready: false,
};

let draggedId = null;
let editingTeam = [];
let editingActivities = [];
let unsubscribeProjects = null;

const $ = (selector) => document.querySelector(selector);
const board = $("#board");
const projectsGrid = $("#projectsGrid");
const columnTemplate = $("#columnTemplate");
const cardTemplate = $("#cardTemplate");
const statusFilter = $("#statusFilter");
const ownerFilter = $("#ownerFilter");

const roleLabels = { admin: "Admin", leader: "Lider de Proyecto" };
const statusLabels = { pending: "Pendiente", active: "Activo", disabled: "Bloqueado" };

function setSyncStatus(text, tone = "syncing") {
  const status = $("#syncStatus");
  status.textContent = text;
  status.dataset.tone = tone;
}

function normalizeProject(project, id = project.id) {
  const deliverables = Array.isArray(project.deliverables) ? project.deliverables.map(normalizeDeliverable) : [];
  const storedTeam = normalizeTeam(project.team);
  const derivedTeam = deriveTeam(deliverables);
  return {
    id,
    title: project.title || "Proyecto sin nombre",
    client: project.client || "",
    goal: project.goal || "",
    leaderEmail: normalizeEmail(project.leaderEmail || project.ownerEmail || ""),
    team: storedTeam.length ? storedTeam : derivedTeam,
    createdAt: project.createdAt || new Date().toISOString(),
    deliverables,
  };
}

function normalizeTeam(items) {
  if (!Array.isArray(items)) return [];
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "es"));
}

function deriveTeam(deliverables) {
  return normalizeTeam(deliverables.flatMap((item) => [
    item.owner,
    ...item.activities.map((activity) => activity.owner),
  ]));
}

function normalizeDeliverable(item = {}) {
  const activities = normalizeActivities(item.activities);
  let status = item.status || "planned";
  if (activities.length && activities.every((activity) => activity.done)) status = "done";
  if (status === "done" && activities.some((activity) => !activity.done)) status = "review";
  return {
    id: item.id || crypto.randomUUID(),
    title: item.title || "Entregable sin nombre",
    description: item.description || "",
    owner: item.owner || "",
    due: item.due || "",
    priority: ["Alta", "Media", "Baja"].includes(item.priority) ? item.priority : "Media",
    status: columns.some((column) => column.id === status) ? status : "planned",
    tags: Array.isArray(item.tags) ? item.tags : [],
    activities,
    createdAt: item.createdAt || new Date().toISOString(),
  };
}

function normalizeActivities(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (typeof item === "string") return { text: item.trim(), owner: "", due: "", done: false };
      return {
        text: String(item.text || "").trim(),
        owner: String(item.owner || "").trim(),
        due: item.due || "",
        done: Boolean(item.done),
      };
    })
    .filter((item) => item.text);
}

function activeProject() {
  return state.projects.find((project) => project.id === state.activeProjectId) || null;
}

function projectDoc(id) {
  return doc(db, "projects", id);
}

function userDoc(uid) {
  return doc(db, "users", uid);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isAdmin() {
  return state.currentProfile?.role === "admin" && state.currentProfile?.status === "active";
}

function isLeader() {
  return state.currentProfile?.role === "leader" && state.currentProfile?.status === "active";
}

function visibleProjects(projects) {
  if (isAdmin()) return projects;
  if (!isLeader()) return [];
  const email = normalizeEmail(state.currentUser?.email);
  return projects.filter((project) => normalizeEmail(project.leaderEmail) === email);
}

function setAuthMessage(selector, text, tone = "error") {
  const node = $(selector);
  if (!node) return;
  node.textContent = text;
  node.dataset.tone = tone;
}

function showAuthMode(mode) {
  $("#loginForm").hidden = mode !== "login";
  $("#registerForm").hidden = mode !== "register";
  $("#pendingAccessPanel").hidden = mode !== "pending";
  $("#authView").hidden = false;
  $("#appShell").hidden = true;
}

function showApp() {
  $("#authView").hidden = true;
  $("#appShell").hidden = false;
  $("#manageUsersButton").hidden = !isAdmin();
  $("#currentUserLabel").textContent = `${roleLabels[state.currentProfile.role] || "Usuario"} · ${state.currentUser.email}`;
}

async function ensureUserProfile(user) {
  const ref = userDoc(user.uid);
  const snapshot = await getDoc(ref);
  if (snapshot.exists()) return { id: user.uid, ...snapshot.data() };
  const profile = {
    name: user.displayName || user.email,
    email: normalizeEmail(user.email),
    role: "leader",
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, profile);
  return { id: user.uid, ...profile };
}

async function loadUsers() {
  const snapshot = await getDocs(query(usersRef, orderBy("email", "asc")));
  state.users = snapshot.docs.map((item) => normalizeUser(item.data(), item.id));
}

function normalizeUser(user, id = user.id) {
  return {
    id,
    name: user.name || user.email || "Usuario",
    email: normalizeEmail(user.email),
    role: ["admin", "leader"].includes(user.role) ? user.role : "leader",
    status: ["pending", "active", "disabled"].includes(user.status) ? user.status : "pending",
  };
}

function activeLeaders() {
  return state.users.filter((user) => user.role === "leader" && user.status === "active");
}

async function createProject(data) {
  setSyncStatus("Guardando...", "syncing");
  const ref = await addDoc(projectsRef, { ...data, ownerEmail: normalizeEmail(state.currentUser?.email), deliverables: [], createdAt: new Date().toISOString(), updatedAt: serverTimestamp() });
  state.activeProjectId = ref.id;
  setSyncStatus("Sincronizado", "online");
}

async function updateProject(id, patch) {
  setSyncStatus("Guardando...", "syncing");
  await updateDoc(projectDoc(id), { ...patch, updatedAt: serverTimestamp() });
  setSyncStatus("Sincronizado", "online");
}

async function removeProject(id) {
  setSyncStatus("Eliminando...", "syncing");
  await deleteDoc(projectDoc(id));
  if (state.activeProjectId === id) state.activeProjectId = "";
  setSyncStatus("Sincronizado", "online");
}

async function saveActiveProject() {
  const project = activeProject();
  if (!project) return;
  setSyncStatus("Guardando...", "syncing");
  await updateDoc(projectDoc(project.id), { deliverables: project.deliverables, updatedAt: serverTimestamp() });
  setSyncStatus("Sincronizado", "online");
}

function startFirestore() {
  if (unsubscribeProjects) unsubscribeProjects();
  setSyncStatus("Conectando...", "syncing");
  const q = query(projectsRef, orderBy("createdAt", "desc"));
  unsubscribeProjects = onSnapshot(q, (snapshot) => {
    state.projects = visibleProjects(snapshot.docs.map((item) => normalizeProject(item.data(), item.id)));
    if (!state.projects.some((project) => project.id === state.activeProjectId)) {
      state.activeProjectId = state.projects[0]?.id || "";
    }
    state.ready = true;
    setSyncStatus("Sincronizado", "online");
    render();
  }, (error) => {
    console.warn("Firestore no permiti\u00f3 leer proyectos.", error);
    state.ready = false;
    state.projects = [];
    state.activeProjectId = "";
    setSyncStatus("Sin permisos", "local");
    render();
  });
}

function render() {
  renderProjectsGrid();
  renderFilters();
  renderProjectSummary();
  renderMetrics();
  renderBoard();
  renderGantt();
  updateViewMode();
  updateCrudButtons();
}

function renderProjectsGrid() {
  projectsGrid.innerHTML = "";
  if (!state.ready) {
    projectsGrid.innerHTML = '<p class="empty-state">No se pudo leer Firestore. Revisa reglas/permisos.</p>';
    return;
  }
  if (!state.projects.length) {
    projectsGrid.innerHTML = '<p class="empty-state">No hay proyectos. Crea el primero para comenzar.</p>';
    return;
  }
  state.projects.forEach((project) => {
    const stats = projectStats(project);
    const card = document.createElement("article");
    card.className = `project-card ${project.id === state.activeProjectId ? "is-active" : ""}`;
    card.innerHTML = `
      <div><h3>${escapeHtml(project.title)}</h3><p>${escapeHtml(project.client || "Sin cliente")}</p></div>
      <strong>${stats.percent}%</strong>
      <span>${stats.doneDeliverables}/${stats.totalDeliverables} entregables</span>
    `;
    card.addEventListener("click", () => { state.activeProjectId = project.id; render(); });
    projectsGrid.appendChild(card);
  });
}

function renderFilters() {
  statusFilter.innerHTML = '<option value="all">Todos</option>';
  columns.forEach((column) => {
    const option = document.createElement("option");
    option.value = column.id;
    option.textContent = column.title;
    statusFilter.appendChild(option);
  });
  statusFilter.value = state.filters.status;
  $("#priorityFilter").value = state.filters.priority;
  $("#riskFilter").value = state.filters.risk;

  const project = activeProject();
  const owners = project ? normalizeTeam(project.team) : [];
  if (project?.deliverables.some((item) => !item.owner)) owners.push("Sin responsable");
  ownerFilter.innerHTML = '<option value="all">Todos</option>';
  owners.forEach((owner) => {
    const option = document.createElement("option");
    option.value = owner;
    option.textContent = owner;
    ownerFilter.appendChild(option);
  });
  if (!owners.includes(state.filters.owner) && state.filters.owner !== "all") state.filters.owner = "all";
  ownerFilter.value = state.filters.owner;
}

function renderProjectSummary() {
  const project = activeProject();
  if (!project) {
    $("#projectName").textContent = "Sin proyecto seleccionado";
    $("#projectMeta").textContent = state.ready ? "Crea o selecciona un proyecto para trabajar." : "Esperando permisos de Firestore.";
    $("#projectPercent").textContent = "0%";
    $("#projectProgressBar").style.width = "0%";
    return;
  }
  const stats = projectStats(project);
  $("#projectName").textContent = project.title;
  $("#projectMeta").textContent = `${project.client || "Sin cliente"} · ${stats.doneDeliverables}/${stats.totalDeliverables} entregables · ${stats.doneActivities}/${stats.totalActivities} actividades`;
  $("#projectPercent").textContent = `${stats.percent}%`;
  $("#projectProgressBar").style.width = `${stats.percent}%`;
}

function renderMetrics() {
  const project = activeProject();
  const items = project ? filteredDeliverables() : [];
  const allStats = project ? projectStats(project) : { doneActivities: 0, totalActivities: 0 };
  $("#deliverableTotal").textContent = items.length;
  $("#deliverableDone").textContent = items.filter(isDeliverableDone).length;
  $("#activityDone").textContent = `${allStats.doneActivities}/${allStats.totalActivities}`;
  $("#dueRisk").textContent = items.filter((item) => ["overdue", "soon"].includes(dueState(item).state)).length;
}

function renderBoard() {
  board.innerHTML = "";
  columns.forEach((column) => {
    const node = columnTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.status = column.id;
    node.querySelector("h2").textContent = column.title;
    node.querySelector("p").textContent = column.hint;
    node.querySelector(".add-card").disabled = !activeProject();
    node.querySelector(".add-card").addEventListener("click", () => openDeliverableDialog({ status: column.id }));
    node.addEventListener("dragover", (event) => { event.preventDefault(); node.classList.add("drag-over"); });
    node.addEventListener("dragleave", () => node.classList.remove("drag-over"));
    node.addEventListener("drop", async (event) => { event.preventDefault(); await moveDeliverable(column.id); node.classList.remove("drag-over"); });
    const cards = node.querySelector(".cards");
    filteredDeliverables().filter((item) => item.status === column.id).sort(sortDeliverables).forEach((item) => cards.appendChild(renderCard(item)));
    board.appendChild(node);
  });
}

function renderCard(item) {
  const node = cardTemplate.content.firstElementChild.cloneNode(true);
  const progress = activityProgress(item);
  const risk = dueState(item);
  node.dataset.id = item.id;
  node.dataset.due = risk.state;
  node.querySelector("h3").textContent = item.title;
  node.querySelector(".description").textContent = item.description || "Sin descripci\u00f3n";
  const pr = node.querySelector(".priority");
  pr.textContent = item.priority;
  pr.dataset.priority = item.priority;
  const time = node.querySelector("time");
  time.textContent = risk.label;
  time.dataset.due = risk.state;
  node.querySelector(".activity-label").textContent = `${progress.done}/${progress.total} actividades`;
  node.querySelector(".activity-percent").textContent = `${progress.percent}%`;
  node.querySelector(".track span").style.width = `${progress.percent}%`;
  const list = node.querySelector(".activities-preview");
  item.activities.slice(0, 4).forEach((activity) => {
    const li = document.createElement("li");
    li.textContent = activity.owner ? `${activity.text} · ${activity.owner}` : activity.text;
    li.className = activity.done ? "done" : "";
    list.appendChild(li);
  });
  if (item.activities.length > 4) {
    const li = document.createElement("li");
    li.textContent = `+${item.activities.length - 4} m\u00e1s`;
    li.className = "more";
    list.appendChild(li);
  }
  const tags = node.querySelector(".tags");
  item.tags.forEach((tag) => {
    const span = document.createElement("span");
    span.textContent = tag;
    tags.appendChild(span);
  });
  node.querySelector(".owner").textContent = item.owner ? `Resp. ${item.owner}` : "Sin responsable";
  node.querySelector("button").addEventListener("click", () => openDeliverableDialog(item));
  node.addEventListener("dblclick", () => openDeliverableDialog(item));
  node.addEventListener("dragstart", () => { draggedId = item.id; node.classList.add("dragging"); });
  node.addEventListener("dragend", () => node.classList.remove("dragging"));
  return node;
}

function renderGantt() {
  const gantt = $("#ganttView");
  if (!gantt) return;
  const project = activeProject();
  const items = project ? filteredDeliverables() : [];
  if (!project) {
    gantt.innerHTML = '<p class="empty-state">Selecciona un proyecto para ver su Gantt.</p>';
    return;
  }
  const dated = items.map((item) => {
    const activityDates = item.activities.map((activity) => activity.due).filter(Boolean).sort();
    const start = activityDates[0] || item.due || todayIso();
    const end = item.due || activityDates[activityDates.length - 1] || start;
    return { item, start, end: end < start ? start : end };
  });
  if (!dated.length) {
    gantt.innerHTML = '<p class="empty-state">Este proyecto no tiene entregables para graficar.</p>';
    return;
  }
  const minDate = dated.map((entry) => entry.start).sort()[0];
  const maxDate = dated.map((entry) => entry.end).sort().at(-1);
  const totalDays = Math.max(1, daysBetween(minDate, maxDate) + 1);
  const ticks = buildGanttTicks(minDate, totalDays);
  gantt.innerHTML = `
    <div class="gantt-head">
      <div><p class="eyebrow">Gantt</p><h3>${escapeHtml(project.title)}</h3></div>
      <span>${formatDate(minDate)} - ${formatDate(maxDate)}</span>
    </div>
    <div class="gantt-scale">
      <span>Entregable</span>
      <div>${ticks.map((tick) => `<time style="left:${tick.left}%">${escapeHtml(tick.label)}</time>`).join("")}</div>
    </div>
    <div class="gantt-rows"></div>
  `;
  const rows = gantt.querySelector(".gantt-rows");
  dated.forEach(({ item, start, end }) => {
    const progress = activityProgress(item);
    const left = (daysBetween(minDate, start) / totalDays) * 100;
    const width = Math.max(4, ((daysBetween(start, end) + 1) / totalDays) * 100);
    const row = document.createElement("article");
    row.className = "gantt-row";
    row.innerHTML = `
      <div class="gantt-label">
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.owner || "Sin responsable")} · ${progress.percent}%</span>
      </div>
      <div class="gantt-track">
        <span class="gantt-bar" data-priority="${escapeHtml(item.priority)}" style="left:${left}%;width:${width}%"><i style="width:${progress.percent}%"></i></span>
        ${item.activities.filter((activity) => activity.due).map((activity) => {
          const markerLeft = (daysBetween(minDate, activity.due) / totalDays) * 100;
          return `<span class="gantt-marker ${activity.done ? "is-done" : ""}" style="left:${markerLeft}%" title="${escapeHtml(activity.text)} - ${escapeHtml(activity.owner || "Sin responsable")}"></span>`;
        }).join("")}
      </div>
    `;
    rows.appendChild(row);
  });
}

function updateViewMode() {
  const isGantt = state.view === "gantt";
  $("#board").hidden = isGantt;
  $("#ganttView").hidden = !isGantt;
  $("#kanbanViewButton").classList.toggle("is-active", !isGantt);
  $("#ganttViewButton").classList.toggle("is-active", isGantt);
}

function setViewMode(view) {
  state.view = view;
  updateViewMode();
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(start, end) {
  const a = new Date(`${start}T00:00:00`);
  const b = new Date(`${end}T00:00:00`);
  return Math.round((b - a) / 86400000);
}

function buildGanttTicks(start, totalDays) {
  const count = Math.min(6, totalDays + 1);
  return Array.from({ length: count }, (_, index) => {
    const offset = Math.round((index / Math.max(1, count - 1)) * Math.max(0, totalDays - 1));
    const date = new Date(`${start}T00:00:00`);
    date.setDate(date.getDate() + offset);
    return { left: (offset / totalDays) * 100, label: date.toLocaleDateString("es-MX", { day: "2-digit", month: "short" }) };
  });
}
function filteredDeliverables() {
  const project = activeProject();
  if (!project) return [];
  return project.deliverables.filter((item) => {
    const text = [item.title, item.description, item.owner, item.priority, item.tags.join(" "), item.activities.map((a) => `${a.text} ${a.owner || ""} ${a.due || ""}`).join(" ")].join(" ").toLowerCase();
    return (!state.search || text.includes(state.search)) &&
      (state.filters.status === "all" || item.status === state.filters.status) &&
      (state.filters.priority === "all" || item.priority === state.filters.priority) &&
      (state.filters.owner === "all" || (item.owner || "Sin responsable") === state.filters.owner) &&
      (state.filters.risk === "all" || dueState(item).state === state.filters.risk);
  });
}

function updateCrudButtons() {
  const hasProject = Boolean(activeProject());
  $("#editProjectButton").disabled = !hasProject;
  $("#deleteProjectButton").disabled = !hasProject || !isAdmin();
  $("#newDeliverableButton").disabled = !hasProject;
}

function projectStats(project) {
  const totalDeliverables = project.deliverables.length;
  const doneDeliverables = project.deliverables.filter(isDeliverableDone).length;
  const activities = project.deliverables.flatMap((item) => item.activities);
  const totalActivities = activities.length;
  const doneActivities = activities.filter((activity) => activity.done).length;
  const percent = totalDeliverables ? Math.round((doneDeliverables / totalDeliverables) * 100) : 0;
  return { totalDeliverables, doneDeliverables, totalActivities, doneActivities, percent };
}
function activityProgress(item) { const total = item.activities.length; const done = item.activities.filter((a) => a.done).length; return { total, done, percent: total ? Math.round((done / total) * 100) : 0 }; }
function isDeliverableDone(item) { return item.status === "done" || (item.activities.length > 0 && item.activities.every((activity) => activity.done)); }
function sortDeliverables(a, b) { return ({ Alta: 0, Media: 1, Baja: 2 }[a.priority] ?? 1) - ({ Alta: 0, Media: 1, Baja: 2 }[b.priority] ?? 1) || (a.due || "9999").localeCompare(b.due || "9999"); }
function dueState(item) {
  if (!item.due) return { state: "none", label: "Sin fecha" };
  if (isDeliverableDone(item)) return { state: "done", label: formatDate(item.due) };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(`${item.due}T00:00:00`);
  const days = Math.round((due - today) / 86400000);
  if (days < 0) return { state: "overdue", label: `Vencido ${formatDate(item.due)}` };
  if (days <= 7) return { state: "soon", label: days === 0 ? "Vence hoy" : `Vence en ${days} d` };
  return { state: "healthy", label: formatDate(item.due) };
}
function formatDate(value) { return new Date(`${value}T00:00:00`).toLocaleDateString("es-MX", { day: "2-digit", month: "short" }); }
function escapeHtml(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }

function openProjectDialog(project = null) {
  $("#projectForm").reset();
  $("#projectDialogTitle").textContent = project ? "Editar proyecto" : "Nuevo proyecto";
  $("#projectIdInput").value = project?.id || "";
  $("#projectTitleInput").value = project?.title || "";
  $("#projectClientInput").value = project?.client || "";
  renderLeaderOptions(project?.leaderEmail || normalizeEmail(state.currentUser?.email));
  $("#projectGoalInput").value = project?.goal || "";
  editingTeam = normalizeTeam(project?.team || []);
  clearTeamInput();
  renderTeamEditor();
  $("#projectDialog").showModal();
  $("#projectTitleInput").focus();
}

function renderLeaderOptions(value = "") {
  const select = $("#projectLeaderInput");
  const field = $("#projectLeaderField");
  select.innerHTML = "";
  if (isAdmin()) {
    const leaders = activeLeaders();
    if (!leaders.some((user) => user.email === value) && value) {
      leaders.push({ email: value, name: value });
    }
    leaders.forEach((user) => {
      const option = document.createElement("option");
      option.value = user.email;
      option.textContent = user.name ? `${user.name} (${user.email})` : user.email;
      select.appendChild(option);
    });
    select.disabled = false;
    field.hidden = false;
    select.value = value || leaders[0]?.email || "";
    return;
  }
  const email = normalizeEmail(state.currentUser?.email);
  const option = document.createElement("option");
  option.value = email;
  option.textContent = email;
  select.appendChild(option);
  select.value = email;
  select.disabled = true;
  field.hidden = false;
}

function openDeliverableDialog(item = {}) {
  const normalized = normalizeDeliverable(item);
  $("#deliverableForm").reset();
  $("#deliverableDialogTitle").textContent = item.id ? "Editar entregable" : "Nuevo entregable";
  $("#deliverableId").value = item.id || "";
  $("#deliverableTitleInput").value = item.title || "";
  $("#deliverableDescriptionInput").value = item.description || "";
  renderTeamOptions($("#deliverableOwnerInput"), item.owner || "");
  $("#deliverableDueInput").value = item.due || "";
  $("#deliverablePriorityInput").value = item.priority || "Media";
  $("#deliverableStatusInput").value = item.status || "planned";
  $("#deliverableTagsInput").value = (item.tags || []).join(", ");
  editingActivities = normalized.activities.map((activity) => ({ ...activity }));
  clearActivityInputs();
  renderActivitiesEditor();
  $("#deleteDeliverableButton").hidden = !item.id;
  $("#deliverableDialog").showModal();
  $("#deliverableTitleInput").focus();
}

function clearTeamInput() {
  $("#teamMemberInput").value = "";
}

function renderTeamEditor() {
  const list = $("#teamList");
  list.innerHTML = "";
  if (!editingTeam.length) {
    list.innerHTML = '<p class="team-empty">Sin integrantes capturados</p>';
    return;
  }
  editingTeam.forEach((member, index) => {
    const row = document.createElement("article");
    row.className = "team-row";
    row.innerHTML = `
      <strong>${escapeHtml(member)}</strong>
      <button type="button" class="team-remove" data-action="remove-member" data-index="${index}">Eliminar</button>
    `;
    list.appendChild(row);
  });
}

function addTeamMemberFromInput() {
  const member = $("#teamMemberInput").value.trim();
  if (!member) return;
  editingTeam = normalizeTeam([...editingTeam, member]);
  clearTeamInput();
  renderTeamEditor();
}

function renderTeamOptions(select, value = "") {
  const project = activeProject();
  const options = normalizeTeam([...(project?.team || []), value]);
  select.innerHTML = '<option value="">Sin responsable</option>';
  options.forEach((member) => {
    const option = document.createElement("option");
    option.value = member;
    option.textContent = member;
    select.appendChild(option);
  });
  select.value = options.includes(value) ? value : "";
}

function clearActivityInputs() {
  $("#activityTextInput").value = "";
  renderTeamOptions($("#activityOwnerInput"), "");
  $("#activityDueInput").value = "";
}

function renderActivitiesEditor() {
  const list = $("#activitiesList");
  list.innerHTML = "";
  if (!editingActivities.length) {
    list.innerHTML = '<p class="activity-empty">Sin actividades capturadas</p>';
    return;
  }
  editingActivities.forEach((activity, index) => {
    const row = document.createElement("article");
    row.className = "activity-row";
    row.innerHTML = `
      <label class="activity-check"><input type="checkbox" ${activity.done ? "checked" : ""} data-action="toggle" data-index="${index}" /><span></span></label>
      <div><strong>${escapeHtml(activity.text)}</strong><p>${escapeHtml(activity.owner || "Sin responsable")}${activity.due ? ` · ${escapeHtml(formatDate(activity.due))}` : ""}</p></div>
      <button type="button" class="activity-remove" data-action="remove" data-index="${index}">Eliminar</button>
    `;
    list.appendChild(row);
  });
}

function renderUsersEditor() {
  const list = $("#usersList");
  list.innerHTML = "";
  if (!state.users.length) {
    list.innerHTML = '<p class="empty-state">No hay usuarios registrados.</p>';
    return;
  }
  state.users.forEach((user) => {
    const row = document.createElement("article");
    row.className = "user-row";
    row.dataset.id = user.id;
    row.innerHTML = `
      <div><strong>${escapeHtml(user.name)}</strong><p>${escapeHtml(user.email)}</p></div>
      <label>Rol<select data-field="role"><option value="admin">Admin</option><option value="leader">Líder de Proyecto</option></select></label>
      <label>Status<select data-field="status"><option value="pending">Pendiente</option><option value="active">Activo</option><option value="disabled">Bloqueado</option></select></label>
      <span class="status-pill" data-status="${escapeHtml(user.status)}">${escapeHtml(statusLabels[user.status] || user.status)}</span>
    `;
    row.querySelector('[data-field="role"]').value = user.role;
    row.querySelector('[data-field="status"]').value = user.status;
    list.appendChild(row);
  });
}

async function openUsersDialog() {
  if (!isAdmin()) return;
  await loadUsers();
  renderUsersEditor();
  $("#usersDialog").showModal();
}

function addActivityFromInputs() {
  const text = $("#activityTextInput").value.trim();
  if (!text) return;
  editingActivities.push({
    text,
    owner: $("#activityOwnerInput").value,
    due: $("#activityDueInput").value,
    done: false,
  });
  clearActivityInputs();
  renderActivitiesEditor();
}
async function moveDeliverable(status) {
  const project = activeProject();
  if (!project) return;
  const item = project.deliverables.find((d) => d.id === draggedId);
  if (!item) return;
  item.status = status;
  await saveActiveProject();
  render();
}

columns.forEach((column) => {
  const option = document.createElement("option");
  option.value = column.id;
  option.textContent = column.title;
  $("#deliverableStatusInput").appendChild(option);
});

$("#newProjectButton").addEventListener("click", () => openProjectDialog());
$("#kanbanViewButton").addEventListener("click", () => setViewMode("kanban"));
$("#ganttViewButton").addEventListener("click", () => setViewMode("gantt"));
$("#editProjectButton").addEventListener("click", () => openProjectDialog(activeProject()));
$("#deleteProjectButton").addEventListener("click", async () => {
  const project = activeProject();
  if (!project || !isAdmin()) return;
  if (!confirm(`Eliminar el proyecto "${project.title}"? Esta acci\u00f3n no se puede deshacer.`)) return;
  await removeProject(project.id);
});
$("#closeProjectDialog").addEventListener("click", () => $("#projectDialog").close());
$("#cancelProjectButton").addEventListener("click", () => $("#projectDialog").close());
$("#addTeamMemberButton").addEventListener("click", addTeamMemberFromInput);
$("#teamMemberInput").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); addTeamMemberFromInput(); } });
$("#teamList").addEventListener("click", (event) => {
  if (event.target.dataset.action !== "remove-member") return;
  editingTeam.splice(Number(event.target.dataset.index), 1);
  renderTeamEditor();
});
$("#newDeliverableButton").addEventListener("click", () => openDeliverableDialog());
$("#closeDeliverableDialog").addEventListener("click", () => $("#deliverableDialog").close());
$("#cancelDeliverableButton").addEventListener("click", () => $("#deliverableDialog").close());
$("#addActivityButton").addEventListener("click", addActivityFromInputs);
$("#activityTextInput").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); addActivityFromInputs(); } });
$("#activitiesList").addEventListener("change", (event) => { if (event.target.dataset.action !== "toggle") return; editingActivities[Number(event.target.dataset.index)].done = event.target.checked; renderActivitiesEditor(); });
$("#activitiesList").addEventListener("click", (event) => { if (event.target.dataset.action !== "remove") return; editingActivities.splice(Number(event.target.dataset.index), 1); renderActivitiesEditor(); });
$("#searchInput").addEventListener("input", (e) => { state.search = e.target.value.trim().toLowerCase(); render(); });
["status", "priority", "owner", "risk"].forEach((name) => $(`#${name}Filter`).addEventListener("change", (e) => { state.filters[name] = e.target.value; render(); }));
$("#clearFiltersButton").addEventListener("click", () => { state.search = ""; state.filters = { status: "all", priority: "all", owner: "all", risk: "all" }; $("#searchInput").value = ""; render(); });

$("#showRegisterButton").addEventListener("click", () => showAuthMode("register"));
$("#showLoginButton").addEventListener("click", () => showAuthMode("login"));
$("#signOutButton").addEventListener("click", () => signOut(auth));
$("#pendingSignOutButton").addEventListener("click", () => signOut(auth));
$("#manageUsersButton").addEventListener("click", openUsersDialog);
$("#closeUsersDialog").addEventListener("click", () => $("#usersDialog").close());
$("#cancelUsersButton").addEventListener("click", () => $("#usersDialog").close());

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  setAuthMessage("#loginMessage", "Entrando...", "info");
  try {
    await signInWithEmailAndPassword(auth, normalizeEmail($("#loginEmailInput").value), $("#loginPasswordInput").value);
    setAuthMessage("#loginMessage", "", "info");
  } catch (error) {
    setAuthMessage("#loginMessage", "No se pudo iniciar sesión. Revisa correo y contraseña.");
  }
});

$("#registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  setAuthMessage("#registerMessage", "Creando cuenta...", "info");
  try {
    const name = $("#registerNameInput").value.trim();
    const credential = await createUserWithEmailAndPassword(auth, normalizeEmail($("#registerEmailInput").value), $("#registerPasswordInput").value);
    await updateProfile(credential.user, { displayName: name });
    await setDoc(userDoc(credential.user.uid), {
      name,
      email: normalizeEmail(credential.user.email),
      role: "leader",
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: serverTimestamp(),
    });
    setAuthMessage("#registerMessage", "Cuenta creada. Queda pendiente de aprobación.", "info");
  } catch (error) {
    setAuthMessage("#registerMessage", "No se pudo crear la cuenta. Revisa el correo o contraseña.");
  }
});

$("#usersForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isAdmin()) return;
  const updates = [...document.querySelectorAll(".user-row")].map((row) => updateDoc(userDoc(row.dataset.id), {
    role: row.querySelector('[data-field="role"]').value,
    status: row.querySelector('[data-field="status"]').value,
    updatedAt: serverTimestamp(),
  }));
  await Promise.all(updates);
  await loadUsers();
  $("#usersDialog").close();
});

$("#projectForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#projectIdInput").value;
  const data = { title: $("#projectTitleInput").value.trim(), client: $("#projectClientInput").value.trim(), goal: $("#projectGoalInput").value.trim(), leaderEmail: normalizeEmail($("#projectLeaderInput").value), team: normalizeTeam(editingTeam) };
  if (id) await updateProject(id, data); else await createProject(data);
  $("#projectDialog").close();
});

$("#deliverableForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const project = activeProject();
  if (!project) return;
  const id = $("#deliverableId").value || crypto.randomUUID();
  const item = normalizeDeliverable({
    id,
    title: $("#deliverableTitleInput").value.trim(),
    description: $("#deliverableDescriptionInput").value.trim(),
    owner: $("#deliverableOwnerInput").value,
    due: $("#deliverableDueInput").value,
    priority: $("#deliverablePriorityInput").value,
    status: $("#deliverableStatusInput").value,
    tags: $("#deliverableTagsInput").value.split(",").map((t) => t.trim()).filter(Boolean),
    activities: editingActivities.map((activity) => ({ ...activity })), 
  });
  const index = project.deliverables.findIndex((d) => d.id === id);
  if (index >= 0) project.deliverables[index] = item; else project.deliverables.push(item);
  await saveActiveProject();
  $("#deliverableDialog").close();
  render();
});
$("#deleteDeliverableButton").addEventListener("click", async () => {
  const project = activeProject();
  if (!project) return;
  const id = $("#deliverableId").value;
  project.deliverables = project.deliverables.filter((d) => d.id !== id);
  await saveActiveProject();
  $("#deliverableDialog").close();
  render();
});
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("service-worker.js"));

showAuthMode("login");
onAuthStateChanged(auth, async (user) => {
  if (unsubscribeProjects) unsubscribeProjects();
  state.currentUser = user;
  state.currentProfile = null;
  state.projects = [];
  state.activeProjectId = "";
  state.ready = false;
  if (!user) {
    showAuthMode("login");
    return;
  }
  const profile = normalizeUser(await ensureUserProfile(user), user.uid);
  state.currentProfile = profile;
  if (profile.status !== "active") {
    showAuthMode("pending");
    return;
  }
  if (isAdmin()) await loadUsers();
  showApp();
  render();
  startFirestore();
});





