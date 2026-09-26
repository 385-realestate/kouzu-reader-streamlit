"""ローカル確認用サーバー。本番はNginxからHTMLを直接配信する。"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path in {"/", "/kouzu", "/kouzu/"}:
            self.path = "/kouzu_reader.html"
        return super().do_GET()


if __name__ == "__main__":
    print("http://127.0.0.1:8501/kouzu/")
    ThreadingHTTPServer(("127.0.0.1", 8501), Handler).serve_forever()
