"""일정을 추가한 뒤 Google에 다시 묻지 않고 바로 보이는지 (docs/review-2026-11.md의 N26).

예전에는 일정을 추가하면 그 캘린더의 기억을 "오래됨"으로 만들어서, 화면이 다시 불러올 때 그 캘린더를 Google에서 다시 받았다.
진짜 앱에서 재 보니 추가 한 번에 2.1~2.6초였고, 그 절반(약 1초)이 이 "다시 받기"였다.
이제는 Google이 돌려준 새 일정을 기억에 바로 넣는다. 이 시험은 그때 틀린 일정이 보이지 않는지도 확인한다:
다른 곳(폰)에서 같이 바뀐 것, 아직 받아 두지 않은 달, 추가하는 사이에 끝난 옛 다시 받기."""
import os
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_google

fake = fake_google.install()

import google_calendar  # noqa: E402
import event_cache  # noqa: E402
import app  # noqa: E402

app.event_store = event_cache.EventCache(os.path.join(fake_google.TMP, "events_cache.json"))
client = app.app.test_client()

failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + (f"  [{detail}]" if detail and not condition else ""))
    if not condition:
        failures.append(name)


def drain():
    time.sleep(0.4)  # 뒤에서 하는 일(미리 받기, 책갈피 옮기기)이 끝나길 기다린다


def get_events(start, end):
    response = client.get(f"/api/events?start={start}T00:00:00%2B09:00&end={end}T00:00:00%2B09:00")
    return response.status_code, response.get_json()


def add(title, start, end, all_day=False, calendar_id="me@test", description=None):
    body = {"calendarId": calendar_id, "title": title, "allDay": all_day, "start": start, "end": end}
    if description:
        body["description"] = description
    return client.post("/api/events", json=body)


def titles(events):
    return sorted(event["title"] for event in events)


# 준비: 10월·11월 일정을 받아 두고(화면이 달력을 연 상태), 확인(동기화)을 한 번 끝낸 상태
fake.add_event("me@test", "원래 일정", "2026-10-19T09:00:00+09:00", "2026-10-19T10:00:00+09:00")
fake.add_event("proj@test", "프로젝트 일정", "2026-10-20T09:00:00+09:00", "2026-10-20T10:00:00+09:00")
app.run_sync_cycle()
get_events("2026-09-27", "2026-11-08")  # 화면의 10월 달력: 9·10·11월
drain()
app.run_sync_cycle()
v0 = client.get("/api/sync-status").get_json()["version"]

# --- 1. 추가 직후 다시 불러오면 Google에 묻지 않고 새 일정이 보인다
response = add("새 일정", "2026-10-21T09:00", "2026-10-21T10:00", description="메모 한 줄")
check("추가 201", response.status_code == 201, str(response.get_json()))
fake.reset_calls()
code, events = get_events("2026-09-27", "2026-11-08")
check("추가 직후 다시 불러오기는 Google에 묻지 않음", fake.calls["get_events"] == 0, str(fake.calls))
new = next((event for event in events if event["title"] == "새 일정"), None)
check("새 일정이 보임", new is not None, str(titles(events)))
check("새 일정의 시간·메모·캘린더 정보",
      new is not None and new["start"].startswith("2026-10-21T09:00") and new["end"].startswith("2026-10-21T10:00")
      and new.get("description") == "메모 한 줄" and new["calendarId"] == "me@test" and new["color"] == "#4a7cff",
      str(new))
check("원래 일정과 다른 캘린더 일정도 그대로", {"원래 일정", "프로젝트 일정"} <= set(titles(events)), str(titles(events)))
code, day = get_events("2026-10-21", "2026-10-22")  # 오늘 탭 시간표(하루)
check("하루 범위(시간표)도 Google 없이 새 일정", fake.calls["get_events"] == 0 and titles(day) == ["새 일정"],
      f"{fake.calls} {titles(day)}")

