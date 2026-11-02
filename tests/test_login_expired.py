# 켜 둔 앱에서 Google 로그인이 만료됐을 때(테스트 상태 앱은 7일마다) 화면이 "로그인 필요"를 알려 주는지 확인한다 (docs/review-2026-11.md의 H2, H1c, M4).
# 예전에는 갱신 거절(RefreshError)이 "오프라인"과 "인터넷 연결을 확인하세요"로 잘못 보였고, 다시 로그인하는 곳이 없어 껐다 켜야 풀렸다.
# 진짜 로그인 코드(get_credentials, 로그인 정보를 붙이는 통로)를 쓰고, Google 대신 이 컴퓨터 안(127.0.0.1)에 띄운 작은 가짜 서버에 묻는다.
# 그 서버가 "입장권 거절(401)"과 "재발급 열쇠 만료(invalid_grant)"를 흉내 낸다. 진짜 Google에는 아무것도 가지 않는다.
import contextlib
import datetime
import http.server
import io
import json
import os
import sys
import threading
import time
import webbrowser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_google  # noqa: E402  (import만 해도 DB와 설정 파일이 임시 폴더로 바뀐다)
import google_calendar  # noqa: E402

real_get_credentials = google_calendar.get_credentials
real_build_service = google_calendar.build_service
fake = fake_google.install()  # 일정·캘린더 내용은 가짜 Google이 맡는다
# 로그인 부분만 진짜로 되돌린다
google_calendar.get_credentials = real_get_credentials
google_calendar.build_service = real_build_service

import app  # noqa: E402
import event_cache  # noqa: E402
import notes_store  # noqa: E402
from google_auth_oauthlib.flow import InstalledAppFlow  # noqa: E402
from googleapiclient.errors import HttpError  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")

TMP = fake_google.TMP
google_calendar.CREDENTIALS_PATH = os.path.join(TMP, "credentials.json")
google_calendar.TOKEN_PATH = os.path.join(TMP, "token.json")
app.event_store = event_cache.EventCache(os.path.join(TMP, "events_cache.json"))
notes_store.BACKUP_DIR = os.path.join(TMP, "notes_backup")
app.webbrowser.open = lambda *args, **kwargs: True
google_calendar.LOGIN_TIMEOUT_SECONDS = 3  # 시험에서는 로그인을 3분이 아니라 3초만 기다린다

# ===== Google 대신 대답하는 작은 서버 =====
fake_server = {"accepted": {"first"}, "token_dead": False}  # 받아 주는 입장권들, 재발급 열쇠가 죽었는가


class FakeGoogleServer(http.server.BaseHTTPRequestHandler):
    def do_POST(self):  # 입장권 재발급 (token_uri)
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if fake_server["token_dead"]:
            self.reply(400, {"error": "invalid_grant", "error_description": "Token has been expired or revoked."})
        else:
            self.reply(200, {"access_token": "renewed", "expires_in": 3600, "token_type": "Bearer"})

    def do_GET(self):  # 캘린더 API 대신. 받아 주는 입장권이 아니면 401
        token = self.headers.get("Authorization", "").replace("Bearer ", "")
        self.reply(200 if token in fake_server["accepted"] else 401, {})

    def reply(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeGoogleServer)
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{server.server_port}"
TOKEN_URI = BASE + "/token"

# 로그인 라이브러리는 token.json을 읽을 때 재발급 주소를 파일 내용과 상관없이 진짜 Google 주소로 정한다("always overrides").
# 그 기본 주소를 위의 작은 서버로 바꿔 둔다
import google.oauth2.credentials  # noqa: E402
google.oauth2.credentials._GOOGLE_OAUTH2_TOKEN_ENDPOINT = TOKEN_URI

# 안전장치: 이 컴퓨터(127.0.0.1) 밖으로 나가려는 요청은 보내지 않고 막은 뒤, 시험 실패로 기록한다
import httplib2  # noqa: E402
outside_requests = []
original_http_request = httplib2.Http.request


