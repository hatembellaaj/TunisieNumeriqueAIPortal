// Utilise automatiquement l'hôte actuel pour éviter les erreurs de requête
// lorsqu'on accède à l'application depuis un autre appareil que le serveur.
const API_BASE = `${window.location.protocol}//${window.location.hostname}:15610`;
const API_TRANSCRIBE = `${API_BASE}/transcribe`;
const API_LOGIN = `${API_BASE}/login`;
const API_USERS = `${API_BASE}/admin/users`;
const API_TRANSCRIPTIONS = `${API_BASE}/admin/transcriptions`;
const API_EXPORT = `${API_BASE}/export/latest`;

const messagesDiv = document.getElementById("messages");
const statusText = document.getElementById("status");
const authStatus = document.getElementById("authStatus");
const logoutBtn = document.getElementById("logoutBtn");
const loginForm = document.getElementById("loginForm");
const transcribeCard = document.getElementById("transcribeCard");
const featureList = document.getElementById("featureList");
const adminCard = document.getElementById("adminCard");
const userCard = document.getElementById("userCard");
const languageSelect = document.getElementById("language");
const filterUser = document.getElementById("filterUser");
const filterStart = document.getElementById("filterStart");
const filterEnd = document.getElementById("filterEnd");
const transcriptionTable = document.getElementById("transcriptionTable");
const userForm = document.getElementById("userForm");

const state = {
  token: null,
  user: null,
};

const FEATURES = [
  { name: "Transcrire un fichier audio", status: "ready", key: "audio-file" },
  { name: "Transcrire une vidéo", status: "soon", key: "video" },
  { name: "Enregistrement en direct (micro)", status: "soon", key: "live" },
  { name: "Transcription WhatsApp / mobile", status: "soon", key: "mobile" },
  { name: "Transcription multi-locuteurs", status: "soon", key: "multi" },
  { name: "Identifier les intervenants", status: "soon", key: "speakers" },
  { name: "Nettoyer la transcription", status: "soon", key: "cleanup" },
  { name: "Corriger orthographe & ponctuation", status: "soon", key: "grammar" },
  { name: "Résumé express (5 lignes)", status: "soon", key: "summary" },
  { name: "Résumé détaillé (plan d’article)", status: "soon", key: "detailed" },
  { name: "Extraction de citations clés", status: "soon", key: "quotes" },
  { name: "Générer un brouillon d’article", status: "soon", key: "draft" },
  { name: "Générer des sous-titres (.srt / .vtt)", status: "soon", key: "subtitles" },
  { name: "Découper par chapitres / thèmes", status: "soon", key: "chapters" },
  { name: "Rechercher un mot / passage", status: "soon", key: "search" },
  { name: "Traduire la transcription (FR ↔ AR)", status: "soon", key: "translate" },
  { name: "Comparer deux versions", status: "soon", key: "compare" },
  { name: "Exporter la transcription", status: "ready", key: "export" },
  { name: "Historique de mes transcriptions", status: "soon", key: "history" },
  { name: "Paramètres Speech-to-Text", status: "soon", key: "settings" },
];

function renderFeatures() {
  featureList.innerHTML = "";
  FEATURES.forEach((feature) => {
    const item = document.createElement("div");
    item.className = `feature-item ${feature.status === "ready" ? "active" : ""}`;
    item.innerHTML = `
      <span>${feature.name}</span>
      <span class="badge ${feature.status === "ready" ? "success" : "soon"}">
        ${feature.status === "ready" ? "Opérationnel" : "Bientôt"}
      </span>
    `;
    featureList.appendChild(item);
  });
}

function addMessage(text, index) {
  const message = document.createElement("div");
  message.className = "message";
  message.textContent = index
    ? `Parcelle ${index} · ${text || "(aucun texte détecté)"}`
    : text;
  messagesDiv.appendChild(message);
}

function clearTranscription() {
  messagesDiv.innerHTML = "";
  statusText.textContent = "Aucun traitement en cours.";
}

function setAuthenticated(user, token) {
  state.user = user;
  state.token = token;
  if (user && token) {
    localStorage.setItem("tn_portal_token", token);
    localStorage.setItem("tn_portal_user", JSON.stringify(user));
  } else {
    localStorage.removeItem("tn_portal_token");
    localStorage.removeItem("tn_portal_user");
  }

  const loggedText = user ? `Connecté en tant que ${user.login}` : "Connexion requise";
  authStatus.textContent = loggedText;
  logoutBtn.hidden = !user;
  transcribeCard.classList.toggle("disabled", !user);

  const isAdmin = Boolean(user?.is_admin);
  adminCard.hidden = !isAdmin;
  userCard.hidden = !isAdmin;

  if (isAdmin) {
    loadUsers();
    loadTranscriptions();
  } else {
    filterUser.innerHTML = '<option value="">Tous</option>';
    transcriptionTable.innerHTML = "";
  }
}

function restoreSession() {
  const token = localStorage.getItem("tn_portal_token");
  const userRaw = localStorage.getItem("tn_portal_user");
  if (token && userRaw) {
    try {
      const parsed = JSON.parse(userRaw);
      setAuthenticated(parsed, token);
      return;
    } catch (error) {
      console.warn("Impossible de restaurer la session", error);
    }
  }
  setAuthenticated(null, null);
}

