# 끊긴 연결 복구(ResilientHttp) 테스트. 로컬 가짜 서버로 "공유기가 놀던 연결을 끊은" 상황을 만든다. 실제 Google은 쓰지 않는다.
import json, os, re, socket, struct, sys, threading, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # 프로젝트 폴더
sys.stdout.reconfigure(encoding="utf-8")
import httplib2
import google.auth.credentials
from googleapiclient.errors import HttpError
import google_calendar as gc

failed = 0
def check(name, ok, extra=""):
    global failed
    if not ok: failed += 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  [" + str(extra) + "]"))


class Server:
    """아주 작은 HTTP 서버. mode: ok(정상) / rst_after_first(첫 응답 뒤 연결을 RST로 끊음) / rst_always(받자마자 RST) / silent(받고 응답 안 함)"""
    def __init__(self, mode="ok", status=200, handler=None):
        self.mode, self.status, self.handler = mode, status, handler
        self.conns = 0
        self.requests = []
        self.sock = socket.socket(); self.sock.bind(("127.0.0.1", 0)); self.sock.listen(16)
        self.port = self.sock.getsockname()[1]
        threading.Thread(target=self._accept, daemon=True).start()

    def url(self, path="/x"):
        return f"http://127.0.0.1:{self.port}{path}"

    def _accept(self):
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            self.conns += 1
            threading.Thread(target=self._handle, args=(conn, self.conns), daemon=True).start()

    @staticmethod
    def _rst(c):
        c.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
        c.close()

    def _read_request(self, c):
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = c.recv(65536)
            if not chunk:
                return None
            data += chunk
        head, _, rest = data.partition(b"\r\n\r\n")
        m = re.search(rb"content-length: *(\d+)", head, re.I)
        need = int(m.group(1)) if m else 0
        while len(rest) < need:
            rest += c.recv(65536)
        return head.decode("latin-1"), rest

    def _handle(self, c, number):
        try:
            if self.mode == "rst_always":
                self._read_request(c); self._rst(c); return
            if self.mode == "silent":
                self._read_request(c); time.sleep(5); return
            while True:
                req = self._read_request(c)
                if req is None:
                    return
                self.requests.append(req)
                status, body = (self.status, b'{"ok": true}')
                if self.handler:
                    status, body = self.handler(req)
                c.sendall(b"HTTP/1.1 %d X\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n" % (status, len(body)) + body)
                if self.mode == "rst_after_first" and number == 1:
                    time.sleep(0.2)
                    self._rst(c); return
        except OSError:
            pass

    def close(self):
        self.sock.close()


def req(http, url, method, body=None):
    return http.request(url, method, body=body, headers={"Content-Type": "application/json"})

# ===== 1. 끊긴 연결 재사용 =====
for method, body in (("GET", None), ("PATCH", '{"a": 1}'), ("POST", '{"a": 1}'), ("DELETE", None)):
    srv = Server("rst_after_first")
    plain = httplib2.Http(timeout=5)
    req(plain, srv.url(), method, body); time.sleep(0.6)
    try:
        req(plain, srv.url(), method, body); plain_ok = True
    except OSError as error:
        plain_ok = False
    srv.close()
    check(f"(대조) 그냥 httplib2는 끊긴 연결에서 {method}가 실패한다 = 문제 재현", plain_ok is False)

    srv = Server("rst_after_first")
    http = gc.ResilientHttp(timeout=5)
    r1, _ = req(http, srv.url(), method, body)
    time.sleep(0.6)   # 이 사이에 연결이 끊긴다
    r2, c2 = req(http, srv.url(), method, body)
    check(f"ResilientHttp: 끊긴 연결에서도 {method}가 성공한다(새 연결로 다시 시도)", r2.status == 200 and srv.conns == 2, [r2.status, srv.conns])
    check(f"{method}: 서버에는 요청이 한 번씩만 도착했다(두 번 처리되지 않음)", len(srv.requests) == 2, len(srv.requests))
    srv.close()

# ===== 2. 계속 실패하면 정해진 횟수만 시도하고 포기 =====
srv = Server("rst_always")
http = gc.ResilientHttp(timeout=5)
t0 = time.time()
try:
    req(http, srv.url(), "GET"); ok = True
except OSError:
    ok = False