# --- 2. 뒤에서 책갈피를 옮긴 뒤에도 기억을 버리지 않는다 (예전에는 이 확인이 기억을 다시 '오래됨'으로 만들었다)
drain()
fake.reset_calls()
code, events = get_events("2026-09-27", "2026-11-08")
check("책갈피 옮긴 뒤에도 Google에 묻지 않음", fake.calls["get_events"] == 0, str(fake.calls))
check("책갈피 옮긴 뒤에도 새 일정이 보임", "새 일정" in titles(events), str(titles(events)))

# --- 3. 1분마다 하는 확인이 내가 추가한 것을 '다른 곳의 변화'로 보지 않는다
app.run_sync_cycle()
check("동기화 뒤 version 그대로", client.get("/api/sync-status").get_json()["version"] == v0)
fake.reset_calls()
get_events("2026-09-27", "2026-11-08")
check("동기화 뒤에도 Google에 묻지 않음", fake.calls["get_events"] == 0, str(fake.calls))

# --- 4. 1분 확인이 책갈피 옮기기보다 먼저 와도 '다른 곳의 변화'로 보지 않는다
add("동기화가 먼저 본 일정", "2026-10-22T09:00", "2026-10-22T10:00")
app.run_sync_cycle()  # 뒤쪽 책갈피 옮기기와 거의 동시에 돈다
drain()
check("먼저 온 동기화도 version 그대로", client.get("/api/sync-status").get_json()["version"] == v0,
      str(client.get("/api/sync-status").get_json()))
fake.reset_calls()
code, events = get_events("2026-09-27", "2026-11-08")
check("먼저 온 동기화 뒤에도 Google에 묻지 않고 보임",
      fake.calls["get_events"] == 0 and "동기화가 먼저 본 일정" in titles(events), f"{fake.calls} {titles(events)}")

# --- 5. 두 달에 걸친 일정(10/31 밤 ~ 11/1 새벽)은 두 달 모두에 들어간다
add("월말 걸침", "2026-10-31T22:00", "2026-11-01T02:00")
fake.reset_calls()
oct_end = get_events("2026-10-31", "2026-11-01")[1]
nov_start = get_events("2026-11-01", "2026-11-02")[1]
check("두 달에 걸친 일정: 10월 쪽에 보임", "월말 걸침" in titles(oct_end), str(titles(oct_end)))
check("두 달에 걸친 일정: 11월 쪽에 보임", "월말 걸침" in titles(nov_start), str(titles(nov_start)))
check("두 달에 걸친 일정: Google에 묻지 않음", fake.calls["get_events"] == 0, str(fake.calls))

# --- 6. 종일 일정
add("종일 새 일정", "2026-10-23", "2026-10-25", all_day=True)
fake.reset_calls()
code, events = get_events("2026-10-23", "2026-10-26")
allday = next((event for event in events if event["title"] == "종일 새 일정"), None)
check("종일 일정: Google 없이 보이고 날짜가 맞음",
      fake.calls["get_events"] == 0 and allday is not None and allday["start"] == "2026-10-23" and allday["end"] == "2026-10-25",
      f"{fake.calls} {allday}")

# --- 7. 아직 받아 둔 적 없는 달에 추가하면 그 달은 평소처럼 Google에서 받는다 (빈 달로 착각하지 않는다)
fake.add_event("me@test", "5월 원래 일정", "2027-05-10T09:00:00+09:00", "2027-05-10T10:00:00+09:00")
app.run_sync_cycle()
add("5월 새 일정", "2027-05-11T09:00", "2027-05-11T10:00")
fake.reset_calls()
code, may = get_events("2027-05-01", "2027-06-01")
check("받아 둔 적 없는 달: Google에서 받아 원래 일정과 새 일정이 모두 보임",
      fake.calls["get_events"] >= 1 and {"5월 원래 일정", "5월 새 일정"} <= set(titles(may)), f"{fake.calls} {titles(may)}")
drain()

