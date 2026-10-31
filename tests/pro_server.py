# 프로젝트 단계 순서 / 프로젝트 색 테스트용 서버 (가짜 Google + 임시 DB)
import os, sys, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_google
fake = fake_google.install()
import event_cache, app, database

app.event_store = event_cache.EventCache(os.path.join(fake_google.TMP, "cache.json"))
database.init_db()

folder = database.add_folder("공부")
RED, GREEN, BLUE = "#ff0000", "#00aa00", "#0000ff"
database.add_project("영어 단어", "2026-12-01", RED, "auto", 0, folder["id"])
database.add_project("영어 듣기", "2026-12-02", RED, "auto", 0, folder["id"])
database.add_project("수학 미적분", "2026-12-03", GREEN, "auto", 0, folder["id"])
database.add_project("역사 하나", "2026-12-04", BLUE, "auto", 0, folder["id"])
database.add_project("영어 독서", None, "#f08c00", "auto", 0, None)   # 폴더 없음, 다른 색

# 단계 순서 시험용 프로젝트 (폴더 없음)
P = database.add_project("정렬 프로젝트", "2026-12-31", "#4a7cff", "auto", 0, None)
def step(content, deadline=None, parent=None, done=False):
    t = database.add_task(content, None, P["id"], parent)
    changes = {}
    if deadline: changes["deadline"] = deadline
    if done: changes["done"] = 1; changes["done_at"] = "2026-10-29T10:00:00"
    if changes: database.update_task(t["id"], changes)
    return t
ga = step("가 마감 없음")
na = step("나 12/10", "2026-12-10")
da = step("다 11/05", "2026-11-05")
ra = step("라 하위 있음 11/01", "2026-11-01")
step("라-1 12/01", "2026-12-01", ra["id"])
step("라-2 11/20", "2026-11-20", ra["id"])
step("라-3 마감 없음", None, ra["id"])
step("마 끝낸 단계", None, None, True)

# 다른 카드(끌어서 다른 카드에 놓는 시험용)
Q = database.add_project("다른 프로젝트", "2026-12-20", "#2f9e44", "auto", 0, None)
database.add_task("다른-1", None, Q["id"])
database.add_task("다른-2", None, Q["id"])

app.app.run(port=5057, threaded=True)
