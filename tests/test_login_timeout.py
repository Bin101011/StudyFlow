# 브라우저 로그인 창을 끝내지 않고 닫았을 때, StudyFlow가 영원히 기다리지 않는지 확인한다 (docs/review-2026-11.md의 H1).
# 예전에는 로그인 대기에 시간 제한이 없어서, Google에 가는 요청(캘린더 목록, 일정 불러오기, 새로고침)이 모두 멈추고 껐다 켜야만 풀렸다.
# 진짜 get_credentials와 진짜 로그인 대기(라이브러리가 띄우는 작은 로컬 서버)를 쓰되, 브라우저는 열지 않는다(여는 척만 하고 기록한다).
# 아무도 로그인하지 않으므로 "로그인 창을 그냥 닫은 것"과 같다.
import json
import os
import sys
import threading
import time
import webbrowser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_google  # noqa: E402  (import만 해도 DB와 설정 파일이 임시 폴더로 바뀐다)
import app  # noqa: E402
import event_cache  # noqa: E402
import google_calendar  # noqa: E402
import notes_store  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")

TMP = fake_google.TMP
# 진짜 credentials.json, token.json, events_cache.json, notes_backup을 건드리지 않도록 임시 위치로 바꾼다
google_calendar.CREDENTIALS_PATH = os.path.join(TMP, "credentials.json")
google_calendar.TOKEN_PATH = os.path.join(TMP, "token.json")
app.event_store = event_cache.EventCache(os.path.join(TMP, "events_cache.json"))
notes_store.BACKUP_DIR = os.path.join(TMP, "notes_backup")
# 시험에서는 로그인을 3분이 아니라 2초만 기다린다
google_calendar.LOGIN_TIMEOUT_SECONDS = 2

# 정상 모양의 credentials.json (데스크톱 앱 종류). 값은 가짜라서 진짜 Google에는 아무것도 가지 않는다
with open(google_calendar.CREDENTIALS_PATH, "w", encoding="utf-8") as f:
    json.dump({"installed": {
        "client_id": "test.apps.googleusercontent.com", "project_id": "test",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth", "token_uri": "https://oauth2.googleapis.com/token",
        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
        "client_secret": "test-secret", "redirect_uris": ["http://localhost"],
    }}, f)

# 브라우저를 여는 척만 하고, 몇 번 열려고 했는지 센다
opened = []


class FakeBrowser:
    def open(self, url, new=0, autoraise=True):
        opened.append(url)
        return True


webbrowser.get = lambda using=None: FakeBrowser()  # 로그인 라이브러리는 webbrowser.get(...).open(...)으로 브라우저를 연다
app.webbrowser.open = lambda *args, **kwargs: True  # 노트 링크 열기도 혹시 몰라 막아 둔다

client = app.app.test_client()
failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + (f"  [{detail}]" if detail and not condition else ""))
    if not condition:
        failures.append(name)


def error_of(response):
    return (response.get_json() or {}).get("error", "")


def request_in_thread(method, path, limit, **kwargs):
    """요청을 다른 스레드에서 보낸다. limit초 안에 끝나면 (응답, 걸린 초), 안 끝나면 (None, None)을 돌려준다.
    다른 스레드를 쓰는 이유: 예전 코드처럼 영원히 기다리면 시험 자체가 멈추기 때문이다."""
    box = {}

    def run():
        started = time.monotonic()
        box["response"] = getattr(client, method)(path, **kwargs)
        box["seconds"] = time.monotonic() - started

    worker = threading.Thread(target=run, daemon=True)
    worker.start()
    worker.join(limit)
    return box.get("response"), box.get("seconds")


def give_up(name):
    """요청이 끝나지 않으면 잠금이 계속 잡혀 있어서 뒤의 검사도 모두 멈춘다. 결과를 남기고 바로 끝낸다.
    (os._exit: 멈춘 스레드를 기다리지 않고 프로그램을 끝낸다)"""
    check(name, False, "끝나지 않았다: 로그인 대기에 제한이 없다")
    print(f"\n실패 {len(failures)}개")
    sys.stdout.flush()
    os._exit(1)


check("시험 전제: token.json이 없다 (처음 실행처럼 로그인이 필요하다)", not os.path.exists(google_calendar.TOKEN_PATH))

# ===== 1) 로그인 창을 열고 아무도 로그인하지 않는다 =====
box = {}
first = threading.Thread(target=lambda: box.update(response=client.get("/api/calendars"), done=time.monotonic()), daemon=True)
started = time.monotonic()
first.start()
time.sleep(0.8)
check("로그인 창(브라우저)을 한 번 열었다", len(opened) == 1, opened)

# 로그인을 기다리는 동안에도 Google과 상관없는 요청(내 DB, 설정)은 바로 처리된다
r, seconds = request_in_thread("get", "/api/projects", 5)
check("로그인을 기다리는 동안 프로젝트 목록은 바로 온다", r is not None and r.status_code == 200 and seconds < 2, seconds)
r, seconds = request_in_thread("get", "/api/settings", 5)
check("로그인을 기다리는 동안 설정도 바로 온다", r is not None and r.status_code == 200 and seconds < 2, seconds)

