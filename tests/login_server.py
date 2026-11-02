# 로그인 안내 화면 시험(login_test)용 서버 (docs/review-2026-11.md의 H1c).
# 사용자의 진짜 앱 확인과 같은 상황: 지난번 실행이 캘린더 목록과 일정을 저장해 두었고, token.json이 없어서 켜자마자 로그인 창이 열린다.
# 로그인 부분(get_credentials, 로그인 대기)은 진짜 코드를 쓰고, 일정·캘린더 내용은 가짜 Google이 맡는다. 브라우저는 여는 척만 한다.
# 시험이 /__test/cancel-login(로그인 화면에서 "취소"), /__test/login-succeed(다음 로그인은 성공)로 로그인 결과를 정한다.
import datetime
import json
import os
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_google  # noqa: E402  (불러오기만 해도 DB와 설정 파일이 임시 폴더로 바뀐다)
import google_calendar  # noqa: E402

real_get_credentials = google_calendar.get_credentials
fake = fake_google.install()
google_calendar.get_credentials = real_get_credentials  # 로그인 부분만 진짜로 되돌린다

import event_cache, app, database  # noqa: E402, E401
import google.oauth2.credentials  # noqa: E402
from flask import jsonify  # noqa: E402
from google_auth_oauthlib.flow import InstalledAppFlow  # noqa: E402

TMP = fake_google.TMP
google_calendar.CREDENTIALS_PATH = os.path.join(TMP, "credentials.json")
google_calendar.TOKEN_PATH = os.path.join(TMP, "token.json")
google_calendar.LOGIN_TIMEOUT_SECONDS = 60  # 시험이 cancel-login으로 직접 끝내므로 넉넉히
# 혹시 로그인 정보 갱신을 시도하더라도 진짜 Google이 아니라 아무도 없는 이 컴퓨터의 포트로 가게 한다 (실패할 뿐 밖으로 안 나간다)
google.oauth2.credentials._GOOGLE_OAUTH2_TOKEN_ENDPOINT = "http://127.0.0.1:9/token"
app.webbrowser.open = lambda *args, **kwargs: True
with open(google_calendar.CREDENTIALS_PATH, "w", encoding="utf-8") as f:
    json.dump({"installed": {
        "client_id": "test.apps.googleusercontent.com", "project_id": "test",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth", "token_uri": "https://oauth2.googleapis.com/token",
        "client_secret": "test-secret", "redirect_uris": ["http://localhost"],
    }}, f)
database.init_db()

# 지난번 실행이 남긴 캘린더 목록과 이번 달 일정 (진짜 앱의 events_cache.json에 해당)
today = datetime.date.today()
fake.add_event("me@test", "지난번에 받은 일정", today.isoformat(), (today + datetime.timedelta(days=1)).isoformat())
cache_path = os.path.join(TMP, "cache.json")
store = event_cache.EventCache(cache_path)
store.save_calendars(fake.get_calendars(None))
for calendar in fake.calendars:
    store.load_months(calendar["id"], [(today.year, today.month)], lambda: None)
store.mark_synced()
store.save(force=True)
app.event_store = event_cache.EventCache(cache_path)  # 앱을 다시 켠 것처럼 파일에서 읽는다

# 로그인한 뒤에만 보이는 캘린더. 로그인이 끝나면 화면이 캘린더 목록을 새로 받는지 확인하는 데 쓴다
fake.calendars.append({"id": "new@test", "summary": "로그인 뒤 캘린더", "backgroundColor": "#e8590c", "accessRole": "owner"})
fake.events["new@test"] = {}
fake.changelog["new@test"] = []

login = {"opened": 0, "cancel_url": None, "succeed": False}


class FakeBrowser:
    """로그인 주소를 받으면 연 척만 하고, 나중에 "취소"를 보낼 주소를 기억해 둔다."""
    def open(self, url, new=0, autoraise=True):
        login["opened"] += 1
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        # localhost 대신 127.0.0.1: 윈도우에서 localhost는 연결에 2초 넘게 걸릴 때가 있다
        redirect = query["redirect_uri"][0].replace("localhost", "127.0.0.1")
        login["cancel_url"] = redirect + "?" + urllib.parse.urlencode({"error": "access_denied", "state": query["state"][0]})
        return True


webbrowser.get = lambda using=None: FakeBrowser()


class FakeCreds:
    """로그인이 끝난 척하는 가짜. token.json에는 다시 읽어도 문제없는(만료 안 된) 모양으로 저장된다."""
    valid = True

    def to_json(self):
        return json.dumps({"token": "t", "refresh_token": "r", "client_id": "test.apps.googleusercontent.com", "client_secret": "s",
                           "scopes": google_calendar.SCOPES, "expiry": "2099-01-01T00:00:00Z"})


original_run_local_server = InstalledAppFlow.run_local_server


def run_local_server(self, **kwargs):
    if login["succeed"]:
        return FakeCreds()
    return original_run_local_server(self, **kwargs)  # 진짜 로그인 대기 (시험이 cancel-login을 보낼 때까지)


InstalledAppFlow.run_local_server = run_local_server


@app.app.route("/__test/login")
def __login():
    return jsonify({"opened": login["opened"]})


@app.app.route("/__test/cancel-login")
def __cancel_login():
    url = login["cancel_url"]
    login["cancel_url"] = None
    if url:
        threading.Thread(target=lambda: urllib.request.urlopen(url, timeout=10).read(), daemon=True).start()
    return jsonify({"sent": bool(url)})


@app.app.route("/__test/login-succeed")
def __login_succeed():
    login["succeed"] = True
    return jsonify({"ok": True})


# main.py처럼 뒤쪽 일(미리 연결 = 켜자마자 로그인 시작, 자동 동기화)도 시작한다
app.start_background_tasks()
app.app.run(port=5057, threaded=True)