elapsed = time.time() - t0
check("계속 끊기면 오류를 올린다", ok is False)
check("처음 + 2번 = 3번 시도하고 포기한다", srv.conns == 3, srv.conns)
check("재시도 사이에 잠깐(0.3초+1.0초) 기다린다", 1.2 <= elapsed < 4.0, round(elapsed, 2))
srv.close()

# ===== 3. 시간 초과는 다시 시도하지 않는다 =====
srv = Server("silent")
http = gc.ResilientHttp(timeout=0.6)
t0 = time.time()
try:
    req(http, srv.url(), "GET"); ok = True
except Exception as error:
    ok = False; kind = type(error).__name__
elapsed = time.time() - t0
check("응답이 없으면(시간 초과) 오류를 올리고 다시 시도하지 않는다", ok is False and srv.conns == 1 and elapsed < 1.5, [srv.conns, round(elapsed, 2)])
srv.close()

# ===== 4. 주소를 못 찾는 경우(DNS)도 다시 시도 후 포기 =====
http = gc.ResilientHttp(timeout=5)
t0 = time.time()
try:
    req(http, "http://studyflow-no-such-host.invalid/x", "GET"); ok = True
except httplib2.ServerNotFoundError:
    ok = False
elapsed = time.time() - t0
check("주소를 못 찾으면 다시 시도해 보고 포기한다(ServerNotFoundError)", ok is False and elapsed >= 1.2, round(elapsed, 2))

# ===== 5. 서버가 보낸 오류 상태는 이 층에서 다시 시도하지 않는다 =====
for status in (403, 404, 500):
    srv = Server("ok", status=status)
    http = gc.ResilientHttp(timeout=5)
    r, _ = req(http, srv.url(), "GET")
    check(f"서버가 {status}을 응답하면 그대로 돌려주고 한 번만 보낸다", r.status == status and len(srv.requests) == 1)
    srv.close()

# ===== 6. 놀던 연결은 미리 새로 연다 =====
srv = Server("ok")
http = gc.ResilientHttp(timeout=5)
req(http, srv.url(), "GET"); req(http, srv.url(), "GET")
check("바로 이어서 보내는 요청은 같은 연결을 재사용한다(빠름 유지)", srv.conns == 1, srv.conns)
saved = gc.IDLE_RECONNECT_SECONDS
gc.IDLE_RECONNECT_SECONDS = 0.3
time.sleep(0.5)
req(http, srv.url(), "GET")
gc.IDLE_RECONNECT_SECONDS = saved
check("오래 논 뒤의 요청은 새 연결을 먼저 연다(끊긴 연결을 써 보지도 않는다)", srv.conns == 2, srv.conns)
srv.close()

# ===== 7. 오류 종류 판별 =====
check("연결 오류 판별: 연결 끊김/거부/SSL/HTTPException/주소 못 찾음은 true, 시간 초과/그 밖은 false",
      all(gc.is_connection_error(e) for e in (ConnectionResetError(), ConnectionAbortedError(), ConnectionRefusedError(), OSError(), __import__("ssl").SSLError(), __import__("http").client.RemoteDisconnected(), httplib2.ServerNotFoundError()))
      and not any(gc.is_connection_error(e) for e in (TimeoutError(), socket.timeout(), ValueError(), KeyError("x"), httplib2.RedirectLimit("x", {}, ""))))

# ===== 8. 실제 Google 라이브러리(googleapiclient)를 로컬 서버에 붙여서 끝까지 =====
events = {}
def calendar_handler(request):
    head, body = request
    line = head.split("\r\n")[0]
    m = re.match(r"(\w+) (\S+)", line)
    method, path = m.group(1), m.group(2).split("?")[0]
    if method == "POST" and path.endswith("/events"):
        data = json.loads(body)
        if data["id"] in events:
            return 409, json.dumps({"error": {"code": 409, "message": "The requested identifier already exists."}}).encode()
        events[data["id"]] = data
        return 200, json.dumps(data).encode()
    if method == "GET" and "/events/" in path:
        event_id = path.rsplit("/", 1)[1]
        return (200, json.dumps(events[event_id]).encode()) if event_id in events else (404, b'{"error": {"code": 404}}')
    if method == "DELETE" and "/events/" in path:
        event_id = path.rsplit("/", 1)[1]
        if event_id in events:
            del events[event_id]; return 204, b""
        return 410, b'{"error": {"code": 410, "message": "Resource has been deleted"}}'
    if method == "PATCH":
        return 200, b'{"id": "e1", "summary": "patched"}'
    return 200, b'{"items": []}'

