# 설정 탭의 Google 연결(연결하기 / 앱 신분증 고르기 / 연결 끊기)과, 연결하지 않고 쓸 때의 동작을 확인한다.
# 예전 test_credentials_missing.py(credentials.json이 없거나 깨졌을 때의 안내)를 넓힌 것이다.
# 진짜 get_credentials를 쓰므로 fake_google.install()은 부르지 않는다. 브라우저와 Google에는 아무것도 보내지 않는다:
# 로그인 창 부분(run_local_server)은 가짜로 바꿔 끼우고, 연결 뒤 캘린더를 받는 부분(warm_up)도 로그인만 하게 바꾼다.
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_google  # noqa: E402  (import만 해도 DB와 설정 파일이 임시 폴더로 바뀐다)
import app  # noqa: E402
import event_cache  # noqa: E402
import google_calendar  # noqa: E402
from google_auth_oauthlib.flow import InstalledAppFlow  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")

TMP = fake_google.TMP
CREDENTIALS = os.path.join(TMP, "credentials.json")
TOKEN = os.path.join(TMP, "token.json")
# 진짜 credentials.json, token.json, events_cache.json을 건드리지 않도록 임시 위치로 바꾼다
google_calendar.CREDENTIALS_PATH = CREDENTIALS
google_calendar.TOKEN_PATH = TOKEN
CACHE = os.path.join(TMP, "events_cache.json")
app.event_store = event_cache.EventCache(CACHE)

client = app.app.test_client()
failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + (f"  [{detail}]" if detail and not condition else ""))
    if not condition:
        failures.append(name)


def error_of(response):
    return (response.get_json() or {}).get("error", "")


def reset_connection():
    """앞 시험이 남긴 캘린더 목록 기억을 지워서, 다음 시험이 처음부터 다시 시도하게 한다."""
    app._calendar_cache["data"] = None
    app._calendar_cache["time"] = 0


# 브라우저 로그인을 여는 척만 하고 몇 번 열었는지 센다
login_calls = []


class FakeCreds:
    """로그인이 끝난 척하는 가짜. to_json은 token.json에 저장될 내용이다."""
    valid = True

    def to_json(self):
        return json.dumps({"fake": True})


InstalledAppFlow.run_local_server = lambda self, **kwargs: (login_calls.append(kwargs), FakeCreds())[1]

EVENT = {"calendarId": "me@test", "title": "시험", "allDay": True, "start": "2026-11-03", "end": "2026-11-04"}
RANGE = {"start": "2026-11-01", "end": "2026-12-01"}
GOOD_CLIENT = {"installed": {
    "client_id": "test.apps.googleusercontent.com", "project_id": "test",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth", "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_secret": "test-secret", "redirect_uris": ["http://localhost"],
}}

# ===== 1) 아무것도 없을 때: Google 없이 쓰는 중. 오류가 아니고, 로그인 창을 저절로 열지 않는다 =====
check("시험 전제: credentials.json도 token.json도 없다", not os.path.exists(CREDENTIALS) and not os.path.exists(TOKEN))
try:
    google_calendar.get_credentials()
    check("get_credentials가 NotConnected를 던진다", False, "오류 없이 끝났다")
except google_calendar.NotConnected as problem:
    check("get_credentials가 NotConnected를 던진다", True)
    check("안내가 설정 탭을 가리킨다", "설정 탭" in str(problem) and "인터넷" not in str(problem), str(problem))
except Exception as error:
    check("get_credentials가 NotConnected를 던진다", False, repr(error))
check("로그인 창을 열지 않았다", login_calls == [], login_calls)

status = client.get("/api/google/status").get_json()
check("상태: 연결 안 됨, 앱 신분증 없음", status["state"] == "disconnected" and status["clientSource"] is None and status["account"] is None, status)
check("동기화 표시: disconnected (오프라인 아님)", client.get("/api/sync-status").get_json()["login"] == "disconnected")

reset_connection()
r = client.get("/api/calendars")
check("캘린더 목록: 200, 빈 목록 (화면이 연결 안내를 띄운다)", r.status_code == 200 and r.get_json() == [], f"{r.status_code} {r.get_json()}")
reset_connection()
r = client.get("/api/events", query_string=RANGE)
check("일정 불러오기: 200, 빈 목록 (할 일만 보이는 달력)", r.status_code == 200 and r.get_json() == [], f"{r.status_code} {r.get_json()}")
reset_connection()
r = client.post("/api/events", json=EVENT)
check("일정 추가: 502, 무엇을 못 했는지와 연결 안내", r.status_code == 502 and "일정을 추가하지 못했습니다" in error_of(r)
      and "연결되어 있지 않습니다" in error_of(r) and "인터넷" not in error_of(r), error_of(r))