# --- 8. 추가하는 사이 다른 곳(폰)에서도 바뀌었으면 그 캘린더는 Google에서 다시 받는다
app.run_sync_cycle()
fake.add_event("me@test", "폰에서 추가", "2026-10-26T09:00:00+09:00", "2026-10-26T10:00:00+09:00")
add("같은 때 추가", "2026-10-27T09:00", "2026-10-27T10:00")
drain()  # 책갈피 옮기기가 '내가 쓴 것이 아닌 변화'를 본다
fake.reset_calls()
code, events = get_events("2026-09-27", "2026-11-08")
check("폰 변화가 섞이면 다시 받아서 둘 다 보임",
      {"폰에서 추가", "같은 때 추가"} <= set(titles(events)), f"{fake.calls} {titles(events)}")
drain()

# --- 9. 추가하기 전에 시작한 다시 받기가 추가 뒤에 끝나도, 새 일정이 빠진 그 결과를 믿지 않는다
app.run_sync_cycle()
app.event_store.invalidate("me@test")  # 화면이 다시 불러오는 중인 상태를 만든다 (기억이 오래됨)
original_get_events = google_calendar.get_events
gate = threading.Event()
fetched = threading.Event()
slowed = []


def slow_get_events(service, calendar_id, start, end):
    result = original_get_events(service, calendar_id, start, end)  # 추가하기 전의 내용
    if calendar_id == "me@test" and not slowed:
        slowed.append(True)
        fetched.set()
        gate.wait(5)  # 추가가 끝날 때까지 결과를 늦게 돌려준다
    return result


google_calendar.get_events = slow_get_events
loader = threading.Thread(target=lambda: app.event_store.load_months("me@test", [(2026, 10)], app.get_thread_service))
loader.start()
fetched.wait(5)
add("늦은 받기 중 추가", "2026-10-28T09:00", "2026-10-28T10:00")
gate.set()
loader.join(5)
google_calendar.get_events = original_get_events
code, events = get_events("2026-10-01", "2026-11-01")
check("늦게 끝난 옛 받기가 새 일정을 지우지 않음", "늦은 받기 중 추가" in titles(events), str(titles(events)))
drain()

# --- 10. 추가에 실패하면 기억은 그대로이고 일정도 생기지 않는다
fake.offline = True
response = add("실패할 일정", "2026-10-29T09:00", "2026-10-29T10:00")
fake.offline = False
check("오프라인 추가는 502", response.status_code == 502)
code, events = get_events("2026-09-27", "2026-11-08")
check("실패한 일정은 안 보임", "실패할 일정" not in titles(events), str(titles(events)))

# --- 12. 내가 만든 일정을 나중에 폰에서 고치면, '내가 만든 것'으로 착각하지 않고 다시 받는다
add("폰에서 고칠 일정", "2026-10-29T09:00", "2026-10-29T10:00")
drain()
app.run_sync_cycle()  # 책갈피 옮기기와 1분 확인이 모두 이 일정을 지나갔다
target_id = next(event["id"] for event in get_events("2026-10-29", "2026-10-30")[1] if event["title"] == "폰에서 고칠 일정")
version_before = client.get("/api/sync-status").get_json()["version"]
fake.update_event(None, "me@test", target_id, title="폰에서 고친 제목")
app.run_sync_cycle()
check("내가 만든 일정을 폰에서 고치면 version 증가", client.get("/api/sync-status").get_json()["version"] == version_before + 1)
code, events = get_events("2026-10-29", "2026-10-30")
check("폰에서 고친 제목이 보임", titles(events) == ["폰에서 고친 제목"], str(titles(events)))
drain()

# --- 13. 같은 옛 책갈피로 두 확인이 동시에 돌아도(1분 확인 + 책갈피 옮기기), 늦게 끝난 쪽이 내 일정을 다른 곳의 변화로 보지 않는다
app.run_sync_cycle()
original_list_changes = google_calendar.list_changes
gate = threading.Event()
waiting = threading.Event()
held = []


def held_list_changes(service, calendar_id, sync_token=None):
    if calendar_id == "me@test" and not held:
        held.append(True)
        waiting.set()
        gate.wait(5)  # 책갈피는 이미 읽었고, Google에 묻는 것만 늦어진 확인
    return original_list_changes(service, calendar_id, sync_token)


