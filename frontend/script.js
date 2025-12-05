// Utilise automatiquement l'hôte actuel pour éviter les erreurs de requête
// lorsqu'on accède à l'application depuis un autre appareil que le serveur.
const API_URL = `${window.location.protocol}//${window.location.hostname}:15610/transcribe`;

const messagesDiv = document.getElementById("messages");
const statusText = document.getElementById("status");
const authStatus = document.getElementById("authStatus");
const logoutBtn = document.getElementById("logoutBtn");
const loginForm = document.getElementById("loginForm");
const transcribeCard = document.getElementById("transcribeCard");
const featureList = document.getElementById("featureList");

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
  { name: "Exporter la transcription", status: "soon", key: "export" },
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

function setAuthenticated(isAuthenticated, email = "") {
  const loggedText = email ? `Connecté en tant que ${email}` : "Connexion requise";
  authStatus.textContent = loggedText;
  logoutBtn.hidden = !isAuthenticated;
  transcribeCard.classList.toggle("disabled", !isAuthenticated);
}

function initAuth() {
  const token = localStorage.getItem("tn_portal_token");
  const email = localStorage.getItem("tn_portal_email");
  const isAuthenticated = Boolean(token && email);
  setAuthenticated(isAuthenticated, email || "");
}

function logout() {
  localStorage.removeItem("tn_portal_token");
  localStorage.removeItem("tn_portal_email");
  setAuthenticated(false);
  alert("Vous êtes déconnecté.");
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();

  if (email.toLowerCase() === "redaction@tunisienumerique.tn" && password === "demo123") {
    localStorage.setItem("tn_portal_token", "demo-token");
    localStorage.setItem("tn_portal_email", email);
    setAuthenticated(true, email);
    alert("Connexion réussie, vous pouvez lancer la transcription.");
  } else {
    alert("Identifiants invalides. Merci d'utiliser le compte de démonstration.");
  }
});

async function uploadAudio() {
  const token = localStorage.getItem("tn_portal_token");
  if (!token) {
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

  messagesDiv.innerHTML = "";
  statusText.textContent = "Découpage et transcription en cours...";

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Erreur serveur : ${response.status}`);
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
  } catch (error) {
    console.error("Erreur :", error);
    statusText.textContent = "Erreur de connexion avec le serveur Flask";
    addMessage("La transcription a échoué. Veuillez réessayer.");
    alert(error.message);
  }
}

renderFeatures();
initAuth();