def local_only_request(self, uri, *args, **kwargs):
    if not uri.startswith("http://127.0.0.1:"):
        outside_requests.append(uri)
        raise ConnectionRefusedError("시험에서는 이 컴퓨터 밖으로 요청을 보내지 않는다: " + uri)
    return original_http_request(self, uri, *args, **kwargs)


httplib2.Http.request = local_only_request


def through_login(function):
    """가짜 Google 함수 앞에서, 그 연결(service)의 로그인 정보로 작은 서버에 한 번 묻는다.
    진짜처럼 입장권이 거절되면 갱신을 시도하고, 갱신도 거절되면 RefreshError가 난다."""
    def wrapped(service, *args, **kwargs):
        response, _ = service._http.request(BASE + "/calendar")
        if response.status != 200:
            raise HttpError(response, b"rejected")
        return function(service, *args, **kwargs)
    return wrapped


for name in ("get_calendars", "get_events", "list_changes", "create_event"):
    setattr(google_calendar, name, through_login(getattr(google_calendar, name)))


def write_token(token, refresh_token, expiry):
    with open(google_calendar.TOKEN_PATH, "w", encoding="utf-8") as f:
        json.dump({"token": token, "refresh_token": refresh_token, "token_uri": TOKEN_URI, "client_id": "c.apps.googleusercontent.com",
                   "client_secret": "s", "scopes": google_calendar.SCOPES, "expiry": expiry}, f)


with open(google_calendar.CREDENTIALS_PATH, "w", encoding="utf-8") as f:
    json.dump({"installed": {
        "client_id": "c.apps.googleusercontent.com", "project_id": "test",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth", "token_uri": TOKEN_URI,
        "client_secret": "s", "redirect_uris": ["http://localhost"],
    }}, f)
write_token("first", "r1", "2099-01-01T00:00:00Z")

# 브라우저를 여는 척만 하고, 몇 번 열려고 했는지 센다
opened = []


class FakeBrowser:
    def open(self, url, new=0, autoraise=True):
        opened.append(url)
        return True


webbrowser.get = lambda using=None: FakeBrowser()

client = app.app.test_client()
failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + (f"  [{detail}]" if detail and not condition else ""))
    if not condition:
        failures.append(name)


def error_of(response):
    return (response.get_json() or {}).get("error", "")


def status():
    return client.get("/api/sync-status").get_json()


# ===== 1) 평소: 로그인 정보가 살아 있다 =====
app.warm_up()  # 진짜 앱처럼 켤 때 작업자 8명의 Google 연결을 미리 만들어 둔다 (이 연결들이 옛 로그인 정보를 계속 쥐고 있게 된다)
r = client.get("/api/calendars")
check("평소: 캘린더 목록 200", r.status_code == 200, r.status_code)
app.run_sync_cycle()
s = status()
check("평소: 연결됨, 로그인 안내 없음", s["online"] and not s.get("login") and s["lastSync"], s)
synced_before = s["lastSync"]

# ===== 2) 7일 뒤: 재발급 열쇠가 만료됐다 (Google이 옛 입장권을 거절하고, 갱신도 거절한다) =====
fake_server["accepted"] = set()
fake_server["token_dead"] = True
write_token("first", "r1", "2000-01-01T00:00:00Z")  # 저장된 입장권도 그동안 시간이 지나 만료됐다

app.run_sync_cycle()  # 1분마다 도는 동기화가 먼저 알아챈다
s = status()
check("만료: 동기화 상태가 '로그인 필요'다", s.get("login") == "needed", s)
check("만료: 안내 문장이 로그인 만료와 새로고침 버튼을 알려 준다",
      "만료" in (s.get("loginMessage") or "") and "새로고침" in (s.get("loginMessage") or ""), s.get("loginMessage"))

