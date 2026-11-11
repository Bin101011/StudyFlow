# 아침 정리 창의 서버 쪽 시험 (임시 DB, Flask 테스트 클라이언트):
# [끝냈음]/[전부 끝냈음]이 쓰는 POST /api/tasks/finish-on-planned-date, 정리 창 설정(overdueReviewEnabled, overdueReviewDate)
import datetime, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_google
fake = fake_google.install()
import app, database, settings_store

failed = 0
def check(name, ok, extra=""):
    global failed
    if not ok: failed += 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  [" + str(extra) + "]"))

database.init_db()
c = app.app.test_client()
# 시험 날짜는 진짜 오늘을 기준으로 정한다 (서버가 "오늘"을 이 컴퓨터의 시계로 보므로, 날짜를 고정하면 언젠가 틀린다)
TODAY = datetime.date.today()
def day(offset): return (TODAY + datetime.timedelta(days=offset)).isoformat()
T, Y, Y3, TOM = day(0), day(-1), day(-3), day(1)

def finish(ids): return c.post("/api/tasks/finish-on-planned-date", json={"ids": ids})
def names(date): return [(t["content"], t["done"]) for t in c.get("/api/tasks?date=" + date).get_json()["tasks"]]
def overdue(): return [t["content"] for t in c.get("/api/tasks?date=" + T).get_json()["overdue"]]

a = database.add_task("어제 할 일", Y)
b = database.add_task("사흘 전 할 일", Y3)
check("시작: 둘 다 밀린 할 일", overdue() == ["사흘 전 할 일", "어제 할 일"], overdue())

# ----- 하나 끝냄 -----
r = finish([a["id"]])
check("끝냈음: 200, finished에 들어 있고 skipped는 비어 있음", r.status_code == 200 and r.get_json() == {"finished": [a["id"]], "skipped": []}, r.get_json())
task = database.get_task(a["id"])
check("끝낸 날짜가 오늘이 아니라 하려던 날(어제)의 23:59:59", task["done"] == 1 and task["done_at"] == Y + "T23:59:59", task)
check("밀린 할 일에서 빠진다", overdue() == ["사흘 전 할 일"], overdue())
check("어제 목록에 끝냄으로 나온다", names(Y) == [("어제 할 일", 1)], names(Y))
check("오늘 목록에는 나오지 않는다(오늘 끝낸 것이 아니므로)", ("어제 할 일", 1) not in names(T), names(T))
check("날짜(date)는 그대로", task["date"] == Y)

# 같은 할 일을 또 보내면 건너뛴다 (두 번 누름, 다른 곳에서 이미 체크)
r = finish([a["id"]])
check("이미 끝낸 할 일은 skipped, 끝낸 시각은 그대로", r.get_json() == {"finished": [], "skipped": [a["id"]]} and database.get_task(a["id"])["done_at"] == Y + "T23:59:59", r.get_json())

# ----- 체크를 풀고 평소처럼 체크하면 지금 시각 -----
c.patch("/api/tasks/%d" % a["id"], json={"done": False})
check("체크를 풀면 done_at이 지워지고 다시 밀린 할 일", database.get_task(a["id"])["done_at"] is None and "어제 할 일" in overdue())
c.patch("/api/tasks/%d" % a["id"], json={"done": True})
check("목록에서 평소처럼 체크하면 예전처럼 오늘 끝낸 것", database.get_task(a["id"])["done_at"][:10] == T)
c.patch("/api/tasks/%d" % a["id"], json={"done": False})

# ----- 여러 개 한꺼번에(전부 끝냈음), 섞인 경우 -----
none_date = database.add_task("날짜 없는 할 일", None)
future = database.add_task("내일 할 일", TOM)
today_task = database.add_task("오늘 할 일", T)
r = finish([a["id"], b["id"], 999999, none_date["id"], future["id"], today_task["id"]])
body = r.get_json()
check("여럿: 어제·사흘 전·오늘은 끝내고, 없는 것·날짜 없는 것·내일 것은 건너뜀",
      r.status_code == 200 and body["finished"] == [a["id"], b["id"], today_task["id"]] and body["skipped"] == [999999, none_date["id"], future["id"]], body)
