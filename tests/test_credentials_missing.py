# credentials.json이 없거나 깨졌을 때, 화면에 "인터넷 연결을 확인하세요"가 아니라 진짜 이유가 보이는지 확인한다.
# (처음 설치한 친구가 가장 먼저 만나는 문제다.) 진짜 get_credentials를 쓰므로 fake_google.install()은 부르지 않는다.
# 브라우저는 열지 않는다: 파일이 없거나 깨진 경우는 로그인 창을 열기 전에 끝나고, 정상 파일 시험은 로그인 창 부분을 가짜로 바꿔 끼운다.
import json
import os
import sys

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
app.event_store = event_cache.EventCache(os.path.join(TMP, "events_cache.json"))

client = app.app.test_client()
failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + (f"  [{detail}]" if detail and not condition else ""))
    if not condition:
        failures.append(name)


def error_of(response):
    return (response.get_json() or {}).get("error", "")


EVENT = {"calendarId": "me@test", "title": "시험", "allDay": True, "start": "2026-11-03", "end": "2026-11-04"}
RANGE = {"start": "2026-11-01", "end": "2026-12-01"}


def reset_connection():
    """앞 시험이 남긴 캘린더 목록 기억을 지워서, 다음 시험이 처음부터 다시 시도하게 한다.
    (작업자별 Google 연결은 만드는 데 실패하면 저장되지 않으므로 따로 지울 것이 없다)"""
    app._calendar_cache["data"] = None
    app._calendar_cache["time"] = 0


# ===== 파일이 없을 때 =====
check("시험 전제: credentials.json도 token.json도 없다", not os.path.exists(CREDENTIALS) and not os.path.exists(TOKEN))
try:
    google_calendar.get_credentials()
    check("get_credentials가 CredentialsProblem을 던진다", False, "오류 없이 끝났다")
except google_calendar.CredentialsProblem as problem:
    message = str(problem)
    check("get_credentials가 CredentialsProblem을 던진다", True)
    check("안내에 파일 이름과 README가 들어 있다", "credentials.json" in message and "README" in message, message)
    check("안내가 credentials.json.json 함정(확장자 숨김)을 알려 준다", "credentials.json.json" in message, message)
    check("인터넷 탓이라고 하지 않는다", "인터넷" not in message, message)
except Exception as error:  # 예전 동작: FileNotFoundError
    check("get_credentials가 CredentialsProblem을 던진다", False, repr(error))
check("실패해도 token.json을 만들지 않는다", not os.path.exists(TOKEN))

reset_connection()
r = client.get("/api/calendars")
check("캘린더 목록: 502", r.status_code == 502, r.status_code)
check("캘린더 목록: 이유가 credentials.json 안내다", "credentials.json" in error_of(r) and "인터넷 연결" not in error_of(r), error_of(r))

reset_connection()
r = client.get("/api/events", query_string=RANGE)
check("일정 불러오기: 502", r.status_code == 502, r.status_code)
check("일정 불러오기: 이유가 credentials.json 안내다", "credentials.json" in error_of(r) and "인터넷 연결" not in error_of(r), error_of(r))

reset_connection()
r = client.post("/api/events", json=EVENT)
check("일정 추가: 502", r.status_code == 502, r.status_code)
check("일정 추가: 무엇을 못 했는지와 이유가 함께 나온다",
      "일정을 추가하지 못했습니다" in error_of(r) and "credentials.json" in error_of(r) and "인터넷 연결" not in error_of(r), error_of(r))

reset_connection()
r = client.delete("/api/calendars", query_string={"calendarId": "me@test", "mode": "delete"})
check("캘린더 지우기: 502와 credentials.json 안내", r.status_code == 502 and "credentials.json" in error_of(r), f"{r.status_code} {error_of(r)}")

reset_connection()
r = client.patch("/api/events/abc123", json={"calendarId": "me@test", "title": "x", "destinationCalendarId": "other@test"})
check("일정 옮기기(캘린더 목록 단계): 502와 credentials.json 안내", r.status_code == 502 and "credentials.json" in error_of(r), f"{r.status_code} {error_of(r)}")

# ===== 파일이 깨졌을 때 =====
with open(CREDENTIALS, "w", encoding="utf-8") as f:
    f.write('{"installed": {"client_id": ')  # 중간에 잘린 JSON
try:
    google_calendar.get_credentials()
    check("잘린 파일: CredentialsProblem", False, "오류 없이 끝났다")
except google_calendar.CredentialsProblem as problem:
    check("잘린 파일: CredentialsProblem", True)
    check("잘린 파일: '읽을 수 없습니다' 안내", "읽을 수 없습니다" in str(problem) and "데스크톱 앱" in str(problem), str(problem))
except Exception as error:
    check("잘린 파일: CredentialsProblem", False, repr(error))

with open(CREDENTIALS, "w", encoding="utf-8") as f:
    json.dump({"type": "service_account", "project_id": "x"}, f)  # 다른 종류의 JSON (서비스 계정 키)
try:
    google_calendar.get_credentials()
    check("다른 종류의 JSON: CredentialsProblem", False, "오류 없이 끝났다")
except google_calendar.CredentialsProblem:
    check("다른 종류의 JSON: CredentialsProblem", True)
except Exception as error:
    check("다른 종류의 JSON: CredentialsProblem", False, repr(error))

reset_connection()
r = client.get("/api/calendars")
check("깨진 파일일 때도 화면에는 파일 안내가 간다", r.status_code == 502 and "credentials.json" in error_of(r) and "인터넷 연결" not in error_of(r), error_of(r))

# ===== 정상 파일은 그대로 로그인 단계로 간다 (고친 코드가 정상 경로를 막지 않는지) =====
with open(CREDENTIALS, "w", encoding="utf-8") as f:
    json.dump({"installed": {
        "client_id": "test.apps.googleusercontent.com", "project_id": "test",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth", "token_uri": "https://oauth2.googleapis.com/token",
        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
        "client_secret": "test-secret", "redirect_uris": ["http://localhost"],
    }}, f)


class FakeCreds:
    """로그인이 끝난 척하는 가짜. to_json은 token.json에 저장될 내용이다."""
    def to_json(self):
        return json.dumps({"fake": True})


login_calls = []
original_run_local_server = InstalledAppFlow.run_local_server
InstalledAppFlow.run_local_server = lambda self, **kwargs: (login_calls.append(kwargs), FakeCreds())[1]  # 브라우저를 열지 않는다
try:
    creds = google_calendar.get_credentials()
finally:
    InstalledAppFlow.run_local_server = original_run_local_server
check("정상 파일: 로그인 단계(브라우저 열기)까지 간다", len(login_calls) == 1, login_calls)
check("정상 파일: 로그인 결과를 token.json에 저장한다", os.path.exists(TOKEN) and json.load(open(TOKEN, encoding="utf-8")) == {"fake": True})

# ===== 그 밖의 오류는 지금처럼 인터넷 안내 =====
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
