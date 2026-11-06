"""설정 저장이 원래 설정을 덮어쓰지 않는지 (docs/review-2026-11.md의 M1, L2).

- 일부 값만 보내면 그 값만 바뀌고 나머지(vault 경로, 숨긴 캘린더, 만든 캘린더 등)는 그대로인지
- 빈 값·이상한 값을 보내면 거절하거나 원래 값을 지키는지
- settings.json을 읽지 못하면(다른 프로그램이 잠금) 기본값을 주는 대신 알리고, 저장도 거부하는지
- settings.json이 깨졌으면 옛 파일을 옆에 남겨 두고 알리는지
- 캘린더를 만들면 서버가 "StudyFlow가 만든 캘린더" 표시를 직접 기록하는지
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_google  # noqa: E402  (불러오기만 해도 DB와 설정 파일이 임시 폴더로 바뀐다)

fake = fake_google.install()
import app  # noqa: E402
import event_cache  # noqa: E402
import settings_store  # noqa: E402

app.event_store = event_cache.EventCache(os.path.join(fake_google.TMP, "cache.json"))
client = app.app.test_client()
failures = []
SETTINGS = settings_store.SETTINGS_PATH
FOLDER = os.path.dirname(SETTINGS)


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + (f"  [{detail}]" if detail and not condition else ""))
    if not condition:
        failures.append(name)


def file_text():
    """settings.json의 지금 내용(글자 그대로). 없으면 None"""
    try:
        with open(SETTINGS, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return None


def file_values():
    return json.loads(file_text())


def summary():
    """실패했을 때 보여 줄 짧은 요약 (파일 전체는 너무 길다)"""
    try:
        values = file_values()
    except (TypeError, ValueError):
        return repr(file_text())[:200]
    return str({k: values.get(k) for k in KEPT + ["fontSize", "pomodoroPosition"]})


def broken_files():
    """깨진 설정 파일을 옮겨 둔 사본들의 {이름: 내용}"""
    result = {}
    for name in os.listdir(FOLDER):
        if name.startswith("settings.broken-"):
            with open(os.path.join(FOLDER, name), "r", encoding="utf-8", errors="replace") as f:
                result[name] = f.read()
    return result


# settings.json을 다른 프로그램이 잡고 있는 상황을 흉내 낸다: settings_store 안의 open만 바꿔 끼운다
real_open = open


def locked_open(path, *args, **kwargs):
    if os.path.abspath(str(path)) == os.path.abspath(SETTINGS):
        raise PermissionError(13, "시험: 다른 프로그램이 사용 중", str(path))
    return real_open(path, *args, **kwargs)


def lock_settings(on):
    if on:
        settings_store.open = locked_open
    elif "open" in vars(settings_store):
        del settings_store.open


# 내가 정해 둔 설정 (진짜 앱에서 오래 쓴 settings.json과 비슷하게)
MINE = {
    "fontSize": 15, "monthRows": 7, "vaultPath": "C:\\시험\\vault", "lastNote": "공부/영어.md",
    "hiddenCalendarIds": ["holiday@test"], "createdCalendarIds": ["made-old@test"], "defaultCalendarId": "proj@test",
    "pomodoroPosition": {"x": 40, "y": 50},
}
KEPT = ["vaultPath", "lastNote", "hiddenCalendarIds", "createdCalendarIds", "defaultCalendarId", "monthRows"]


def kept(values, skip=()):
    """MINE에서 정한 값들이 values에 그대로 있는가"""
    return all(values.get(k) == MINE[k] for k in KEPT if k not in skip)


# ===== 처음 실행 (파일 없음) =====
r = client.get("/api/settings")
check("파일이 없으면 기본값(200), 안내 없음", r.status_code == 200 and r.get_json()["values"] == settings_store.default_settings() and "warning" not in r.get_json(), r.get_json())

# ===== 전체 저장 =====
r = client.put("/api/settings", json={**settings_store.default_settings(), **MINE})
check("전체를 보내면 그대로 저장(200)", r.status_code == 200 and kept(r.get_json()) and kept(file_values()), r.get_json())

# ===== 일부만 보내기 =====
r = client.put("/api/settings", json={})
check("빈 객체 {}를 보내도 원래 설정이 그대로(200)", r.status_code == 200 and kept(file_values()) and file_values()["fontSize"] == 15, summary())

r = client.put("/api/settings", json={"fontSize": 14})
check("글자 크기만 보내면 글자 크기만 바뀜", r.status_code == 200 and file_values()["fontSize"] == 14 and kept(file_values()), summary())
check("돌려주는 값은 저장된 설정 전체", r.get_json() == file_values(), r.get_json())

r = client.put("/api/settings", json={"fontSize": "abc", "vaultPath": 5, "monthRows": 9, "hiddenCalendarIds": "x"})
check("틀린 값은 기본값이 아니라 원래 값을 지킴", r.status_code == 200 and file_values()["fontSize"] == 14 and kept(file_values()), summary())

r = client.put("/api/settings", json={"fontSize": 99})
check("범위 밖 숫자는 예전처럼 끝값으로", file_values()["fontSize"] == 20, summary())
client.put("/api/settings", json={"fontSize": 14})

r = client.put("/api/settings", json={"zzz": 1, "fontSize": 14})
check("모르는 이름은 저장하지 않음", "zzz" not in file_values(), summary())

r = client.put("/api/settings", json={"pomodoroPosition": None})
check("타이머 위치 null은 '원래 자리로'(지워짐)", r.status_code == 200 and file_values()["pomodoroPosition"] is None and kept(file_values()), summary())
client.put("/api/settings", json={"pomodoroPosition": {"x": 40, "y": 50}})
check("타이머 위치 저장", file_values()["pomodoroPosition"] == {"x": 40, "y": 50})

r = client.put("/api/settings", json={"hiddenCalendarIds": [], "vaultPath": "", "defaultCalendarId": ""})
check("빈 목록·빈 글자도 정상 값으로 저장됨(숨김 해제, vault 지우기)", file_values()["hiddenCalendarIds"] == [] and file_values()["vaultPath"] == "" and file_values()["defaultCalendarId"] == "", summary())
client.put("/api/settings", json=MINE)
check("다시 원래대로", kept(file_values()), summary())

# ===== 객체가 아닌 값 =====
before = file_text()
for body in ["null", "[1, 2]", "123", '"x"']:
    r = client.put("/api/settings", data=body, content_type="application/json")
    check(f"객체가 아닌 {body}는 400이고 파일 그대로", r.status_code == 400 and file_text() == before, f"{r.status_code} {summary()}")
r = client.put("/api/settings", data="이건 JSON이 아님", content_type="application/json")
check("JSON이 아니면 400이고 파일 그대로", r.status_code == 400 and file_text() == before, f"{r.status_code}")
r = client.put("/api/settings", data='{"fontSize": 12}', content_type="text/plain")
check("JSON 형식 표시가 없으면 저장하지 않음", r.status_code >= 400 and file_text() == before, f"{r.status_code}")

# ===== settings.json을 읽지 못할 때 (잠김) =====
before = file_text()
lock_settings(True)
r = client.get("/api/settings")
check("못 읽으면 기본값(200)을 주지 않고 오류(503)와 이유", r.status_code == 503 and "settings.json" in (r.get_json() or {}).get("error", ""), f"{r.status_code} {r.get_json()}")
r = client.put("/api/settings", json={"monthRows": 6})
check("못 읽는 동안 저장은 거부(503)", r.status_code == 503 and "error" in (r.get_json() or {}), f"{r.status_code} {r.get_json()}")
r = client.get("/api/notes")
check("그동안 노트 목록 요청도 멈추지 않고 대답(200)", r.status_code == 200, f"{r.status_code}")
lock_settings(False)
check("잠김이 풀린 뒤 파일은 그대로", file_text() == before, summary())
r = client.get("/api/settings")
check("잠김이 풀리면 원래 설정을 줌", r.status_code == 200 and kept(r.get_json()["values"]), r.get_json())

# 잠긴 채 화면이 설정 하나를 바꾸면(옛 화면은 기본값 전체를 보냈다) → 거부, 풀린 뒤 그대로
lock_settings(True)
r = client.put("/api/settings", json={**settings_store.default_settings(), "monthRows": 6})
lock_settings(False)
check("잠긴 동안 기본값 전체를 보내도 덮어쓰지 않음", r.status_code == 503 and file_text() == before, f"{r.status_code}")

# ===== settings.json이 깨졌을 때 =====
for label, broken in [("깨진 JSON", '{"fontSize": 15, "vaultPath": "C:\\\\시험'), ("빈 파일(정전 등)", "")]:
    old_copies = set(broken_files())
    with open(SETTINGS, "w", encoding="utf-8") as f:
        f.write(broken)
    r = client.get("/api/settings")
    body = r.get_json() or {}
    check(f"{label}: 기본값으로 시작(200)", r.status_code == 200 and body.get("values") == settings_store.default_settings(), f"{r.status_code} {body}")
    check(f"{label}: 화면에 보일 안내(warning)가 있음", "깨져" in body.get("warning", ""), body)
    new_copies = {k: v for k, v in broken_files().items() if k not in old_copies}
    check(f"{label}: 옛 파일을 settings.broken-…json으로 남겨 둠(내용 그대로)", list(new_copies.values()) == [broken] and any(n in body.get("warning", "") for n in new_copies), f"{new_copies} {body.get('warning')}")
    r = client.get("/api/settings")
    check(f"{label}: 안내는 한 번만", r.status_code == 200 and "warning" not in r.get_json(), r.get_json())
    r = client.put("/api/settings", json={"fontSize": 13})
    check(f"{label}: 그 뒤 저장은 정상", r.status_code == 200 and file_values()["fontSize"] == 13, f"{r.status_code} {summary()}")
    check(f"{label}: 남겨 둔 사본은 저장해도 그대로", {k: v for k, v in broken_files().items() if k in new_copies} == new_copies)

# ===== 캘린더를 만들면 서버가 표시를 기록 (L2) =====
client.put("/api/settings", json=MINE)
r = client.post("/api/calendars", json={"name": "기록 시험"})
new_id = (r.get_json() or {}).get("id")
check("캘린더 만들기 201", r.status_code == 201, f"{r.status_code} {r.get_json()}")
check("화면이 설정을 저장하지 않아도 서버가 만든 캘린더를 기록함", new_id in file_values()["createdCalendarIds"], summary())
check("기록할 때 다른 설정은 그대로(원래 만든 캘린더도)", kept(file_values(), skip=["createdCalendarIds"]) and "made-old@test" in file_values()["createdCalendarIds"], summary())
r = client.get("/api/settings")
check("다음 설정 읽기에도 기록이 보임", new_id in r.get_json()["values"]["createdCalendarIds"])

# 화면이 기록 전의 목록(옛 화면 사본에 새 id를 더한 것)을 보내도 그대로
client.put("/api/settings", json={"createdCalendarIds": MINE["createdCalendarIds"] + [new_id]})
check("화면이 같은 id를 더해 보내도 한 번만", file_values()["createdCalendarIds"].count(new_id) == 1, summary())

before = file_text()
lock_settings(True)
r = client.post("/api/calendars", json={"name": "잠김 중 만들기"})
lock_settings(False)
check("설정 파일이 잠겨 있어도 캘린더는 만들어짐(201)", r.status_code == 201, f"{r.status_code} {r.get_json()}")
check("그때 설정 파일은 그대로(덮어쓰지 않음)", file_text() == before, summary())

# ----- 오늘 탭 너비: 범위와 합계 한계 -----
def widths(body):
    """설정을 보내고 저장된 (시간표 너비, 오른쪽 칸 너비)를 돌려준다."""
    saved = client.put("/api/settings", json=body).get_json()
    return saved["timelineWidth"], saved["todayRightWidth"]


data = client.get("/api/settings").get_json()
today_sliders = {d["key"]: d for d in data["todaySliders"]}
check("시간표 너비 범위는 300~500, 기본 400", (today_sliders["timelineWidth"]["min"], today_sliders["timelineWidth"]["max"], today_sliders["timelineWidth"]["default"]) == (300, 500, 400))
check("오른쪽 칸 범위는 300~450, 기본 300", (today_sliders["todayRightWidth"]["min"], today_sliders["todayRightWidth"]["max"], today_sliders["todayRightWidth"]["default"]) == (300, 450, 300))
check("화면에 합계 한계 850을 알려 준다", data["todayWidthsMax"] == 850)
check("범위 밖 값은 끝값으로", widths({"timelineWidth": 100, "todayRightWidth": 100}) == (300, 300))
check("합이 850이면 그대로", widths({"timelineWidth": 400, "todayRightWidth": 450}) == (400, 450))
check("오른쪽이 450일 때 시간표만 500을 보내면 시간표가 400으로", widths({"timelineWidth": 500}) == (400, 450))
widths({"timelineWidth": 500, "todayRightWidth": 300})
check("시간표가 500일 때 오른쪽만 450을 보내면 오른쪽이 350으로", widths({"todayRightWidth": 450}) == (500, 350))
check("둘 다 넘게 보내면 시간표를 줄인다", widths({"timelineWidth": 500, "todayRightWidth": 450}) == (400, 450))
widths({"timelineWidth": 380, "todayRightWidth": 300})
check("다른 설정만 바꿔도 너비는 그대로", widths({"fontSize": 15}) == (380, 300))
with open(SETTINGS, "w", encoding="utf-8") as f:
    json.dump({"timelineWidth": 550, "todayRightWidth": 450}, f)
values = client.get("/api/settings").get_json()["values"]
check("파일의 옛 값(550)이나 넘는 합도 읽을 때 맞춘다", (values["timelineWidth"], values["todayRightWidth"]) == (400, 450), values)

print("\n실패 없음" if not failures else f"\n실패 {len(failures)}개: {failures}")
sys.exit(1 if failures else 0)