google_calendar.list_changes = held_list_changes
late = []
checker = threading.Thread(target=lambda: late.append(app.event_store.check_calendar("me@test", app.get_thread_service)))
checker.start()
waiting.wait(5)
add("동시 확인 중 추가", "2026-10-30T09:00", "2026-10-30T10:00")
drain()  # 책갈피 옮기기가 먼저 끝나서 이 일정을 '처음 봄'으로 적는다
gate.set()
checker.join(5)
google_calendar.list_changes = original_list_changes
check("늦게 끝난 확인도 '바뀌지 않음'", late == [False], str(late))
fake.reset_calls()
code, events = get_events("2026-09-27", "2026-11-08")
check("늦게 끝난 확인 뒤에도 Google에 묻지 않고 보임",
      fake.calls["get_events"] == 0 and "동시 확인 중 추가" in titles(events), f"{fake.calls} {titles(events)}")
drain()

# --- 14. 일정 B를 Google에 보내는 사이, 앞 일정의 확인이 B를 먼저 보아도 다른 곳의 변화로 보지 않는다 (연달아 붙여넣기)
app.run_sync_cycle()
original_create = google_calendar.create_event
created_gate = threading.Event()
inserted = threading.Event()


def slow_create(*args, **kwargs):
    result = original_create(*args, **kwargs)  # Google에는 이미 생겼다
    inserted.set()
    created_gate.wait(5)  # 대답만 늦게 온다
    return result


google_calendar.create_event = slow_create
answers = []
poster = threading.Thread(target=lambda: answers.append(app.app.test_client().post("/api/events", json={
    "calendarId": "me@test", "title": "보내는 중인 일정", "allDay": False, "start": "2026-10-31T09:00", "end": "2026-10-31T10:00"}).status_code))
poster.start()
inserted.wait(5)
seen_changed = app.event_store.check_calendar("me@test", app.get_thread_service)  # 앞 일정의 책갈피 옮기기
created_gate.set()
poster.join(5)
google_calendar.create_event = original_create
check("보내는 중인 일정을 본 확인은 '바뀌지 않음'", seen_changed is False and answers == [201], f"{seen_changed} {answers}")
fake.reset_calls()
code, events = get_events("2026-09-27", "2026-11-08")
check("보내는 중이던 일정도 Google에 묻지 않고 보임",
      fake.calls["get_events"] == 0 and "보내는 중인 일정" in titles(events), f"{fake.calls} {titles(events)}")
drain()

# ===== 수정·끌기·옮기기·삭제도 기억에 바로 반영한다 (끌기 뒤 붙여넣기가 다시 받느라 느렸다) =====
app.run_sync_cycle()
drain()


def event_id_of(title, start="2026-09-27", end="2026-11-08"):
    return next(event["id"] for event in get_events(start, end)[1] if event["title"] == title)


def no_refetch_after(name, action, look_start, look_end, condition, calendar_id="me@test"):
    """action(쓰기)을 한 뒤: 다시 불러오기가 Google 없이 condition을 만족하는지, 뒤쪽 확인과 1분 확인 뒤에도 그런지."""
    version_before = client.get("/api/sync-status").get_json()["version"]
    response = action()
    check(f"{name}: 성공", response.status_code == 200, f"{response.status_code} {response.get_json()}")
    fake.reset_calls()
    events = get_events(look_start, look_end)[1]
    check(f"{name}: 다시 불러오기는 Google에 묻지 않음", fake.calls["get_events"] == 0, str(fake.calls))
    check(f"{name}: 바뀐 내용이 보임", condition(events), str([(e["title"], e["start"], e["calendarId"]) for e in events]))
    drain()
    app.run_sync_cycle()
    fake.reset_calls()
    events = get_events(look_start, look_end)[1]
    check(f"{name}: 뒤쪽 확인·1분 확인 뒤에도 Google에 묻지 않고 그대로",
          fake.calls["get_events"] == 0 and condition(events), f"{fake.calls}")
    check(f"{name}: version 그대로", client.get("/api/sync-status").get_json()["version"] == version_before)


