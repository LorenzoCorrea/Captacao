"""Voz do Jarvis: POST /falar {"texto": ...} -> audio/wav (Kokoro, voz pm_alex). Só em 127.0.0.1:8096."""
import io
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock

import soundfile as sf
from kokoro_onnx import Kokoro

CACHE = os.environ.get("KOKORO_CACHE", "/srv/jarvis-voz/kokoro/cache")
MAX = 600
kokoro = Kokoro(f"{CACHE}/kokoro-v1.0.onnx", f"{CACHE}/voices-v1.0.bin")
trava = Lock()  # um áudio por vez: a CPU é dividida com o resto do servidor


def falar(texto: str) -> bytes:
    with trava:
        amostras, taxa = kokoro.create(texto, voice="pm_alex", speed=1.0, lang="pt-br")
    buf = io.BytesIO()
    sf.write(buf, amostras, taxa, format="WAV", subtype="PCM_16")
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def responder(self, status, corpo, tipo="text/plain; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def do_GET(self):
        if self.path == "/saude":
            return self.responder(200, b"ok")
        self.responder(404, b"nao encontrado")

    def do_POST(self):
        if self.path != "/falar":
            return self.responder(404, b"nao encontrado")
        try:
            n = int(self.headers.get("Content-Length", "0"))
            texto = str(json.loads(self.rfile.read(min(n, 16384)) or b"{}").get("texto", "")).strip()
        except (ValueError, AttributeError):
            return self.responder(400, b"JSON invalido")
        if not texto or len(texto) > MAX:
            return self.responder(400, f"texto vazio ou com mais de {MAX} caracteres".encode())
        self.responder(200, falar(texto), "audio/wav")

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    falar("Olá.")  # aquece o modelo antes de aceitar pedidos
    ThreadingHTTPServer(("127.0.0.1", 8096), Handler).serve_forever()
