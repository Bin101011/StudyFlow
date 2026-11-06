# 일정 메모 / 하루 메모 테스트용 서버 (가짜 Google + 임시 DB). 실제 Google과 내 데이터는 건드리지 않는다
import os, sys, datetime, threading, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_google
fake = fake_google.install()
import event_cache, app, database
from flask import jsonify, request

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


@app.app.route("/__test/stale-offline")
def __stale_offline():
    # "10분 넘게 오프라인이었고 인터넷이 막 돌아온 순간"을 만든다: 서버는 오프라인으로 알고, 기억은 받은 지 오래됐다 (N35)
    store = app.event_store
    with store._lock:
        for calendar_id in list(store._months):
            store._checked_at[calendar_id] = time.time() - 700
        store._online = False
    return jsonify({"online": store.online})


@app.app.route("/__test/state")
def __state():
    events = {}
    for cal, items in fake.events.items():
        for event_id, event in items.items():
            events[event["summary"] + "|" + cal] = {"id": event_id, "description": event.get("description"), "start": event["start"]}
    # list: 제목이 같은 일정도 하나씩 (복사·붙여넣기한 일정은 제목이 같아서 events에서는 겹친다)
    listed = [{"id": event_id, "title": event["summary"], "calendarId": cal, "start": event["start"]}
              for cal, items in fake.events.items() for event_id, event in items.items()]
    return jsonify({"events": events, "list": listed, "patches": getattr(fake, "patches", []), "creates": fake.calls.get("create_event", 0)})


# ----- 응답 늦추기/실패 스위치 (docs/review-2026-11.md "측정·실험 방법") -----
# /__test/rule?method=POST&path=/api/events&ms=2000,0&status=502&count=2&after=1 : 맞는 요청을 늦추거나 실패시킨다
#   ms: 늦출 밀리초. 여러 개면 맞는 요청마다 차례로 쓰고, 다 쓰면 마지막 값을 계속 쓴다
#   status: 처리하지 않고 이 번호로 실패 응답을 준다 (늦춘 뒤에)
#   count: 이 횟수만큼만 적용하고 스스로 꺼진다 (없으면 계속)
#   after=1: 요청을 처리한 뒤에 응답만 늦춘다 (옛 내용이 늦게 도착하는 상황)
# 값 없이 /__test/rule 을 부르면 모든 스위치를 끈다
_rules = []
_rules_lock = threading.Lock()


@app.app.route("/__test/rule")
def __rule():
    with _rules_lock:
        if not request.args.get("path"):
            _rules.clear()
            return jsonify({"rules": 0})
        _rules.append({
            "method": request.args.get("method", "GET").upper(),
            "path": request.args["path"],
            "ms": [int(x) for x in request.args.get("ms", "0").split(",")],
            "status": int(request.args["status"]) if request.args.get("status") else None,
            "count": int(request.args["count"]) if request.args.get("count") else None,
            "after": request.args.get("after") == "1",
        })
        return jsonify({"rules": len(_rules)})


def _take_rule():
    """지금 요청에 맞는 스위치를 하나 꺼내 (늦출 초, 실패 번호, 처리 뒤 늦추기)로 돌려준다. 없으면 None."""
    with _rules_lock:
        for rule in _rules:
            if rule["method"] == request.method and rule["path"] == request.path:
                delay = rule["ms"].pop(0) if len(rule["ms"]) > 1 else rule["ms"][0]
                if rule["count"] is not None:
                    rule["count"] -= 1
                    if rule["count"] <= 0:
                        _rules.remove(rule)
                return delay / 1000, rule["status"], rule["after"]
    return None


@app.app.before_request
def __apply_rule():
    if request.path.startswith("/__test/"):
        return None
    rule = _take_rule()
    if rule is None:
        return None
    delay, status, after = rule
    if after:
        request.environ["test.delay_after"] = delay
        return None
    time.sleep(delay)
    if status:
        return jsonify({"error": "Google에 일정을 쓰지 못했습니다. (시험용 실패)"}), status
    return None


@app.app.after_request
def __delay_after(response):
    delay = request.environ.get("test.delay_after")
    if delay:
        time.sleep(delay)
    return response


app.app.run(port=5057, threaded=True)