# --- 16. 일정 창에서 제목·메모 고치기
target_id = event_id_of("새 일정")
no_refetch_after("제목 고치기",
                 lambda: client.patch(f"/api/events/{target_id}", json={"calendarId": "me@test", "title": "고친 제목", "description": "고친 메모"}),
                 "2026-09-27", "2026-11-08",
                 lambda events: any(e["title"] == "고친 제목" and e.get("description") == "고친 메모" for e in events)
                 and not any(e["title"] == "새 일정" for e in events))

# --- 17. 끌어서 다른 날로 옮기기(시간만 PATCH): 옛 날짜에서 빠지고 새 날짜에 들어간다
no_refetch_after("끌어 옮기기",
                 lambda: client.patch(f"/api/events/{target_id}", json={"calendarId": "me@test", "allDay": False,
                                                                       "start": "2026-11-03T14:00", "end": "2026-11-03T15:00"}),
                 "2026-10-21", "2026-11-04",
                 lambda events: [e["start"][:16] for e in events if e["id"] == target_id] == ["2026-11-03T14:00"])
fake.reset_calls()
old_day = get_events("2026-10-21", "2026-10-22")[1]
check("끌어 옮기기: 옛 날짜(10/21)에서는 빠짐", target_id not in [e["id"] for e in old_day] and fake.calls["get_events"] == 0,
      f"{fake.calls} {titles(old_day)}")

# --- 18. 다른 캘린더로 옮기기: 원래 캘린더에서 빠지고 옮긴 캘린더에 생긴다 (두 캘린더 모두 Google 없이)
no_refetch_after("캘린더 옮기기",
                 lambda: client.patch(f"/api/events/{target_id}", json={"calendarId": "me@test", "title": "옮긴 일정",
                                                                       "destinationCalendarId": "proj@test"}),
                 "2026-10-25", "2026-12-06",
                 lambda events: [(e["title"], e["calendarId"]) for e in events if e["id"] == target_id] == [("옮긴 일정", "proj@test")])

# --- 19. 지우기
delete_id = event_id_of("종일 새 일정")
no_refetch_after("지우기",
                 lambda: client.delete(f"/api/events/{delete_id}?calendarId=me@test"),
                 "2026-09-27", "2026-11-08",
                 lambda events: delete_id not in [e["id"] for e in events])

# --- 20. 끌어 옮긴 뒤 붙여넣기 (사용자가 매일 하는 흐름): 붙여넣기 뒤 다시 불러오기도 Google 없이
drag_id = event_id_of("원래 일정")
client.patch(f"/api/events/{drag_id}", json={"calendarId": "me@test", "allDay": False, "start": "2026-10-19T11:00", "end": "2026-10-19T12:00"})
add("끌기 뒤 붙여넣기", "2026-10-20T11:00", "2026-10-20T12:00")
fake.reset_calls()
events = get_events("2026-09-27", "2026-11-08")[1]
check("끌기 뒤 붙여넣기: Google에 묻지 않고 둘 다 맞게 보임",
      fake.calls["get_events"] == 0 and "끌기 뒤 붙여넣기" in titles(events)
      and [e["start"][:16] for e in events if e["id"] == drag_id] == ["2026-10-19T11:00"], f"{fake.calls} {titles(events)}")
drain()

# --- 21. 내가 고친 일정을 나중에 폰에서 또 고치면 다시 받는다
app.run_sync_cycle()
version_before = client.get("/api/sync-status").get_json()["version"]
fake.update_event(None, "me@test", drag_id, title="폰에서 다시 고침")
app.run_sync_cycle()
check("내가 고친 일정을 폰에서 고치면 version 증가", client.get("/api/sync-status").get_json()["version"] == version_before + 1)
check("폰에서 다시 고친 제목이 보임", "폰에서 다시 고침" in titles(get_events("2026-09-27", "2026-11-08")[1]))

# --- 22. 수정이 실패하면 화면은 Google과 같은 옛 내용 그대로
fake.offline = True
fail_id = event_id_of("월말 걸침")
response = client.patch(f"/api/events/{fail_id}", json={"calendarId": "me@test", "title": "실패한 수정"})
fake.offline = False
check("오프라인 수정은 502", response.status_code == 502)
check("실패한 수정은 안 보이고 옛 제목 그대로", "월말 걸침" in titles(get_events("2026-09-27", "2026-11-08")[1]))
drain()

