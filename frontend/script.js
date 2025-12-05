// Utilise automatiquement l'hôte actuel pour éviter les erreurs de requête
// lorsqu'on accède à l'application depuis un autre appareil que le serveur.
const API_URL = `${window.location.protocol}//${window.location.hostname}:5610/transcribe`;

const messagesDiv = document.getElementById("messages");
const statusText = document.getElementById("status");

function addMessage(text, index) {
  const message = document.createElement("div");
  message.className = "message";
  message.textContent = index
    ? `Parcelle ${index} · ${text || "(aucun texte détecté)"}`
    : text;
  messagesDiv.appendChild(message);
}

async function uploadAudio() {
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
