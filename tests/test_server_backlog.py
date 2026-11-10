# 창 안 서버의 접수 대기 자리 시험 (docs/review-2026-11.md의 N36)
# 진짜 pywebview 서버(webview.http.BottleServer)에 StudyFlow의 Flask 앱을 올리고, 서버가 켜진 직후 잠깐 바빠서 접수(accept)를 못 하는 상황을 만든 뒤,
# 화면이 켜질 때처럼 파일 9개를 한꺼번에 요청한다. 고치기 전(대기 자리 5)에는 일부가 거절되고, widen_server_backlog 뒤에는 모두 받아야 한다.
import os, sys, socketserver, threading, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import fake_google
fake = fake_google.install()
import app, single_instance
from wsgiref.simple_server import WSGIServer
from webview.http import BottleServer

failed = 0
def check(name, ok, extra=""):
    global failed
    if not ok: failed += 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  [" + str(extra) + "]"))

# 서버가 첫 연결을 접수(accept)하기 전에 3초 동안 바쁘게 한다(켤 때 뒤에서 하는 일로 바쁜 서버 흉내). 그동안 온 연결은 대기 자리에서 기다리거나 거절된다.
# 진짜 화면(WebView2)은 거절되면 15ms 만에 포기하지만, 파이썬의 연결 함수는 Windows가 약 2초 동안 다시 시도해 준다. 그래서 그보다 길게(3초) 막는다.
# (2026-11-10 진짜 Edge로 한 실험: HTML을 보낸 뒤 접수를 0.3초만 막아도 대기 자리 5에서는 app.js 등 4개가 상태 0으로 실패, 64에서는 모두 받음)
original_get_request = socketserver.TCPServer.get_request
def busy_then_accept(self):
    # 첫 연결이 오면 그 접수부터 3초 늦춘다. 그동안 함께 온 나머지 연결은 대기 자리에 줄 서거나, 자리가 없으면 거절된다
    if not getattr(self, "was_busy", False):
        self.was_busy = True
        time.sleep(3)
    return original_get_request(self)
socketserver.TCPServer.get_request = busy_then_accept

FILES = ["/static/style.css", "/static/lib/fullcalendar.min.js", "/static/lib/fullcalendar-ko.js", "/static/lib/marked.min.js",
         "/static/lib/purify.min.js", "/static/app.js", "/static/fonts/noto-sans-kr/noto-sans-kr.css",
         "/static/fonts/google-sans-flex/google-sans-flex.css", "/"]

def burst():
    """서버를 새로 켜고, 접수가 막혀 있는 동안 파일 9개를 동시에 요청한다. 받은 개수와 결과들을 돌려준다."""
    address, _, _ = BottleServer.start_server([app.app], None)
    time.sleep(0.5)  # 서버 스레드가 연결 받을 준비(listen)를 마치기를 기다린다
    results = [None] * len(FILES)
    def get(i):
        try:
            with urllib.request.urlopen(address.rstrip("/") + FILES[i], timeout=10) as response:
                results[i] = response.status
        except Exception as error:
            results[i] = type(error).__name__
    threads = [threading.Thread(target=get, args=(i,)) for i in range(len(FILES))]
    for t in threads: t.start()
    for t in threads: t.join()
    return sum(r == 200 for r in results), results

check("(준비) 파이썬 기본 서버의 대기 자리는 5개", WSGIServer.request_queue_size == 5, WSGIServer.request_queue_size)
ok, results = burst()
check("고치기 전: 서버가 잠깐 바쁘면 동시에 온 9개 중 일부가 거절된다(빈 화면의 원인 재현)", ok < len(FILES), results)

single_instance.widen_server_backlog()
check("widen_server_backlog 뒤 대기 자리는 64개", WSGIServer.request_queue_size == 64, WSGIServer.request_queue_size)
ok, results = burst()
check("고친 뒤: 서버가 잠깐 바빠도 9개 모두 받는다(app.js 포함)", ok == len(FILES), results)

print("\n실패 %d개" % failed if failed else "\n모두 통과")
sys.exit(1 if failed else 0)
