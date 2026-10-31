"""DB 인덱스와 DB 백업(database.py) 시험. 전부 임시 폴더의 DB로 하고, 진짜 studyflow.db는 건드리지 않는다."""
import contextlib
import os
import random
import sqlite3
import sys
import tempfile
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_google  # noqa: E402,F401  (프로젝트 폴더를 import 경로에 넣고, DB 경로를 임시 폴더로 바꿔 둔다)
import database  # noqa: E402

failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + (f"  [{detail}]" if detail and not condition else ""))
    if not condition:
        failures.append(name)


def new_db_path():
    return os.path.join(tempfile.mkdtemp(prefix="studyflow_dbtest_"), "studyflow.db")


def index_names():
    rows, _ = database.run("SELECT name FROM sqlite_master WHERE type='index'")
    return {row["name"] for row in rows}


# ===== 인덱스 =====
WANTED = {"idx_tasks_parent", "idx_tasks_date", "idx_tasks_project"}

database.DB_PATH = new_db_path()
database.init_db()
check("새 DB에 인덱스 3개가 생김", WANTED <= index_names(), str(index_names()))
database.init_db()
check("init_db를 두 번 해도 오류 없음 (프로그램을 다시 켠 경우)", True)

# 옛 DB: parent_id, sort_order 같은 나중에 덧붙인 칸이 없는 tasks 표
old_path = new_db_path()
with contextlib.closing(sqlite3.connect(old_path)) as conn:
    conn.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, date TEXT, "
                 "done INTEGER NOT NULL DEFAULT 0, project_id INTEGER)")
    conn.execute("INSERT INTO tasks (content, date) VALUES ('옛 할 일', '2026-10-19')")
    conn.commit()
database.DB_PATH = old_path
database.init_db()
check("옛 DB: 칸을 덧붙이는 마이그레이션 뒤에 인덱스가 생김", WANTED <= index_names(), str(index_names()))
check("옛 DB: 기존 할 일이 그대로 남음", database.run("SELECT content FROM tasks")[0][0]["content"] == "옛 할 일")

plan = database.run("EXPLAIN QUERY PLAN SELECT 1 FROM tasks c WHERE c.parent_id = 1")[0][0]["detail"]
check("하위 단계 조회가 인덱스를 씀", "idx_tasks_parent" in plan, plan)

# 속도: 할 일이 9,000개일 때도 우선순위 탭/프로젝트 목록 쿼리가 빨라야 한다 (인덱스가 없으면 각각 10초, 6초 걸렸다)
database.DB_PATH = new_db_path()
database.init_db()
random.seed(1)
with contextlib.closing(database.connect()) as conn, conn:
    for p in range(60):
        conn.execute("INSERT INTO projects (name, color) VALUES (?, '#4a7cff')", (f"p{p}",))
    for i in range(3000):
        cursor = conn.execute(
            "INSERT INTO tasks (content, date, project_id, done) VALUES (?, ?, ?, ?)",
            (f"t{i}", f"2026-{random.randint(1, 12):02d}-{random.randint(1, 28):02d}", random.randint(1, 60), random.randint(0, 1)),
        )
        for _ in range(2):
            conn.execute("INSERT INTO tasks (content, project_id, parent_id, done) VALUES ('c', 1, ?, ?)",
                         (cursor.lastrowid, random.randint(0, 1)))
for name, function in (("list_open_tasks", database.list_open_tasks), ("list_projects", database.list_projects),
                       ("list_overdue_tasks", lambda: database.list_overdue_tasks("2026-12-31"))):
    started = time.perf_counter()
    function()
    seconds = time.perf_counter() - started
    check(f"할 일 9,000개에서 {name}이 0.5초 안에 끝남", seconds < 0.5, f"{seconds:.2f}초")

# ===== 백업 =====
database.DB_PATH = new_db_path()
backup_dir = os.path.join(os.path.dirname(database.DB_PATH), database.BACKUP_FOLDER_NAME)

check("DB가 아직 없으면 None이고 폴더도 안 만든다", database.backup_db() is None and not os.path.exists(backup_dir))

database.init_db()
database.add_task("백업 시험", "2026-10-31")
path = database.backup_db()
check("오늘 날짜 백업 파일이 생김", path is not None and os.path.exists(path), str(path))
check("파일 이름이 studyflow-날짜.db 모양", bool(path) and os.path.basename(path).startswith("studyflow-") and path.endswith(".db"))
with contextlib.closing(sqlite3.connect(path)) as conn:
    rows = conn.execute("SELECT content FROM tasks").fetchall()
check("백업 안에 할 일이 그대로 들어 있음", rows == [("백업 시험",)], str(rows))
check("임시(.tmp) 파일이 남지 않음", not [n for n in os.listdir(backup_dir) if n.endswith(".tmp")])

check("오늘 것이 이미 있으면 None (덮어쓰지 않음)", database.backup_db() is None)
database.add_task("백업 후에 추가", "2026-10-31")
database.backup_db()
with contextlib.closing(sqlite3.connect(path)) as conn:
    count = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
check("같은 날 다시 불러도 첫 백업을 그대로 둠", count == 1, str(count))

# 오래된 백업 정리: 20개를 미리 만들어 두고 오늘 것을 새로 만들면 KEEP_BACKUPS개만 남아야 한다
os.remove(path)
for day in range(1, 21):
    open(os.path.join(backup_dir, f"studyflow-202601{day:02d}.db"), "w").close()
other = os.path.join(backup_dir, "내 메모.txt")
open(other, "w").close()
path = database.backup_db()
names = sorted(n for n in os.listdir(backup_dir) if n.startswith("studyflow-"))
check(f"최근 {database.KEEP_BACKUPS}개만 남음", len(names) == database.KEEP_BACKUPS, str(len(names)))
check("오늘 것은 남음", os.path.basename(path) in names)
check("가장 오래된 것부터 지워짐", "studyflow-20260101.db" not in names and "studyflow-20260120.db" in names)
check("이름 모양이 다른 파일은 안 건드림", os.path.exists(other))

# 쓰는 도중에 복사해도 온전한 DB가 나와야 한다
os.remove(path)
stop = threading.Event()


def writer():
    i = 0
    while not stop.is_set():
        database.add_task(f"동시 {i}", "2026-10-31")
        i += 1


thread = threading.Thread(target=writer)
thread.start()
path = database.backup_db()
stop.set()
thread.join()
with contextlib.closing(sqlite3.connect(path)) as conn:
    integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
check("쓰는 도중에 복사해도 무결성 검사 통과", integrity == "ok", integrity)

# 실패해도 프로그램이 멈추지 않는다: db_backup 자리에 같은 이름의 "파일"이 있으면 폴더를 만들 수 없다
database.DB_PATH = new_db_path()
database.init_db()
open(os.path.join(os.path.dirname(database.DB_PATH), database.BACKUP_FOLDER_NAME), "w").close()
check("폴더를 못 만들면 예외 없이 None", database.backup_db() is None)

print("\n실패:", failures if failures else "없음")
sys.exit(1 if failures else 0)