check("각자 자기 날짜로 기록", [database.get_task(i)["done_at"] for i in (a["id"], b["id"], today_task["id"])] == [Y + "T23:59:59", Y3 + "T23:59:59", T + "T23:59:59"])
check("건너뛴 할 일은 그대로 안 끝남", database.get_task(none_date["id"])["done"] == 0 and database.get_task(future["id"])["done"] == 0)
check("밀린 할 일이 비었다", overdue() == [], overdue())

# ----- 하위 단계 -----
p = c.post("/api/projects", json={"name": "시험 프로젝트"}).get_json()
parent = database.add_task("상위 단계", Y, p["id"])
child1 = database.add_task("하위 1", Y3, p["id"], parent["id"])
child2 = database.add_task("하위 2", Y, p["id"], parent["id"])
check("하위 단계가 있는 상위 단계는 밀린 할 일에 나오지 않고 하위만 나온다", overdue() == ["하위 1", "하위 2"], overdue())
r = finish([parent["id"]])
check("상위 단계를 보내면 건너뛰고 하위 단계도 그대로",
      r.get_json()["skipped"] == [parent["id"]] and [database.get_task(i)["done"] for i in (parent["id"], child1["id"], child2["id"])] == [0, 0, 0], r.get_json())
r = finish([child1["id"]])
check("하위 단계는 자기 날짜로 끝낸다 (상위 단계 날짜가 아니라)", database.get_task(child1["id"])["done_at"] == Y3 + "T23:59:59" and database.get_task(parent["id"])["done"] == 0)
projects = c.get("/api/projects").get_json()
mine = [x for x in (projects if isinstance(projects, list) else projects.get("projects", [])) if x["id"] == p["id"]]
check("프로젝트 진행률이 반영된다 (하위 2개 중 1개)", bool(mine) and mine[0].get("percent") == 50, mine[0] if mine else projects)

# ----- 계획(시간표 블록)은 건드리지 않는다 -----
blocked = database.add_task("계획 있는 할 일", Y)
block = database.add_time_block(Y, 600, 660, "계획 있는 할 일", blocked["id"])
finish([blocked["id"]])
check("끝내도 그날 시간표의 계획은 그대로", database.get_time_block(block["id"]) is not None)

# ----- 잘못된 요청 -----
bad = [finish(v).status_code for v in ([], "1", [1, 1], [True], ["1"], None)]
check("ids가 빈 목록, 글자, 중복, true, 글자 번호, null이면 400", bad == [400] * 6, bad)
check("JSON이 아니면 400", c.post("/api/tasks/finish-on-planned-date", data="x").status_code == 400)
check("ids가 없으면 400", c.post("/api/tasks/finish-on-planned-date", json={}).status_code == 400)

# ----- 설정 -----
settings_store.OVERDUE_REVIEW_ENABLED_DEFAULT = True  # 시험 기본(fake_google이 끔) 대신 진짜 앱의 기본으로
check("진짜 앱의 기본: 정리 창 켜짐, 날짜는 빈 글자",
      settings_store.default_settings()["overdueReviewEnabled"] is True and settings_store.default_settings()["overdueReviewDate"] == "")
saved = c.put("/api/settings", json={"overdueReviewEnabled": False, "overdueReviewDate": T}).get_json()
check("켜기 여부와 날짜가 저장된다", saved["overdueReviewEnabled"] is False and saved["overdueReviewDate"] == T, saved)
check("다시 읽어도 그대로", c.get("/api/settings").get_json()["values"]["overdueReviewDate"] == T)
saved = c.put("/api/settings", json={"overdueReviewEnabled": "아니", "overdueReviewDate": "어제"}).get_json()
check("틀린 값(true/false 아님, 날짜 모양 아님)은 무시하고 저장된 값 그대로", saved["overdueReviewEnabled"] is False and saved["overdueReviewDate"] == T, saved)
saved = c.put("/api/settings", json={"overdueReviewDate": T + "x"}).get_json()
check("날짜 뒤에 글자가 붙어도 무시", saved["overdueReviewDate"] == T, saved)
saved = c.put("/api/settings", json={"overdueReviewEnabled": True, "overdueReviewDate": ""}).get_json()
check("빈 글자(아직 없음)와 켜기로 되돌릴 수 있다", saved["overdueReviewEnabled"] is True and saved["overdueReviewDate"] == "", saved)
check("다른 설정은 그대로", saved["fontSize"] == 16, saved["fontSize"])

print("\n실패 %d개" % failed if failed else "\n모두 통과")
sys.exit(1 if failed else 0)