function logout() {
  setAuthenticated(null, null);
  alert("Vous êtes déconnecté.");
}

function buildAuthHeaders() {
  if (!state.token) return {};
  return { Authorization: `Bearer ${state.token}` };
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const loginValue = document.getElementById("login").value.trim();
  const password = document.getElementById("password").value.trim();

  try {
    const response = await fetch(API_LOGIN, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: loginValue, password }),
    });

    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.error || "Identifiants invalides");
    }

    const payload = await response.json();
    setAuthenticated(payload.user, payload.token);
    alert("Connexion réussie. Vous pouvez lancer la transcription.");
  } catch (error) {
    alert(error.message);
  }
});

async function uploadAudio() {
  if (!state.token) {
    alert("Connectez-vous pour lancer la transcription.");
    return;
  }

  const file = document.getElementById("audioFile").files[0];
  if (!file) {
    alert("Choisissez un fichier audio !");
    return;
  }

  const formData = new FormData();
  formData.append("audio", file);
  formData.append("language", languageSelect.value || "auto");

  messagesDiv.innerHTML = "";
  statusText.textContent = "Découpage et transcription en cours...";

  try {
    const response = await fetch(API_TRANSCRIBE, {
      method: "POST",
      body: formData,
      headers: buildAuthHeaders(),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Erreur serveur : ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("La lecture en continu n'est pas supportée par ce navigateur.");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;

        const payload = JSON.parse(line);
        if (payload.type === "chunk") {
          addMessage(payload.text?.trim(), payload.index);
          statusText.textContent = `Parcelle ${payload.index} transcrite`;
        } else if (payload.type === "error") {
          throw new Error(payload.message);
        } else if (payload.type === "complete") {
          statusText.textContent = "Transcription terminée ✅";
        }
      }
    }

    if (buffer.trim()) {
      const payload = JSON.parse(buffer);
      if (payload.type === "chunk") {
        addMessage(payload.text?.trim(), payload.index);
      }
    }

    if (state.user?.is_admin) {
      await loadTranscriptions();
    }
  } catch (error) {
    console.error("Erreur :", error);
    statusText.textContent = "Erreur de connexion avec le serveur Flask";
    addMessage("La transcription a échoué. Veuillez réessayer.");
    alert(error.message);
  }
}

async function exportLatest() {
  if (!state.token) {
    alert("Connectez-vous pour exporter la transcription.");
    return;
  }

  try {
    const response = await fetch(API_EXPORT, {
      headers: buildAuthHeaders(),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "Impossible de générer l'export");
    }

    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match?.[1] || "transcription.txt";

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    statusText.textContent = "Fichier exporté ✅";
  } catch (error) {
    alert(error.message);
  }
}

async function loadUsers() {
  if (!state.user?.is_admin) return;
  try {
    const response = await fetch(API_USERS, { headers: buildAuthHeaders() });
    if (!response.ok) throw new Error("Impossible de charger les utilisateurs");
    const users = await response.json();

    filterUser.innerHTML = '<option value="">Tous</option>';
    users.forEach((user) => {
      const option = document.createElement("option");
      option.value = user.login;
      option.textContent = `${user.login} (${user.first_name || ""} ${user.last_name || ""})`.trim();
      filterUser.appendChild(option);
    });
  } catch (error) {
    console.error(error);
  }
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return "-";
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  if (minutes === 0) return `${remaining}s`;
  return `${minutes}m ${remaining}s`;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

async function loadTranscriptions() {
  if (!state.user?.is_admin) return;
  const params = new URLSearchParams();
  if (filterUser.value) params.append("user", filterUser.value);
  if (filterStart.value) params.append("start_date", filterStart.value);
  if (filterEnd.value) params.append("end_date", filterEnd.value);

  const query = params.toString() ? `?${params.toString()}` : "";
  try {
    const response = await fetch(`${API_TRANSCRIPTIONS}${query}`, {
      headers: buildAuthHeaders(),
    });
    if (!response.ok) throw new Error("Impossible de charger les transcriptions");

    const rows = await response.json();
    transcriptionTable.innerHTML = "";
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${row.user_login}</td>
        <td>${row.file_name}<br/><small>${row.file_path || ""}</small></td>
        <td>${formatDuration(row.duration_seconds)}</td>
        <td>${formatDate(row.transcribed_at)}</td>
      `;
      transcriptionTable.appendChild(tr);
    });
  } catch (error) {
    console.error(error);
  }
}

function resetFilters() {
  filterUser.value = "";
  filterStart.value = "";
  filterEnd.value = "";
  loadTranscriptions();
}

userForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.user?.is_admin) return;

  const payload = {
    login: document.getElementById("newLogin").value.trim(),
    first_name: document.getElementById("newFirstName").value.trim(),
    last_name: document.getElementById("newLastName").value.trim(),
    email: document.getElementById("newEmail").value.trim(),
    password: document.getElementById("newPassword").value.trim(),
  };

  try {
    const response = await fetch(API_USERS, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...buildAuthHeaders() },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Création impossible");

    alert("Utilisateur créé");
    userForm.reset();
    loadUsers();
  } catch (error) {
    alert(error.message);
  }
});

renderFeatures();
restoreSession();
