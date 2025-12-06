from datetime import datetime
from functools import wraps
import glob
import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
from typing import Iterable, Optional

from flask import Flask, Response, g, jsonify, request, stream_with_context
from flask_cors import CORS
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename
import whisper

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("APP_SECRET_KEY", "tn-portal-secret")
CORS(app)

DATABASE_PATH = os.path.join(os.path.dirname(__file__), "data.db")
AUDIO_STORAGE = os.path.join(os.path.dirname(__file__), "stored_audio")
TOKEN_EXPIRATION_SECONDS = 60 * 60 * 12

os.makedirs(AUDIO_STORAGE, exist_ok=True)

serializer = URLSafeTimedSerializer(app.config["SECRET_KEY"])
model = whisper.load_model("small")


def _get_db():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db():
    with _get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                login TEXT UNIQUE NOT NULL,
                email TEXT,
                first_name TEXT,
                last_name TEXT,
                password_hash TEXT NOT NULL,
                is_admin INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS transcriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_login TEXT NOT NULL,
                file_name TEXT NOT NULL,
                file_path TEXT,
                duration_seconds REAL,
                transcribed_at TEXT DEFAULT CURRENT_TIMESTAMP,
                full_text TEXT
            )
            """
        )


def _create_admin_if_missing():
    admin_login = "admin@tunisienumerique.tn"
    admin_password = "TN2026$$"
    with _get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM users WHERE login = ?", (admin_login,)
        ).fetchone()
        if existing:
            return
        conn.execute(
            """
            INSERT INTO users (login, email, first_name, last_name, password_hash, is_admin)
            VALUES (?, ?, ?, ?, ?, 1)
            """,
            (
                admin_login,
                admin_login,
                "Admin",
                "Portail IA",
                generate_password_hash(admin_password),
            ),
        )


_init_db()
_create_admin_if_missing()


def _generate_token(user: sqlite3.Row) -> str:
    payload = {
        "id": user["id"],
        "login": user["login"],
        "is_admin": bool(user["is_admin"]),
    }
    return serializer.dumps(payload)


def _decode_token(token: str) -> Optional[sqlite3.Row]:
    try:
        data = serializer.loads(token, max_age=TOKEN_EXPIRATION_SECONDS)
    except (BadSignature, SignatureExpired):
        return None

    with _get_db() as conn:
        user = conn.execute("SELECT * FROM users WHERE id = ?", (data.get("id"),)).fetchone()
        return user


def _require_auth(admin_only: bool = False):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            auth_header = request.headers.get("Authorization", "")
            if not auth_header.startswith("Bearer "):
                return jsonify({"error": "Jeton manquant"}), 401

            token = auth_header.split(" ", 1)[1]
            user = _decode_token(token)
            if not user:
                return jsonify({"error": "Jeton invalide ou expiré"}), 401
            if admin_only and not bool(user["is_admin"]):
                return jsonify({"error": "Accès refusé"}), 403

            g.current_user = user
            return func(*args, **kwargs)
        return wrapper

    return decorator


def _split_audio(file_path: str, chunk_seconds: int = 20):
    """Découpe le fichier audio en segments pour un retour progressif."""
    os.makedirs("temp_audio_input", exist_ok=True)
    chunk_dir = tempfile.mkdtemp(prefix="chunks_", dir="temp_audio_input")
    chunk_pattern = os.path.join(chunk_dir, "chunk_%03d.wav")

    split_cmd = [
        "ffmpeg",
        "-i",
        file_path,
        "-f",
        "segment",
        "-segment_time",
        str(chunk_seconds),
        "-map",
        "0:a:0",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        chunk_pattern,
        "-loglevel",
        "quiet",
    ]

    subprocess.run(split_cmd, check=True)
    return sorted(glob.glob(os.path.join(chunk_dir, "chunk_*.wav"))), chunk_dir


def _record_transcription(user_login: str, file_path: str, duration: Optional[float], full_text: str):
    with _get_db() as conn:
        conn.execute(
            """
            INSERT INTO transcriptions (user_login, file_name, file_path, duration_seconds, transcribed_at, full_text)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                user_login,
                os.path.basename(file_path),
                file_path,
                duration,
                datetime.utcnow().isoformat(),
                full_text,
            ),
        )