started = time.monotonic()
r = client.get("/api/events?start=2027-03-01&end=2027-04-01")  # 기억해 둔 일정이 없는 달
check("만료: 일정 불러오기는 502", r.status_code == 502, r.status_code)
check("만료: 일정 불러오기는 로그인 창을 기다리지 않고 바로 끝난다", time.monotonic() - started < 2, f"{time.monotonic() - started:.1f}초")
check("만료: 일정 불러오기 오류가 로그인 안내다", "로그인" in error_of(r) and "인터넷" not in error_of(r), error_of(r))

r = client.post("/api/events", json={"calendarId": "me@test", "title": "시험", "allDay": True, "start": "2027-03-03", "end": "2027-03-04"})
check("만료: 일정 추가 오류가 무엇을 못 했는지 + 로그인 안내다",
      r.status_code == 502 and "일정을 추가하지 못했습니다" in error_of(r) and "로그인" in error_of(r) and "인터넷" not in error_of(r), error_of(r))

app._calendar_cache["time"] = 0  # 10분이 지나 캘린더 목록도 새로 받으려 한다
started = time.monotonic()
r = client.get("/api/calendars")
check("만료: 캘린더 목록은 지난번 것으로 바로 보여 준다", r.status_code == 200 and len(r.get_json()) == 3 and time.monotonic() - started < 2,
      f"{r.status_code} {time.monotonic() - started:.1f}초")
check("만료: 사용자가 새로고침을 누르기 전에는 로그인 탭을 저절로 열지 않는다", len(opened) == 0, len(opened))

# ===== 3) 새로고침을 누르고 로그인 창을 그냥 닫는다 (H1c) =====
box = {}
refresher = threading.Thread(target=lambda: box.update(response=client.post("/api/refresh")), daemon=True)
refresher.start()
time.sleep(1)
s = status()
check("로그인 중: 새로고침을 누르면 로그인 창을 연다", len(opened) == 1, len(opened))
check("로그인 중: 동기화 상태가 '로그인 기다리는 중'이다", s.get("login") == "waiting", s)
refresher.join(15)
r = box.get("response")
check("로그인 창을 닫음: 새로고침이 끝난다", r is not None and r.status_code == 200, r and r.status_code)
s = r.get_json() if r is not None else {}
check("로그인 창을 닫음: 새로고침 결과가 '로그인 필요'다", s.get("login") == "needed", s)
check("로그인 창을 닫음: 안내는 '로그인이 끝나지 않았다'다", "끝나지 않았습니다" in (s.get("loginMessage") or ""), s.get("loginMessage"))
s = status()
check("로그인 창을 닫음: 그 뒤 동기화 상태도 '로그인 필요'다 (오프라인만 보이지 않는다)", s.get("login") == "needed", s)

# ===== 4) 다시 새로고침을 누르고 이번에는 로그인을 끝낸다 =====
new_creds = google_calendar.Credentials(
    token="second", refresh_token="r2", token_uri=TOKEN_URI, client_id="c.apps.googleusercontent.com", client_secret="s",
    scopes=google_calendar.SCOPES, expiry=datetime.datetime(2099, 1, 1))
fake_server["accepted"] = {"second"}  # 새 로그인으로 받은 입장권만 받아 준다 (옛 입장권 "first"는 계속 거절)
original_run_local_server = InstalledAppFlow.run_local_server
InstalledAppFlow.run_local_server = lambda self, **kwargs: new_creds
try:
    r = client.post("/api/refresh")
finally:
    InstalledAppFlow.run_local_server = original_run_local_server
s = r.get_json()
check("다시 로그인: 새로고침 결과가 연결됨, 로그인 안내 없음", r.status_code == 200 and s["online"] and not s.get("login"), s)
check("다시 로그인: 동기화가 다시 성공한다 (옛 로그인 정보로 만든 연결을 새로 만든다)", (s.get("lastSync") or 0) > synced_before, s)
app.run_sync_cycle()
s = status()
check("다시 로그인: 그다음 동기화도 연결됨", s["online"] and not s.get("login"), s)
r = client.get("/api/events?start=2027-05-01&end=2027-06-01")
check("다시 로그인: 일정 불러오기 200", r.status_code == 200, f"{r.status_code} {error_of(r)}")

