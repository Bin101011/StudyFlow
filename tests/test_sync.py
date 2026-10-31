import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_google

fake = fake_google.install()

import event_cache  # noqa: E402
import app  # noqa: E402

CACHE_FILE = os.path.join(fake_google.TMP, "events_cache.json")
app.event_store = event_cache.EventCache(CACHE_FILE)
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


# 데이터: 10월 중 일정들. 경계 사례 포함
fake.add_event("me@test", "10월 회의", "2026-10-19T09:00:00+09:00", "2026-10-19T10:00:00+09:00")
fake.add_event("me@test", "월말 걸침", "2026-10-31T22:00:00+09:00", "2026-11-01T02:00:00+09:00")
fake.add_event("proj@test", "종일 10/31", "2026-10-31", "2026-11-01")  # 11월에는 나오면 안 된다
fake.add_event("holiday@test", "개천절", "2026-10-03", "2026-10-04")
fake.add_event("me@test", "11월 일정", "2026-11-10T09:00:00+09:00", "2026-11-10T10:00:00+09:00")

# --- 0. 시작: 확인(동기화)을 먼저 한 번 돌려 책갈피를 받는다 (처음 켠 날)
app.run_sync_cycle()
st = client.get("/api/sync-status").get_json()
check("처음 동기화 후 lastSync 있음, online", st["lastSync"] is not None and st["online"] is True)
v0 = st["version"]

# --- 1. 첫 요청: 캘린더마다 Google 호출 1번 (달 3개를 묶어서)
fake.reset_calls()
code, events = get_events("2026-09-27", "2026-11-08")
check("첫 요청 200", code == 200)
check("캘린더당 1회 호출(묶어서)", fake.calls["get_events"] == 3, str(fake.calls))
titles = sorted(e["title"] for e in events)
check("일정 내용", titles == sorted(["10월 회의", "월말 걸침", "종일 10/31", "개천절"]), str(titles))
sample = next(e for e in events if e["title"] == "개천절")
check("색/캘린더 정보 붙음", sample["color"] == "#d6336c" and sample["calendarId"] == "holiday@test" and sample["editable"] is False and sample["canEdit"] is False)
drain()

# --- 2. 같은 요청: Google 호출 0번
fake.reset_calls()
code, events2 = get_events("2026-09-27", "2026-11-08")
check("두 번째 요청은 Google 호출 0번", fake.calls["get_events"] == 0, str(fake.calls))
check("내용 동일", sorted(e["id"] for e in events) == sorted(e["id"] for e in events2))

# --- 3. 다음 달로 이동: 앞뒤 달이 미리 받아져 있어서 대부분 0번
fake.reset_calls()
code, events3 = get_events("2026-10-25", "2026-12-06")  # 11월 그리드
check("다음 달 이동: 미리 받아둔 덕에 호출 0번", fake.calls["get_events"] == 0, str(fake.calls))
check("11월 그리드에 11월 일정", any(e["title"] == "11월 일정" for e in events3))
check("11월 그리드에 월말 걸침(10/31~11/1)", any(e["title"] == "월말 걸침" for e in events3))
nov = get_events("2026-11-01", "2026-12-01")[1]
check("종일 10/31은 11월 범위에 안 나옴", not any(e["title"] == "종일 10/31" for e in nov))
oct31 = get_events("2026-10-31", "2026-11-01")[1]
check("하루 범위(10/31)에 걸친 일정", sorted(e["title"] for e in oct31) == sorted(["월말 걸침", "종일 10/31"]), str([e["title"] for e in oct31]))
drain()

# --- 4. 다른 곳(폰)에서 일정 추가 → 동기화 주기에서 감지
fake.add_event("proj@test", "폰에서 추가", "2026-10-20T15:00:00+09:00", "2026-10-20T16:00:00+09:00")
app.run_sync_cycle()
st = client.get("/api/sync-status").get_json()
check("변경 감지 → version 증가", st["version"] == v0 + 1, str(st))
fake.reset_calls()
code, events4 = get_events("2026-09-27", "2026-11-08")
check("바뀐 캘린더만 다시 받음(1회)", fake.calls["get_events"] == 1, str(fake.calls))
check("폰에서 추가한 일정 보임", any(e["title"] == "폰에서 추가" for e in events4))
drain()