def _transcribe_generator(
    file_path: str, user_login: str, duration: Optional[float], language: Optional[str] = None
) -> Iterable[str]:
    """Génère les transcriptions de chaque segment en temps réel et enregistre en base.

    Si ``language`` est fourni, il est transmis à Whisper. Sinon, la détection automatique
    est utilisée (utile pour gérer l'arabe, le français ou l'anglais sans changer de paramètre).
    """
    chunk_dir = None
    collected_text: list[str] = []
    success = False
    try:
        chunk_files, chunk_dir = _split_audio(file_path)
        if not chunk_files:
            yield json.dumps({"type": "error", "message": "Aucun segment audio détecté."}) + "\n"
            return

        transcribe_kwargs = {}
        if language:
            transcribe_kwargs["language"] = language

        for idx, chunk_file in enumerate(chunk_files, start=1):
            result = model.transcribe(chunk_file, **transcribe_kwargs)
            text = result.get("text", "")
            collected_text.append(text.strip())
            yield json.dumps({"type": "chunk", "index": idx, "text": text}) + "\n"

        yield json.dumps({"type": "complete"}) + "\n"
        success = True
    except subprocess.CalledProcessError:
        yield json.dumps({"type": "error", "message": "Impossible de découper le fichier audio."}) + "\n"
    except Exception as exc:  # noqa: BLE001 - log toutes les erreurs pour retour client
        print("Erreur :", exc)
        yield json.dumps({"type": "error", "message": str(exc)}) + "\n"
    finally:
        if chunk_dir:
            try:
                shutil.rmtree(chunk_dir, ignore_errors=True)
            except OSError:
                pass

        if success:
            _record_transcription(user_login, file_path, duration, " ".join(collected_text).strip())


@app.route("/login", methods=["POST"])
def login():
    payload = request.get_json(force=True)
    login_value = (payload.get("login") or "").strip().lower()
    password = payload.get("password") or ""

    if not login_value or not password:
        return jsonify({"error": "Login et mot de passe requis"}), 400

    with _get_db() as conn:
        user = conn.execute("SELECT * FROM users WHERE lower(login) = ?", (login_value,)).fetchone()

    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Identifiants invalides"}), 401

    token = _generate_token(user)
    return jsonify(
        {
            "token": token,
            "user": {
                "login": user["login"],
                "email": user["email"],
                "first_name": user["first_name"],
                "last_name": user["last_name"],
                "is_admin": bool(user["is_admin"]),
            },
        }
    )


@app.route("/transcribe", methods=["POST"])
@_require_auth()
def transcribe():
    try:
        audio_file = request.files.get("audio")
        if not audio_file:
            return jsonify({"error": "Aucun fichier fourni"}), 400

        safe_name = secure_filename(audio_file.filename) or "audio.wav"
        timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
        stored_filename = f"{timestamp}_{safe_name}"
        file_path = os.path.join(AUDIO_STORAGE, stored_filename)
        audio_file.save(file_path)

        duration: Optional[float] = None
        try:
            duration_cmd = [
                "ffprobe",
                "-i",
                file_path,
                "-show_entries",
                "format=duration",
                "-v",
                "quiet",
                "-of",
                "csv=p=0",
            ]
            duration = float(subprocess.check_output(duration_cmd).decode().strip())
            if duration < 0.1:
                return jsonify({"text": "Erreur : fichier audio vide ou très court"}), 400
        except Exception:
            pass  # ignore si ffprobe indisponible

        language_raw = request.form.get("language", "").strip().lower()
        language = language_raw if language_raw not in {"", "auto"} else None

        return Response(
            stream_with_context(
                _transcribe_generator(
                    file_path,
                    g.current_user["login"],
                    duration,
                    language=language,
                )
            ),
            mimetype="application/json",
        )

    except Exception as e:  # noqa: BLE001 - remonte les erreurs jusqu'au client
        print("Erreur :", e)
        return jsonify({"error": str(e)}), 500


@app.route("/export/latest", methods=["GET"])
@_require_auth()
def export_latest_transcription():
    user_login = g.current_user["login"]
    with _get_db() as conn:
        row = conn.execute(
            """
            SELECT file_name, transcribed_at, full_text
            FROM transcriptions
            WHERE user_login = ?
            ORDER BY transcribed_at DESC
            LIMIT 1
            """,
            (user_login,),
        ).fetchone()

    latest_text = (row["full_text"] or "").strip() if row else ""
    if not latest_text:
        return jsonify({"error": "Aucune transcription disponible pour export"}), 404

    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    safe_name = secure_filename(row["file_name"]) or "transcription"
    base_name = os.path.splitext(safe_name)[0] or "transcription"
    filename = f"{base_name}_{timestamp}.txt"

    response = Response(latest_text, mimetype="text/plain; charset=utf-8")
    response.headers["Content-Disposition"] = f"attachment; filename={filename}"
    return response


