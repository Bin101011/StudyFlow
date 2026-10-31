import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_google

fake = fake_google.install()
import app  # noqa: E402

client = app.app.test_client()
failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + (f"  [{detail}]" if detail and not condition else ""))
    if not condition:
        failures.append(name)


def events(calendar_ids=None):
    r = client.get("/api/events", query_string={"start": "2026-11-01", "end": "2026-12-01"})
    return [e for e in r.get_json() if calendar_ids is None or e["calendarId"] in calendar_ids]


def patch(event_id, body):
    return client.patch("/api/events/" + event_id, json=body)


base = {"allDay": False, "start": "2026-11-10T09:00", "end": "2026-11-10T10:00"}
eid = fake.add_event("me@test", "원래 일정", "2026-11-10T09:00:00+09:00", "2026-11-10T10:00:00+09:00")
check("(전제) 개인 캘린더에 일정이 있음", any(e["id"] == eid and e["calendarId"] == "me@test" for e in events()))

# ===== 옮기지 않고 수정(예전 동작) =====
r = patch(eid, {"calendarId": "me@test", "title": "제목만 수정", **base})
check("목적지 없이 수정하면 예전처럼 동작(옮기지 않음)", r.status_code == 200 and fake.calls.get("move_event", 0) == 0, str(r.get_json()))
r = patch(eid, {"calendarId": "me@test", "destinationCalendarId": "me@test", "title": "같은 캘린더", **base})
check("목적지가 지금 캘린더와 같으면 옮기지 않음", r.status_code == 200 and fake.calls.get("move_event", 0) == 0)

# ===== 옮기기 =====
r = patch(eid, {"calendarId": "me@test", "destinationCalendarId": "proj@test", "title": "옮긴 일정", "allDay": False, "start": "2026-11-11T14:00", "end": "2026-11-11T15:30"})
check("수정하면서 다른 캘린더로 옮기면 200", r.status_code == 200, str(r.get_json()))
check("옮기기 요청이 한 번 가고", fake.calls.get("move_event") == 1)
moved = [e for e in events() if e["id"] == eid]
check("일정 목록에서 새 캘린더(proj)에 있음", len(moved) == 1 and moved[0]["calendarId"] == "proj@test", str(moved))
check("제목과 시간도 새 값으로 바뀜", moved and moved[0]["title"] == "옮긴 일정" and moved[0]["start"].startswith("2026-11-11T14:00"), str(moved))
check("원래 캘린더(개인)에는 더 이상 없음", not [e for e in events(["me@test"]) if e["id"] == eid])
check("새 캘린더의 색으로 보임(일정 색 = 캘린더 색)", moved and moved[0]["color"] == "#2f9e44", str(moved and moved[0].get("color")))

# ===== 거절: 쓸 수 없는 캘린더, 없는 캘린더 =====
before = fake.calls.get("move_event", 0)
r = patch(eid, {"calendarId": "proj@test", "destinationCalendarId": "holiday@test", "title": "공휴일로", **base})
check("읽기 전용 캘린더(공휴일)로는 옮길 수 없음(400)이고 내용도 안 고침", r.status_code == 400 and [e for e in events() if e["id"] == eid][0]["title"] == "옮긴 일정", str(r.get_json()))
r = patch(eid, {"calendarId": "proj@test", "destinationCalendarId": "nope@test", "title": "없는 곳", **base})
check("없는 캘린더로는 옮길 수 없음(400)", r.status_code == 400)
check("거절된 요청은 Google로 가지 않음", fake.calls.get("move_event", 0) == before)

# ===== 옮기기만 실패 =====
fake.move_fail = True
r = patch(eid, {"calendarId": "proj@test", "destinationCalendarId": "me@test", "title": "저장은 됨", **base})
check("옮기기가 거절되면 502와 '내용은 저장했지만' 안내", r.status_code == 502 and "저장했지만" in r.get_json()["error"], f"{r.status_code} {r.get_json()}")
after = [e for e in events() if e["id"] == eid][0]
check("그때 내용(제목)은 저장되어 있고 원래 캘린더에 그대로 있음", after["title"] == "저장은 됨" and after["calendarId"] == "proj@test", str(after))
fake.move_fail = False

# ===== 다시 개인으로 =====
r = patch(eid, {"calendarId": "proj@test", "destinationCalendarId": "me@test", "title": "돌아옴", **base})
check("다시 원래 캘린더로도 옮길 수 있음", r.status_code == 200 and [e for e in events() if e["id"] == eid][0]["calendarId"] == "me@test")

# ===== 인터넷이 끊기면 =====
fake.offline = True
r = patch(eid, {"calendarId": "me@test", "destinationCalendarId": "proj@test", "title": "오프라인", **base})
check("인터넷이 끊기면 502", r.status_code == 502, f"{r.status_code} {r.get_json()}")
fake.offline = False

print("\n실패 없음" if not failures else f"\n실패 {len(failures)}개: {failures}")
sys.exit(1 if failures else 0)
