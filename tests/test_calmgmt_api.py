import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_google

fake = fake_google.install()
import app  # noqa: E402
import google_calendar  # noqa: E402
import settings_store  # noqa: E402

client = app.app.test_client()
failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + (f"  [{detail}]" if detail and not condition else ""))
    if not condition:
        failures.append(name)


def names():
    return [c["name"] for c in client.get("/api/calendars").get_json()]


# ===== 권한 =====
check("앱이 요청하는 권한에 calendar.app.created가 들어 있음", "https://www.googleapis.com/auth/calendar.app.created" in google_calendar.SCOPES)
check("기존 권한(일정, 캘린더 목록)도 그대로", all(x in google_calendar.SCOPES for x in ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.calendarlist"]))

# ===== 목록에 owner =====
before = client.get("/api/calendars").get_json()
check("목록에 owner가 있음(소유한 캘린더 true, 공휴일 false)", {c["name"]: c["owner"] for c in before} == {"개인": True, "프로젝트": True, "공휴일": False}, str(before))

# ===== 만들기 =====
r = client.post("/api/calendars", json={"name": "  스터디 모임  ", "color": "#AB12CD"})
check("만들기 201", r.status_code == 201, f"{r.status_code} {r.get_json()}")
created = r.get_json()
check("돌려주는 값에 id와 이름(앞뒤 공백 제거)", created["name"] == "스터디 모임" and created["id"].startswith("made"), str(created))
check("목록에 새 캘린더가 바로 나옴(기억해 둔 목록을 새로 받음)", "스터디 모임" in names(), str(names()))
mine = [c for c in client.get("/api/calendars").get_json() if c["name"] == "스터디 모임"][0]
check("고른 색이 소문자 #rrggbb로 적용됨", mine["color"] == "#ab12cd", mine["color"])
check("소유한 캘린더이고 일정을 쓸 수 있음", mine["owner"] and mine["canEdit"] and not mine["primary"])
check("시간대는 내 기본 캘린더(Asia/Seoul)와 같게 보냄", fake.last_time_zone == "Asia/Seoul", str(fake.last_time_zone))

check("이름이 비면 400", client.post("/api/calendars", json={"name": "   "}).status_code == 400)
check("이름이 없어도 400", client.post("/api/calendars", json={}).status_code == 400)
check("100글자 넘으면 400", client.post("/api/calendars", json={"name": "가" * 101}).status_code == 400)
check("이상한 색은 400", client.post("/api/calendars", json={"name": "색", "color": "red"}).status_code == 400)
check("색은 없어도 만들어짐", client.post("/api/calendars", json={"name": "색 없음"}).status_code == 201)
check("실패한 요청은 캘린더를 만들지 않음", fake.calls.get("create_calendar") == 2, str(fake.calls.get("create_calendar")))

# ===== 새 캘린더에 일정 =====
r = client.post("/api/events", json={"calendarId": created["id"], "title": "첫 모임", "allDay": True, "start": "2026-11-03", "end": "2026-11-04"})
check("새 캘린더에 일정을 만들 수 있음", r.status_code in (200, 201), f"{r.status_code} {r.get_json()}")

# ===== 지우기 =====
r = client.delete("/api/calendars", query_string={"calendarId": created["id"], "mode": "delete"})
check("StudyFlow가 만든 캘린더는 완전히 지워짐(200)", r.status_code == 200, f"{r.status_code} {r.get_json()}")
check("목록에서 사라짐", "스터디 모임" not in names(), str(names()))
check("지운 캘린더의 일정은 일정 목록에 안 나옴", all(e["calendarId"] != created["id"] for e in client.get("/api/events", query_string={"start": "2026-11-01", "end": "2026-12-01"}).get_json()))
check("이미 지운 캘린더를 또 지우면 404", client.delete("/api/calendars", query_string={"calendarId": created["id"], "mode": "delete"}).status_code == 404)

# ===== 거절되는 경우 =====
r = client.delete("/api/calendars", query_string={"calendarId": "me@test", "mode": "delete"})
check("내 기본 캘린더는 지울 수 없음(400)", r.status_code == 400 and "기본" in r.get_json()["error"], str(r.get_json()))
r = client.delete("/api/calendars", query_string={"calendarId": "me@test", "mode": "unsubscribe"})
check("기본 캘린더는 목록에서도 뺄 수 없음(400)", r.status_code == 400)
check("공휴일(소유 아님)은 완전히 지울 수 없음(400)", client.delete("/api/calendars", query_string={"calendarId": "holiday@test", "mode": "delete"}).status_code == 400)
r = client.delete("/api/calendars", query_string={"calendarId": "proj@test", "mode": "delete"})
check("내가 소유했지만 StudyFlow가 만들지 않은 캘린더는 Google이 거절 → 안내(502)와 목록 그대로", r.status_code == 502 and "StudyFlow가 만든" in r.get_json()["error"] and "프로젝트" in names(), f"{r.status_code} {r.get_json()}")
check("mode가 이상하면 400", client.delete("/api/calendars", query_string={"calendarId": "proj@test", "mode": "x"}).status_code == 400)
check("calendarId가 없으면 400", client.delete("/api/calendars", query_string={"mode": "delete"}).status_code == 400)
check("없는 캘린더는 404", client.delete("/api/calendars", query_string={"calendarId": "nope@test", "mode": "delete"}).status_code == 404)

# ===== 목록에서 빼기 =====
r = client.delete("/api/calendars", query_string={"calendarId": "holiday@test", "mode": "unsubscribe"})
check("공휴일은 목록에서 뺄 수 있음(200)", r.status_code == 200, str(r.get_json()))
check("빠진 뒤 목록에 없음", "공휴일" not in names())
r = client.delete("/api/calendars", query_string={"calendarId": "proj@test", "mode": "unsubscribe"})
check("StudyFlow가 안 만든 내 캘린더도 목록에서는 뺄 수 있음", r.status_code == 200 and "프로젝트" not in names(), str(names()))

# ===== 인터넷이 끊겼을 때 =====
fake.offline = True
r = client.post("/api/calendars", json={"name": "오프라인"})
check("인터넷이 끊기면 만들기는 502와 안내", r.status_code == 502 and "인터넷" in r.get_json()["error"], f"{r.status_code} {r.get_json()}")
fake.offline = False

# ===== 설정: 만든 캘린더 기록 =====
s = settings_store.clean_settings({"createdCalendarIds": ["a@test", "b@test", 5, "", None]})
check("설정에 만든 캘린더 id 목록이 저장됨(글자만)", s["createdCalendarIds"] == ["a@test", "b@test"], str(s["createdCalendarIds"]))
check("기본값은 빈 목록", settings_store.default_settings()["createdCalendarIds"] == [])
check("리스트가 아니면 무시", settings_store.clean_settings({"createdCalendarIds": "x"})["createdCalendarIds"] == [])
check("너무 많으면 200개까지만", len(settings_store.clean_settings({"createdCalendarIds": [str(i) + "a" for i in range(500)]})["createdCalendarIds"]) == 200)

print("\n실패 없음" if not failures else f"\n실패 {len(failures)}개: {failures}")
sys.exit(1 if failures else 0)