@app.route("/admin/transcriptions", methods=["GET"])
@_require_auth(admin_only=True)
def list_transcriptions():
    user_filter = request.args.get("user")
    start_date = request.args.get("start_date")
    end_date = request.args.get("end_date")

    query = (
        "SELECT id, user_login, file_name, file_path, duration_seconds, transcribed_at, "
        "CASE WHEN full_text IS NOT NULL AND length(trim(full_text)) > 0 THEN 1 ELSE 0 END as has_text "
        "FROM transcriptions WHERE 1=1"
    )
    params: list[str] = []
    if user_filter:
        query += " AND user_login = ?"
        params.append(user_filter)
    if start_date:
        query += " AND transcribed_at >= ?"
        params.append(start_date)
    if end_date:
        query += " AND transcribed_at <= ?"
        params.append(end_date)

    query += " ORDER BY transcribed_at DESC"

    with _get_db() as conn:
        rows = conn.execute(query, params).fetchall()

    return jsonify(
        [
            {
                "id": row["id"],
                "user_login": row["user_login"],
                "file_name": row["file_name"],
                "file_path": row["file_path"],
                "duration_seconds": row["duration_seconds"],
                "transcribed_at": row["transcribed_at"],
                "has_text": bool(row["has_text"]),
            }
            for row in rows
        ]
    )


@app.route("/admin/transcriptions/<int:transcription_id>", methods=["GET"])
@_require_auth(admin_only=True)
def get_transcription_detail(transcription_id: int):
    with _get_db() as conn:
        row = conn.execute(
            """
            SELECT id, user_login, file_name, transcribed_at, full_text
            FROM transcriptions
            WHERE id = ?
            """,
            (transcription_id,),
        ).fetchone()

    if not row:
        return jsonify({"error": "Transcription introuvable"}), 404

    full_text = (row["full_text"] or "").strip()
    if not full_text:
        return jsonify({"error": "Aucun texte enregistré pour cette transcription"}), 404

    return jsonify(
        {
            "id": row["id"],
            "user_login": row["user_login"],
            "file_name": row["file_name"],
            "transcribed_at": row["transcribed_at"],
            "full_text": full_text,
        }
    )


@app.route("/admin/users", methods=["GET", "POST"])
@_require_auth(admin_only=True)
def manage_users():
    if request.method == "GET":
        with _get_db() as conn:
            users = conn.execute(
                "SELECT login, email, first_name, last_name, is_admin, created_at FROM users ORDER BY created_at DESC"
            ).fetchall()

        return jsonify(
            [
                {
                    "login": user["login"],
                    "email": user["email"],
                    "first_name": user["first_name"],
                    "last_name": user["last_name"],
                    "is_admin": bool(user["is_admin"]),
                    "created_at": user["created_at"],
                }
                for user in users
            ]
        )

    payload = request.get_json(force=True)
    login_value = (payload.get("login") or "").strip().lower()
    first_name = (payload.get("first_name") or "").strip()
    last_name = (payload.get("last_name") or "").strip()
    email = (payload.get("email") or "").strip()
    password = payload.get("password") or ""

    if not login_value or not password:
        return jsonify({"error": "Login et mot de passe requis"}), 400

    with _get_db() as conn:
        try:
            conn.execute(
                """
                INSERT INTO users (login, email, first_name, last_name, password_hash, is_admin)
                VALUES (?, ?, ?, ?, ?, 0)
                """,
                (login_value, email, first_name, last_name, generate_password_hash(password)),
            )
        except sqlite3.IntegrityError:
            return jsonify({"error": "Ce login existe déjà"}), 400

    return jsonify({"message": "Utilisateur créé"})


@app.route("/me", methods=["GET"])
@_require_auth()
def me():
    user = g.current_user
    return jsonify(
        {
            "login": user["login"],
            "email": user["email"],
            "first_name": user["first_name"],
            "last_name": user["last_name"],
            "is_admin": bool(user["is_admin"]),
        }
    )

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5610, debug=False)

