# 🎙️ AudioTranscriber

**AudioTranscriber** est une application web 100 % locale qui convertit automatiquement la parole en texte en français 🇫🇷.  
Elle utilise le modèle **Whisper** (open-source, d’OpenAI) et tourne entièrement en local via **Docker**, sans dépendre d’API externes ou de connexion Internet.

---

## 🚀 Fonctionnalités

- 🎧 Conversion **audio → texte** (formats `.mp3`, `.wav`, `.mp4`, etc.)
- 🧠 Basé sur **Whisper open-source** (aucune clé API requise)
- 🐳 **100 % Dockerisé** : déploiement en une commande
- 🔐 **Aucune donnée envoyée en ligne** — tout reste sur votre machine
- 🌐 Interface web claire et minimaliste
- ⚙️ Architecture **séparée frontend/backend**
  - Backend Flask → port `5610`
  - Frontend Nginx → port `8787`
- ⏱️ Découpage automatique en parcelles avec affichage progressif des transcriptions
- 📂 Indication claire des formats audio supportés (WAV, MP3, M4A, AAC, OGG, FLAC)

---

## 🧱 Architecture du projet

```
AudioTranscriber/
├── backend/
│   ├── app.py               # Serveur Flask + Whisper
│   ├── requirements.txt     # Dépendances Python
│   ├── Dockerfile           # Image backend (Flask)
│   └── temp_audio_input/    # Fichiers audio temporaires
│
├── frontend/
│   ├── index.html           # Interface web
│   ├── script.js            # Logique client (Fetch + affichage)
│   ├── style.css            # Styles minimalistes
│   └── Dockerfile           # Image frontend (Nginx)
│
├── docker-compose.yml       # Orchestration backend + frontend
└── README.md
```

---

## 🐳 Déploiement rapide avec Docker

### 1️⃣ Cloner le dépôt

```bash
git clone https://github.com/hatembellaaj/AudioTranscriber.git
cd AudioTranscriber
```

### 2️⃣ Lancer l’application

```bash
docker-compose up --build
```

### 3️⃣ Accéder à l’interface

- **Frontend (page web)** → [http://127.0.0.1:8787](http://127.0.0.1:8787)
- **Backend API (Flask)** → [http://127.0.0.1:5610/transcribe](http://127.0.0.1:5610/transcribe)

---

## 🧠 Utilisation

1. Ouvrez [http://127.0.0.1:8787](http://127.0.0.1:8787)
2. Chargez un fichier audio (`.mp3`, `.wav`, `.mp4`, etc.)
3. Cliquez sur **Transcrire**
4. L’application affiche le texte reconnu sous forme de message 💬

---

## ⚙️ Technologies utilisées

| Couche | Technologie | Rôle |
|:-------|:-------------|:-----|
| 🧠 Backend | Flask (Python) | API locale de transcription |
| 🎙️ Speech-to-Text | Whisper (openai-whisper) | Modèle de reconnaissance vocale |
| 🌐 Frontend | HTML / CSS / JavaScript | Interface utilisateur |
| 🐳 Conteneurisation | Docker + Docker Compose | Exécution isolée |
| 🎞️ Audio | ffmpeg | Décodage des fichiers audio/vidéo |

---

## 🧩 Ports utilisés

| Service | Port local | Description |
|----------|-------------|-------------|
| Flask Backend | `5610` | API `/transcribe` |
| Nginx Frontend | `8787` | Interface web utilisateur |

---

## 🧰 Dépendances principales

Fichier `backend/requirements.txt` :

```
flask
flask-cors
openai-whisper
torch
ffmpeg-python
```

> 📝 `ffmpeg` est déjà installé dans le conteneur Docker — aucune action requise côté hôte.

---

## 📦 Commandes utiles Docker

```bash
# Construire les images
docker-compose build

# Lancer les conteneurs
docker-compose up

# Exécuter en arrière-plan
docker-compose up -d

# Arrêter les conteneurs
docker-compose down

# Supprimer les images et volumes inutilisés
docker system prune -a
```

---

## 🧹 Nettoyage

Les fichiers temporaires audio sont stockés dans :
```
backend/temp_audio_input/
```
Ils sont automatiquement montés en volume Docker (persistants tant que vous ne les supprimez pas).

---

## 💬 Auteur

👤 **[Hatem Bellaaj](https://github.com/hatembellaaj)**  
📧 Projet open-source — contributions bienvenues !  
💡 Si vous trouvez ce projet utile, ⭐ **n’hésitez pas à le starer sur GitHub** !

---

## 🛠️ Licence

Ce projet est distribué sous la licence **MIT**.  
Vous êtes libre de l’utiliser, le modifier et le redistribuer.

---

### 📸 Exemple d’interface

![UI](https://raw.githubusercontent.com/hatembellaaj/AudioTranscriber/main/.github/demo.png)