reset_connection()
app.run_sync_cycle()
check("1분 동기화: 오프라인으로 표시하지 않는다", app.event_store.online)
reset_connection()
r = client.post("/api/refresh")
check("새로고침: 로그인 창을 열지 않는다 (연결은 설정 탭에서만)", r.status_code == 200 and login_calls == [], login_calls)

r = client.post("/api/google/connect")
check("앱 신분증 없이 연결하기: 400, 파일을 고르라는 안내", r.status_code == 400 and "credentials.json" in error_of(r) and "설정 탭" in error_of(r), error_of(r))
check("그때도 로그인 창을 열지 않았다", login_calls == [], login_calls)

# ===== 2) 앱 신분증 파일 고르기: 모양을 확인하고 저장한다 =====
bad_files = [
    ("JSON이 아닌 파일", "hello", "JSON 파일이 아닙니다"),
    ("웹 애플리케이션 유형", json.dumps({"web": {"client_id": "x", "client_secret": "y"}}), "데스크톱 앱"),
    ("서비스 계정 키", json.dumps({"type": "service_account", "project_id": "x"}), "서비스 계정"),
    ("client_secret 없음", json.dumps({"installed": {"client_id": "x"}}), "client_secret"),
    ("리스트 JSON", "[1, 2]", "모양이 아닙니다"),
]
for name, content, expected in bad_files:
    r = client.post("/api/google/client-file", json={"content": content})
    check(f"잘못된 파일 거절: {name}", r.status_code == 400 and expected in error_of(r), f"{r.status_code} {error_of(r)}")
check("잘못된 파일은 저장하지 않는다", not os.path.exists(CREDENTIALS))
r = client.post("/api/google/client-file", json={"content": ""})
check("빈 내용 거절", r.status_code == 400)
r = client.post("/api/google/client-file", json={"content": "x" * 30000})
check("너무 큰 파일 거절", r.status_code == 400 and "너무 큽니다" in error_of(r), error_of(r))
r = client.post("/api/google/client-file", json="문자열")
check("JSON 객체가 아니면 거절", r.status_code == 400)

r = client.post("/api/google/client-file", json={"content": json.dumps(GOOD_CLIENT)})
check("정상 파일: 200, 앱 신분증 있음(내가 고른 파일)", r.status_code == 200 and r.get_json()["clientSource"] == "file", r.get_json())
check("정상 파일: 데이터 폴더에 저장한다", json.load(open(CREDENTIALS, encoding="utf-8")) == GOOD_CLIENT)
check("파일만 골라서는 로그인 창을 열지 않는다", login_calls == [], login_calls)

# ===== 3) 깨진 파일이 데이터 폴더에 있을 때 [연결하기]: 읽을 수 없다는 안내 =====
with open(CREDENTIALS, "w", encoding="utf-8") as f:
    f.write('{"installed": {"client_id": ')  # 중간에 잘린 JSON
google_calendar.request_login()
try:
    google_calendar.get_credentials()
    check("잘린 파일: CredentialsProblem", False, "오류 없이 끝났다")
except google_calendar.CredentialsProblem as problem:
    check("잘린 파일: '읽을 수 없습니다'와 데스크톱 앱 안내", "읽을 수 없습니다" in str(problem) and "데스크톱 앱" in str(problem), str(problem))
check("잘린 파일: 로그인 창을 열지 않았다", login_calls == [], login_calls)
check("한 번 실패하면 다시 [연결하기]를 누를 때까지 로그인을 시도하지 않는다", google_calendar._login_requested is False)
client.post("/api/google/client-file", json={"content": json.dumps(GOOD_CLIENT)})

# ===== 4) [연결하기]: 뒤에서 로그인 → 연결됨 =====
# 연결 뒤에는 캘린더 목록을 받고 작업자 연결을 준비하는데(warm_up), 가짜 로그인 정보로 진짜 Google에 묻지 않도록 로그인만 하게 바꾼다
app.warm_up = lambda: app.get_creds()
app.prefetch_around_today = lambda: None
r = client.post("/api/google/connect")
check("연결하기: 200 (로그인은 뒤에서 한다)", r.status_code == 200, f"{r.status_code} {error_of(r)}")
deadline = time.monotonic() + 5
while not os.path.exists(TOKEN) and time.monotonic() < deadline:
    time.sleep(0.05)
check("연결하기: 로그인 창을 한 번 열었다", len(login_calls) == 1, login_calls)
check("연결하기: 로그인 결과를 token.json에 저장한다", os.path.exists(TOKEN))
time.sleep(0.1)
status = client.get("/api/google/status").get_json()
check("상태: 연결됨", status["state"] == "connected", status)
check("동기화 표시도 로그인 문제 없음", client.get("/api/sync-status").get_json()["login"] is None)

# 연결된 계정 표시: 기본 캘린더의 id(=Gmail 주소)
app._calendar_cache["data"] = [{"id": "me@gmail.test", "summary": "나", "primary": True}, {"id": "x@test", "summary": "다른"}]
check("상태: 연결된 계정을 보여 준다", client.get("/api/google/status").get_json()["account"] == "me@gmail.test")