# ===== 5) M4: 인터넷 문제가 아닌 오류는 "오프라인"으로 숨기지 않고 로그에 남긴다 =====
calendar = {"id": "me@test", "summary": "개인"}
original_check = app.event_store.check_calendar


def buggy_check(calendar_id, get_service):
    raise ValueError("시험용 프로그램 오류")


def offline_check(calendar_id, get_service):
    raise fake_google.OfflineError("network down")


app.event_store.check_calendar = buggy_check
log = io.StringIO()
with contextlib.redirect_stdout(log):
    first = app.check_one(calendar)
    second = app.check_one(calendar)
check("M4: 프로그램 오류는 '오프라인'이 아니다", first == "error", first)
check("M4: 프로그램 오류가 로그에 남는다 (오류 종류와 내용)", "ValueError" in log.getvalue() and "시험용 프로그램 오류" in log.getvalue(), log.getvalue()[:300])
check("M4: 같은 오류는 1분마다 쌓이지 않게 한 번만 남는다", log.getvalue().count("[예상 밖 오류]") == 1 and second == "error", log.getvalue()[:300])
app.event_store.check_calendar = offline_check
check("M4: 인터넷 문제는 예전처럼 '오프라인'", app.check_one(calendar) == "offline")
app.event_store.check_calendar = original_check

original_load = app.event_store.load_months
app.event_store.load_months = lambda calendar_id, months, get_service: (_ for _ in ()).throw(ValueError("미리 받기 버그"))
log = io.StringIO()
with contextlib.redirect_stdout(log):
    app.prefetch_one("me@test", [(2027, 7)])
check("M4: 미리 받기의 프로그램 오류도 로그에 남는다", "미리 받기 버그" in log.getvalue(), log.getvalue()[:300])
app.event_store.load_months = lambda calendar_id, months, get_service: (_ for _ in ()).throw(fake_google.OfflineError("down"))
log = io.StringIO()
with contextlib.redirect_stdout(log):
    app.prefetch_one("me@test", [(2027, 7)])
check("M4: 미리 받기의 인터넷 문제는 조용히 넘어간다", log.getvalue() == "", log.getvalue()[:300])
app.event_store.load_months = original_load

# 1분마다 도는 반복이 예상 못 한 오류 한 번에 멈추지 않는다 (멈추면 동기화와 하루 한 번 DB 백업이 조용히 끊긴다)
calls = []


def flaky_cycle():
    calls.append(1)
    if len(calls) == 1:
        raise ValueError("반복 중 오류")
    if len(calls) >= 3:
        raise SystemExit  # 시험이 끝나면 반복 스레드를 끝낸다 (except Exception으로는 잡히지 않는다)


app.run_sync_cycle = flaky_cycle
app.prefetch_around_today = lambda: None
app.SYNC_INTERVAL_SECONDS = 0.05
log = io.StringIO()
with contextlib.redirect_stdout(log), contextlib.redirect_stderr(io.StringIO()):
    loop = threading.Thread(target=app.sync_loop, daemon=True)
    loop.start()
    loop.join(3)
check("M4: 반복 중 오류가 나도 동기화 반복이 계속된다", len(calls) >= 3, len(calls))
check("M4: 반복 중 오류가 로그에 남는다", "반복 중 오류" in log.getvalue(), log.getvalue()[:300])

check("시험 전체: 이 컴퓨터 밖(진짜 Google)으로 나가려는 요청이 없었다", not outside_requests, outside_requests[:3])
server.shutdown()
print(f"\n실패 {len(failures)}개")
sys.exit(1 if failures else 0)
