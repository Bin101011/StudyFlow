# 설정 저장 화면 시험(settings_test)용 서버 (docs/review-2026-11.md의 M1, L2). 가짜 Google + 임시 DB + 임시 settings.json.
# 진짜 앱에서 일어날 수 있는 상황을 스위치로 만든다:
#   /__test/settings-lock/1   settings.json을 다른 프로그램이 잡고 있음(읽기·쓰기 실패). 0이면 풀림
#   /__test/settings-put-fail/1   화면의 설정 저장(PUT /api/settings)이 실패함. 0이면 정상
#   /__test/settings-file     지금 settings.json의 글자 그대로 (없으면 null)
#   /__test/settings-write    (POST) settings.json에 받은 글자를 그대로 씀 (깨진 파일 만들기)
#   /__test/settings-broken   서버가 옮겨 둔 깨진 파일 사본들 {이름: 내용}
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_google  # noqa: E402  (불러오기만 해도 DB와 설정 파일이 임시 폴더로 바뀐다)

fake = fake_google.install()
import event_cache, app, database, settings_store  # noqa: E402, E401
from flask import jsonify, request  # noqa: E402

app.event_store = event_cache.EventCache(os.path.join(fake_google.TMP, "cache.json"))
app.webbrowser.open = lambda *args, **kwargs: True
database.init_db()

SETTINGS = settings_store.SETTINGS_PATH
FOLDER = os.path.dirname(SETTINGS)
state = {"locked": False, "put_fail": False}

# 오래 써 온 settings.json처럼 미리 채워 둔다 (vault 경로, 숨긴 캘린더, 만든 캘린더, 마지막 노트 등)
with open(SETTINGS, "w", encoding="utf-8") as f:
    json.dump({**settings_store.default_settings(), "fontSize": 15, "vaultPath": "C:\\시험\\vault", "lastNote": "공부/영어.md",
               "hiddenCalendarIds": ["holiday@test"], "createdCalendarIds": ["made-old@test"], "defaultCalendarId": "proj@test"},
              f, ensure_ascii=False, indent=2)

real_open = open


def test_open(path, *args, **kwargs):
    """settings_store 안의 open만 바꿔 끼운다. 잠김 스위치가 켜져 있으면 settings.json을 열 때 실패한다"""
    if state["locked"] and os.path.abspath(str(path)) == os.path.abspath(SETTINGS):
        raise PermissionError(13, "시험: 다른 프로그램이 settings.json을 쓰는 중", str(path))
    return real_open(path, *args, **kwargs)


settings_store.open = test_open


@app.app.before_request
def __fail_settings_put():
    if state["put_fail"] and request.method == "PUT" and request.path == "/api/settings":
        return jsonify({"error": "시험: 저장 실패"}), 500
    return None


@app.app.route("/__test/settings-lock/<int:value>")
def __lock(value):
    state["locked"] = bool(value)
    return jsonify(state)


@app.app.route("/__test/settings-put-fail/<int:value>")
def __put_fail(value):
    state["put_fail"] = bool(value)
    return jsonify(state)


@app.app.route("/__test/settings-file")
def __settings_file():
    try:
        with real_open(SETTINGS, "r", encoding="utf-8") as f:
            return jsonify({"text": f.read()})
    except FileNotFoundError:
        return jsonify({"text": None})


@app.app.route("/__test/settings-write", methods=["POST"])
def __settings_write():
    with real_open(SETTINGS, "w", encoding="utf-8") as f:
        f.write(request.get_data(as_text=True))
    return jsonify({"ok": True})


@app.app.route("/__test/settings-broken")
def __settings_broken():
    result = {}
    for name in os.listdir(FOLDER):
        if name.startswith("settings.broken-"):
            with real_open(os.path.join(FOLDER, name), "r", encoding="utf-8", errors="replace") as f:
                result[name] = f.read()
    return jsonify(result)


app.app.run(port=5057, threaded=True)
