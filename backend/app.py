from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
import glob
import json
import os
import shutil
import subprocess
import tempfile
import whisper

app = Flask(__name__)
CORS(app)

model = whisper.load_model("small")

def _split_audio(file_path: str, chunk_seconds: int = 20):
    """Découpe le fichier audio en segments pour un retour progressif."""
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


def _transcribe_generator(file_path: str):
    """Génère les transcriptions de chaque segment en temps réel."""
    chunk_dir = None
    try:
        chunk_files, chunk_dir = _split_audio(file_path)
        if not chunk_files:
            yield json.dumps({"type": "error", "message": "Aucun segment audio détecté."}) + "\n"
            return

        for idx, chunk_file in enumerate(chunk_files, start=1):
            result = model.transcribe(chunk_file, language="fr")
            yield json.dumps({"type": "chunk", "index": idx, "text": result.get("text", "")}) + "\n"

        yield json.dumps({"type": "complete"}) + "\n"
    except subprocess.CalledProcessError:
        yield json.dumps({"type": "error", "message": "Impossible de découper le fichier audio."}) + "\n"
    except Exception as exc:  # noqa: BLE001 - log toutes les erreurs pour retour client
        print("Erreur :", exc)
        yield json.dumps({"type": "error", "message": str(exc)}) + "\n"
    finally:
        try:
            os.remove(file_path)
        except OSError:
            pass
        if chunk_dir:
            try:
                shutil.rmtree(chunk_dir, ignore_errors=True)
            except OSError:
                pass


@app.route("/transcribe", methods=["POST"])
def transcribe():
    try:
        audio_file = request.files["audio"]
        audio_path = "temp_audio_input"
        os.makedirs(audio_path, exist_ok=True)

        file_path = os.path.join(audio_path, audio_file.filename)
        audio_file.save(file_path)

        # 🔍 Vérifie que le fichier contient bien du son
        try:
            duration_cmd = [
                "ffprobe", "-i", file_path, "-show_entries", "format=duration",
                "-v", "quiet", "-of", "csv=p=0"
            ]
            duration = float(subprocess.check_output(duration_cmd).decode().strip())
            if duration < 0.1:
                return jsonify({"text": "Erreur : fichier audio vide ou très court"}), 400
        except Exception:
            pass  # ignore si ffprobe indisponible

        return Response(stream_with_context(_transcribe_generator(file_path)), mimetype="application/json")

    except Exception as e:  # noqa: BLE001 - remonte les erreurs jusqu'au client
        print("Erreur :", e)
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5610, debug=False)