# --- 5. 변화 없는 동기화는 version 그대로 (공휴일처럼 책갈피를 거절하는 캘린더가 있어도 알림이 반복되면 안 된다)
v1 = client.get("/api/sync-status").get_json()["version"]
for _ in range(3):
    app.run_sync_cycle()
check("변화 없으면 version 그대로(공개 캘린더 포함, 3회)", client.get("/api/sync-status").get_json()["version"] == v1)
check("공휴일 캘린더는 시간 기반으로 분류", app.event_store._unsyncable == {"holiday@test"} and "holiday@test" not in app.event_store._tokens, str(app.event_store._unsyncable))
fake.reset_calls()
get_events("2026-09-27", "2026-11-08")
check("공개 캘린더도 캐시에서 제공", fake.calls["get_events"] == 0, str(fake.calls))
# 30분이 지나면 공휴일 캘린더만 새로 받는다
app.event_store._valid_since["holiday@test"] -= event_cache.UNSYNCABLE_REFRESH_SECONDS + 1
app.run_sync_cycle()
fake.reset_calls()
get_events("2026-09-27", "2026-11-08")
check("30분 지나면 공개 캘린더만 새로 받음(1회)", fake.calls["get_events"] == 1, str(fake.calls))
check("그 갱신은 화면 알림(version)을 올리지 않음", client.get("/api/sync-status").get_json()["version"] == v1)
drain()

# --- 6. StudyFlow가 직접 추가 → 바로 보이고, 이후 동기화가 외부 변화로 오해하지 않음
response = client.post("/api/events", json={"calendarId": "me@test", "title": "내가 추가", "allDay": False,
                                            "start": "2026-10-21T09:00", "end": "2026-10-21T10:00"})
check("추가 201", response.status_code == 201)
code, events6 = get_events("2026-09-27", "2026-11-08")
check("추가 직후 바로 보임", any(e["title"] == "내가 추가" for e in events6))
drain()
app.run_sync_cycle()
check("내가 쓴 변화는 version 안 올림", client.get("/api/sync-status").get_json()["version"] == v1,
      str(client.get("/api/sync-status").get_json()))
drain()

# --- 7. 토큰 만료 처리
for token in list(app.event_store._tokens.values()):
    fake.expired.add(token)
app.run_sync_cycle()
check("토큰 만료 → 새 토큰으로 복구, version 증가", client.get("/api/sync-status").get_json()["version"] == v1 + 1)
fake.reset_calls()
code, events7 = get_events("2026-09-27", "2026-11-08")
check("만료 후에도 일정 정상", code == 200 and any(e["title"] == "내가 추가" for e in events7))
drain()

# --- 8. 파일 저장 후 다시 켜기(재시작): 변화 없으면 Google 호출 없이 바로 캐시 사용
app.event_store.save(force=True)
check("캐시 파일 생성", os.path.exists(CACHE_FILE))
restarted = event_cache.EventCache(CACHE_FILE)
app.event_store = restarted
fake.reset_calls()
code, events8 = get_events("2026-09-27", "2026-11-08")
check("재시작 직후(확인 전)는 Google에 물음", fake.calls["get_events"] == 3, str(fake.calls))
drain()
app.event_store = event_cache.EventCache(CACHE_FILE)
app.run_sync_cycle()  # 저장된 책갈피로 확인 → 변화 없음
fake.reset_calls()
code, events8b = get_events("2026-09-27", "2026-11-08")
check("재시작 + 확인 후엔 Google 호출 0번", fake.calls["get_events"] == 0, str(fake.calls))
check("재시작 후 version 변화 없음", client.get("/api/sync-status").get_json()["version"] == 0)
drain()