# ===== 5) 연결했었는데 다시 로그인해야 할 때: 저절로 열지 않고 "로그인 필요" =====
with open(TOKEN, "w", encoding="utf-8") as f:
    json.dump({"token": "a", "refresh_token": "b", "client_id": "c", "client_secret": "d",
               "scopes": google_calendar.SCOPES[:1]}, f)  # 권한이 모자란 옛 로그인 (새 기능 때문에 권한이 늘었다)
reset_connection()
login_calls.clear()
try:
    google_calendar.get_credentials()
    check("옛 로그인: CredentialsProblem", False, "오류 없이 끝났다")
except google_calendar.NotConnected:
    check("옛 로그인: '연결 안 됨'이 아니라 '로그인 필요'다", False)
except google_calendar.CredentialsProblem as problem:
    check("옛 로그인: 로그인 만료 안내", "만료" in str(problem), str(problem))
check("옛 로그인: 로그인 창을 저절로 열지 않는다", login_calls == [], login_calls)
check("상태: 다시 로그인 필요", client.get("/api/google/status").get_json()["state"] == "needed")
r = client.get("/api/calendars")
check("로그인 필요일 때 캘린더 목록은 502와 로그인 안내 (빈 목록으로 숨기지 않는다)", r.status_code == 502 and "로그인" in error_of(r), error_of(r))
r = client.post("/api/google/connect")  # 설정 탭의 [다시 로그인]
deadline = time.monotonic() + 5
while len(login_calls) == 0 and time.monotonic() < deadline:
    time.sleep(0.05)
time.sleep(0.1)
check("[다시 로그인]: 로그인 창을 연다", r.status_code == 200 and len(login_calls) == 1, login_calls)
check("[다시 로그인] 뒤 연결됨", client.get("/api/google/status").get_json()["state"] == "connected")

# ===== 6) 연결 끊기: token.json과 기억해 둔 일정을 지운다. Google에는 아무것도 보내지 않는다(가짜 token.json에는 열쇠가 없다) =====
app.event_store.save_calendars([{"id": "me@gmail.test", "summary": "나", "primary": True}])
app.event_store.mark_synced()
app.event_store.save(force=True)
check("시험 전제: 기억해 둔 일정 파일이 있다", os.path.exists(CACHE))
version_before = app.event_store.status()["version"]
r = client.post("/api/google/disconnect")
body = r.get_json()
check("연결 끊기: 200, 연결 안 됨", r.status_code == 200 and body["state"] == "disconnected", body)
check("연결 끊기: token.json을 지운다", not os.path.exists(TOKEN))
check("연결 끊기: 기억해 둔 일정 파일을 지운다", not os.path.exists(CACHE))
check("연결 끊기: 기억해 둔 캘린더 목록도 비운다", app.event_store.saved_calendars() is None and app._calendar_cache["data"] is None)
check("연결 끊기: 화면이 일정을 다시 불러오게 번호를 올린다", app.event_store.status()["version"] == version_before + 1)
check("연결 끊기: 앱 신분증은 남긴다 (다시 연결할 때 또 고르지 않게)", os.path.exists(CREDENTIALS))
reset_connection()
r = client.get("/api/events", query_string=RANGE)
check("끊은 뒤 일정: 빈 목록 (옛 계정의 일정이 남아 보이지 않는다)", r.status_code == 200 and r.get_json() == [], r.get_json())
login_calls.clear()
client.get("/api/calendars")
app.run_sync_cycle()
check("끊은 뒤에도 로그인 창을 저절로 열지 않는다", login_calls == [], login_calls)

# ===== 7) 로그인을 기다리는 중에는 연결하기/끊기를 또 받지 않는다 =====
google_calendar._login_state = "waiting"
r = client.post("/api/google/connect")
check("기다리는 중 연결하기: 409", r.status_code == 409, r.status_code)
r = client.post("/api/google/disconnect")
check("기다리는 중 끊기: 409", r.status_code == 409, r.status_code)
google_calendar._login_state = None

# ===== 8) 그 밖의 오류는 지금처럼 인터넷 안내 =====
def raise_offline():
    raise OSError("네트워크에 연결할 수 없음")


google_calendar.get_credentials = raise_offline
reset_connection()
r = client.get("/api/calendars")
check("인터넷 오류는 예전처럼 '인터넷 연결을 확인하세요'", r.status_code == 502 and "인터넷 연결을 확인하세요" in error_of(r), error_of(r))
reset_connection()
r = client.post("/api/events", json=EVENT)
check("일정 추가도 인터넷 오류는 예전처럼", r.status_code == 502 and "(인터넷 연결을 확인하세요.)" in error_of(r), error_of(r))

print(f"\n실패 {len(failures)}개")
sys.exit(1 if failures else 0)
