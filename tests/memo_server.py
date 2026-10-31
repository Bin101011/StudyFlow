# 일정 메모 / 하루 메모 테스트용 서버 (가짜 Google + 임시 DB). 실제 Google과 내 데이터는 건드리지 않는다
import os, sys, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_google
fake = fake_google.install()
import event_cache, app, database
from flask import jsonify

app.event_store = event_cache.EventCache(os.path.join(fake_google.TMP, "cache.json"))
database.init_db()
today = datetime.date.today()
iso = lambda n: (today + datetime.timedelta(days=n)).isoformat()

# 오늘의 일정들: 메모 있음 / HTML 설명 / 메모 없음 / 읽기 전용(공휴일)
fake.add_event("me@test", "학생회 팀장 회의", f"{iso(0)}T15:00:00+09:00", f"{iso(0)}T16:00:00+09:00",
               "가져갈 물품: 노트북, 포스터 2장\n3 < 5 이고 a<b")
fake.add_event("me@test", "HTML 설명 일정", f"{iso(0)}T10:00:00+09:00", f"{iso(0)}T11:00:00+09:00",
               '<b>준비</b>물<br>노트북&amp;충전기<br><a href="http://x.test">링크</a><script>window.__xss=1</script>')
fake.add_event("me@test", "메모 없는 일정", f"{iso(0)}T12:00:00+09:00", f"{iso(0)}T13:00:00+09:00")
fake.add_event("holiday@test", "공휴일 예시", iso(0), iso(1), "공휴일 설명 (읽기 전용)")
fake.add_event("proj@test", "종일 일정", iso(0), iso(1))
fake.add_event("me@test", "내일 일정", f"{iso(1)}T09:00:00+09:00", f"{iso(1)}T10:00:00+09:00")
fake.add_event("proj@test", "겹치는 일정", f"{iso(0)}T15:30:00+09:00", f"{iso(0)}T16:30:00+09:00")

# 시간표 테스트용 할 일: 프로젝트 할 일, 프로젝트 없는 할 일, 수집함(날짜 없음), 밀린 할 일
_p = database.add_project("기말 프로젝트", iso(21), "#4a7cff", "auto", 0)
database.add_task("발표 자료 만들기", iso(0), _p["id"])
database.add_task("LC 파트 풀기", iso(0))
database.add_task("장보기", iso(0))
database.add_task("여권 사진 찍기", None)
database.add_task("지난 일 마무리", iso(-2))


@app.app.route("/__test/offline/<int:value>")
def __offline(value):
    fake.offline = bool(value)
    return jsonify({"offline": fake.offline})


@app.app.route("/__test/state")
def __state():
    events = {}
    for cal, items in fake.events.items():
        for event_id, event in items.items():
            events[event["summary"] + "|" + cal] = {"id": event_id, "description": event.get("description"), "start": event["start"]}
    return jsonify({"events": events, "patches": getattr(fake, "patches", []), "creates": fake.calls.get("create_event", 0)})


app.app.run(port=5057, threaded=True)