first.join(15)
if "response" not in box:
    give_up("캘린더 목록 요청이 로그인 제한 시간 뒤 끝난다 (15초 안)")
r = box["response"]
check("캘린더 목록 요청이 로그인 제한 시간 뒤 끝난다", box["done"] - started < 10, box["done"] - started)
check("캘린더 목록: 502", r.status_code == 502, r.status_code)
check("이유가 '로그인이 끝나지 않았다'는 안내다", "로그인" in error_of(r) and "새로고침" in error_of(r), error_of(r))
check("인터넷 탓이라고 하지 않는다", "인터넷" not in error_of(r), error_of(r))
check("로그인이 안 됐으니 token.json을 만들지 않는다", not os.path.exists(google_calendar.TOKEN_PATH))

# ===== 2) 그 뒤의 요청은 기다리지 않고 바로 안내한다. 브라우저 탭을 계속 새로 열지도 않는다 =====
r, seconds = request_in_thread("get", "/api/calendars", 5)
if r is None:
    give_up("다음 캘린더 목록 요청은 바로 끝난다")
check("다음 캘린더 목록 요청은 바로 끝난다", seconds < 1, seconds)
check("다음 요청도 같은 로그인 안내", r.status_code == 502 and "로그인" in error_of(r) and "인터넷" not in error_of(r), error_of(r))

r, seconds = request_in_thread("get", "/api/events?start=2026-11-01&end=2026-12-01", 5)
if r is None:
    give_up("일정 불러오기도 바로 끝난다")
check("일정 불러오기도 바로 끝난다", seconds < 1, seconds)
check("일정 불러오기도 로그인 안내", r.status_code == 502 and "로그인" in error_of(r) and "인터넷" not in error_of(r), error_of(r))

EVENT = {"calendarId": "me@test", "title": "시험", "allDay": True, "start": "2026-11-03", "end": "2026-11-04"}
r, seconds = request_in_thread("post", "/api/events", 5, json=EVENT)
if r is None:
    give_up("일정 추가도 바로 끝난다")
check("일정 추가도 바로 끝난다", seconds < 1, seconds)
check("일정 추가: 무엇을 못 했는지와 로그인 안내", r.status_code == 502 and "일정을 추가하지 못했습니다" in error_of(r)
      and "로그인" in error_of(r) and "인터넷" not in error_of(r), error_of(r))

done = threading.Event()
threading.Thread(target=lambda: (app.run_sync_cycle(), done.set()), daemon=True).start()
check("1분마다 도는 동기화도 바로 끝난다", done.wait(5))
check("그동안 로그인 창을 다시 열지 않았다 (탭이 계속 새로 생기지 않는다)", len(opened) == 1, len(opened))

# ===== 3) 새로고침 버튼을 누르면 로그인 창을 다시 연다 =====
r, seconds = request_in_thread("post", "/api/refresh", 15)
if r is None:
    give_up("새로고침이 로그인 제한 시간 뒤 끝난다")
check("새로고침을 누르면 로그인 창을 다시 연다", len(opened) == 2, len(opened))
check("새로고침도 로그인 제한 시간 뒤 끝난다", r.status_code == 200 and seconds < 10, f"{r.status_code} {seconds}")
r, seconds = request_in_thread("get", "/api/calendars", 5)
check("다시 안 끝내면 또 바로 안내하고 창은 그대로", r is not None and seconds < 1 and len(opened) == 2, f"{seconds} {len(opened)}")

# ===== 4) 로그인을 끝내면 정상으로 돌아온다 =====
from google_auth_oauthlib.flow import InstalledAppFlow  # noqa: E402


class FakeCreds:
    """로그인이 끝난 척하는 가짜. to_json은 token.json에 저장될 내용이다."""
    valid = True

    def to_json(self):
        return json.dumps({"fake": True})


login_calls = []
original_run_local_server = InstalledAppFlow.run_local_server
InstalledAppFlow.run_local_server = lambda self, **kwargs: (login_calls.append(kwargs), FakeCreds())[1]
try:
    google_calendar.allow_login_again()  # 새로고침 버튼이 하는 일
    creds = google_calendar.get_credentials()
finally:
    InstalledAppFlow.run_local_server = original_run_local_server
check("새로고침 뒤 로그인을 끝내면 로그인 정보를 돌려준다", isinstance(creds, FakeCreds))
check("로그인 대기에 시간 제한을 준다", login_calls and login_calls[0].get("timeout_seconds") == 2, login_calls)
check("로그인 결과를 token.json에 저장한다", os.path.exists(google_calendar.TOKEN_PATH))

print(f"\n실패 {len(failures)}개")
sys.exit(1 if failures else 0)