# --- 23. 먼저 시작한 확인이 내 수정보다 늦게 끝나도 옛 책갈피로 덮지 않는다 (덮으면 그 뒤 폰에서 고친 것을 놓친다)
add("늦은 확인 뒤 고칠 일정", "2026-10-30T13:00", "2026-10-30T14:00")
drain()
app.run_sync_cycle()
late_id = event_id_of("늦은 확인 뒤 고칠 일정")
gate = threading.Event()
answered = threading.Event()
held = []


def late_list_changes(service, calendar_id, sync_token=None):
    result = original_list_changes(service, calendar_id, sync_token)  # 내 수정 전의 대답
    if calendar_id == "me@test" and not held:
        held.append(True)
        answered.set()
        gate.wait(5)  # 대답이 늦게 도착한다
    return result


google_calendar.list_changes = late_list_changes
checker = threading.Thread(target=lambda: app.event_store.check_calendar("me@test", app.get_thread_service))
checker.start()
answered.wait(5)
client.patch(f"/api/events/{late_id}", json={"calendarId": "me@test", "title": "내가 고침"})
drain()  # 내 수정 뒤의 책갈피 옮기기가 먼저 끝난다
gate.set()
checker.join(5)
google_calendar.list_changes = original_list_changes
version_before = client.get("/api/sync-status").get_json()["version"]
fake.update_event(None, "me@test", late_id, title="그 뒤 폰에서 고침")
app.run_sync_cycle()
check("늦게 끝난 옛 확인 뒤에도 폰에서 고친 것을 알아챔", client.get("/api/sync-status").get_json()["version"] == version_before + 1)
check("그 뒤 폰에서 고친 제목이 보임", "그 뒤 폰에서 고침" in titles(get_events("2026-09-27", "2026-11-08")[1]))
drain()

# --- 24. 화면이 정한 번호로 만든다 (저장을 기다리지 않고 먼저 그린 일정을 같은 번호로 이어받으려고)
chosen = "0123456789abcdef0123456789abcdef"
response = client.post("/api/events", json={"id": chosen, "calendarId": "me@test", "title": "화면이 정한 번호", "allDay": False,
                                            "start": "2026-10-24T09:00", "end": "2026-10-24T10:00"})
fake.reset_calls()
events = get_events("2026-10-24", "2026-10-25")[1]
check("화면이 정한 번호로 만들어지고 Google 없이 그 번호로 보임",
      response.status_code == 201 and chosen in fake.events["me@test"] and [e["id"] for e in events if e["title"] == "화면이 정한 번호"] == [chosen]
      and fake.calls["get_events"] == 0, f"{response.status_code} {fake.calls}")
for bad in ("ABC12", "abc", "abc_def", "w" * 5, 12345, "a" * 1025):
    response = client.post("/api/events", json={"id": bad, "calendarId": "me@test", "title": "틀린 번호", "allDay": True,
                                                "start": "2026-10-24", "end": "2026-10-25"})
    check(f"틀린 번호({str(bad)[:12]})는 400이고 만들지 않음", response.status_code == 400 and "틀린 번호" not in titles(get_events("2026-10-24", "2026-10-25")[1]),
          str(response.status_code))
drain()

# --- 15. 다시 켜도(기억 파일에서 읽어도) 추가한 일정이 남아 있다
app.event_store.save(force=True)
app.event_store = event_cache.EventCache(app.event_store.path)
app.run_sync_cycle()
fake.reset_calls()
code, events = get_events("2026-09-27", "2026-11-08")
check("다시 켠 뒤에도 추가·수정한 일정이 보임", {"동기화가 먼저 본 일정", "월말 걸침", "끌기 뒤 붙여넣기", "옮긴 일정"} <= set(titles(events))
      and not {"새 일정", "종일 새 일정"} & set(titles(events)), str(titles(events)))

print()
print("실패:", failures if failures else "없음")
sys.exit(1 if failures else 0)
