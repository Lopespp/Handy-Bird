"""Servidor local para testar a versao web antes do deploy.

Uso (na raiz do projeto):
    python tools/serve.py          # http://127.0.0.1:8090/
    python tools/serve.py 8080     # outra porta

Igual ao `python -m http.server`, mas manda o navegador sempre revalidar os
arquivos, como no Netlify. Assim uma imagem ou um script alterado aparece ao
recarregar a pagina, sem ficar preso no cache.
"""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys

WEB_DIRECTORY = Path(__file__).resolve().parent.parent / "web"


class RevalidatingHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
    handler = partial(RevalidatingHandler, directory=str(WEB_DIRECTORY))
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        print(f"Handy Bird em http://127.0.0.1:{port}/ (Ctrl+C para parar)")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