srv = Server("rst_after_first", handler=calendar_handler)
service = gc.build_service(google.auth.credentials.AnonymousCredentials())
check("build_service는 ResilientHttp를 쓴다", isinstance(service._http.http, gc.ResilientHttp), type(service._http.http))
service._baseUrl = f"http://127.0.0.1:{srv.port}/calendar/v3/"
# 첫 요청은 정상, 그 뒤 연결이 끊긴 상태에서 일정 추가
service.events().list(calendarId="primary").execute()
time.sleep(0.6)
created = gc.create_event(service, "primary", "복붙한 일정", False, "2026-10-30T09:00", "2026-10-30T10:00", "메모")
check("끊긴 연결 뒤의 일정 추가가 성공한다 (예전에는 '인터넷 연결을 확인하세요')", created["summary"] == "복붙한 일정" and len(events) == 1, created)
check("일정 번호는 우리가 정해서 보낸다(영문 소문자/숫자 32글자)", re.fullmatch(r"[0-9a-f]{32}", created["id"]) is not None, created["id"])
time.sleep(0.6)
patched = gc.update_event(service, "primary", created["id"], title="수정")
check("끊긴 연결 뒤의 일정 수정이 성공한다", patched["summary"] == "patched")
srv.close()

# 첫 요청이 사실은 성공했는데 응답만 못 받아서 다시 보내게 된 경우: 중복 없이 성공 처리
events.clear()
seen = {"n": 0}
def lost_response_handler(request):
    head, body = request
    data = json.loads(body)
    seen["n"] += 1
    if seen["n"] == 1:
        events[data["id"]] = data      # Google은 일정을 만들었지만...
        raise ConnectionResetError()   # ...응답이 오기 전에 연결이 끊긴다 (아래 서버 코드가 연결을 닫는다)
    if data["id"] in events:
        return 409, b'{"error": {"code": 409, "message": "The requested identifier already exists."}}'
    return 200, body
class LostResponseServer(Server):
    def _handle(self, c, number):
        try:
            while True:
                req_ = self._read_request(c)
                if req_ is None:
                    return
                self.requests.append(req_)
                if req_[0].startswith("GET"):
                    # 이미 만들어진 일정을 번호로 가져오는 요청
                    event_id = req_[0].split("\r\n")[0].split()[1].split("?")[0].rsplit("/", 1)[1]
                    status, body = 200, json.dumps(events[event_id]).encode()
                else:
                    try:
                        status, body = lost_response_handler(req_)
                    except ConnectionResetError:
                        self._rst(c); return
                c.sendall(b"HTTP/1.1 %d X\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n" % (status, len(body)) + body)
        except OSError:
            pass
srv = LostResponseServer("ok")
service = gc.build_service(google.auth.credentials.AnonymousCredentials())
service._baseUrl = f"http://127.0.0.1:{srv.port}/calendar/v3/"
created = gc.create_event(service, "primary", "응답을 놓친 일정", False, "2026-10-30T09:00", "2026-10-30T10:00")
check("응답만 놓쳐 다시 보낸 경우: 일정이 두 개 만들어지지 않고(1개), 만들어진 일정을 돌려준다", len(events) == 1 and created["summary"] == "응답을 놓친 일정", [len(events), created])
srv.close()

# 일정 지우기: 이미 없는 일정(404/410)은 성공으로 본다
class FakeResource:
    def __init__(self, status): self.status = status
    def delete(self, **kwargs): return self
    def execute(self): raise HttpError(httplib2.Response({"status": self.status}), b"{}")
class FakeService:
    def __init__(self, status): self.status = status
    def events(self): return FakeResource(self.status)
for status in (404, 410):
    try:
        gc.delete_event(FakeService(status), "primary", "e"); ok = True
    except HttpError:
        ok = False
    check(f"이미 지워진 일정({status})을 다시 지우려 해도 오류가 아니다", ok)
try:
    gc.delete_event(FakeService(403), "primary", "e"); ok = False
except HttpError:
    ok = True
check("권한 오류(403)는 그대로 오류로 올린다", ok)

print("\n실패 %d개" % failed if failed else "\n모두 통과")
sys.exit(1 if failed else 0)