# --- 9. 오프라인
app.event_store.save(force=True)
app.event_store = event_cache.EventCache(CACHE_FILE)  # 재시작 직후 + 인터넷 없음
fake.offline = True
fake.reset_calls()
app.run_sync_cycle()
st = client.get("/api/sync-status").get_json()
check("오프라인 감지", st["online"] is False and st["lastSync"] is not None, str(st))
fake.reset_calls()
code, events9 = get_events("2026-09-27", "2026-11-08")
check("오프라인에서도 저장된 일정 표시", code == 200 and any(e["title"] == "10월 회의" for e in events9), f"{code}")
check("오프라인에서는 Google에 묻지 않음", fake.calls["get_events"] == 0, str(fake.calls))
code, events9b = get_events("2027-03-01", "2027-04-01")
check("한 번도 안 본 달은 502 + 이유", code == 502 and "error" in events9b, f"{code} {events9b}")
response = client.post("/api/events", json={"calendarId": "me@test", "title": "x", "allDay": False,
                                            "start": "2026-10-21T09:00", "end": "2026-10-21T10:00"})
check("오프라인 쓰기는 502 + 안내", response.status_code == 502 and "인터넷" in response.get_json()["error"], str(response.get_json()))
code_cal = client.get("/api/calendars")
check("오프라인에서도 캘린더 목록", code_cal.status_code == 200 and len(code_cal.get_json()) == 3)

# 오프라인에서 새로고침 버튼: 기억해둔 일정을 지우지 않는다
response = client.post("/api/refresh")
check("오프라인 새로고침: online False", response.get_json()["online"] is False)
code, events9c = get_events("2026-09-27", "2026-11-08")
check("오프라인 새로고침 후에도 일정 유지", code == 200 and len(events9c) > 0)

# --- 10. 온라인 복귀
fake.offline = False
app.run_sync_cycle()
check("온라인 복귀", client.get("/api/sync-status").get_json()["online"] is True)
fake.reset_calls()
code, events10 = get_events("2027-03-01", "2027-04-01")
check("복귀 후 새 달 정상", code == 200)
drain()

# --- 11. 수동 새로고침: 기억해둔 일정을 모두 다시 받는다
fake.reset_calls()
response = client.post("/api/refresh")
st = response.get_json()
check("새로고침 응답 online", st["online"] is True)
fake.reset_calls()
code, events11 = get_events("2026-09-27", "2026-11-08")
check("새로고침 후 다시 받음(3개 캘린더)", fake.calls["get_events"] == 3, str(fake.calls))
drain()
fake.reset_calls()
get_events("2026-09-27", "2026-11-08")
check("그다음엔 다시 캐시", fake.calls["get_events"] == 0, str(fake.calls))

# --- 12. 삭제도 반영
target = next(e for e in events11 if e["title"] == "내가 추가")
response = client.delete(f"/api/events/{target['id']}?calendarId=me@test")
check("삭제 200", response.status_code == 200)
code, events12 = get_events("2026-09-27", "2026-11-08")
check("삭제 직후 사라짐", not any(e["title"] == "내가 추가" for e in events12))

# --- 13. 오래 확인 못 하면(10분 이상) 캐시를 그냥 믿지 않는다
drain()
for key in app.event_store._checked_at:
    app.event_store._checked_at[key] -= event_cache.CHECK_FRESH_SECONDS + 1
fake.reset_calls()
get_events("2026-09-27", "2026-11-08")
check("확인이 오래 안 되면 다시 받음", fake.calls["get_events"] == 3, str(fake.calls))

# --- 14. 망가진 캐시 파일은 무시
with open(CACHE_FILE, "w", encoding="utf-8") as f:
    f.write("{ 이건 json이 아님")
broken = event_cache.EventCache(CACHE_FILE)
check("망가진 파일: 빈 상태로 시작", broken._months == {} and broken._tokens == {})

print()
print("실패:", failures if failures else "없음")
sys.exit(1 if failures else 0)
