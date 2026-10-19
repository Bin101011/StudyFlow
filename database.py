# 할 일을 저장하는 SQLite 데이터베이스(studyflow.db)를 다루는 파일.
# SQLite는 표(테이블) 형태로 데이터를 저장하는 데이터베이스인데, 파일 하나(studyflow.db)에 전부 들어간다.
# 파이썬에 sqlite3가 기본으로 들어 있어서 따로 설치할 것이 없다.
import contextlib
import datetime
import os
import sqlite3

# 이 파일이 있는 폴더에 studyflow.db를 만든다 (settings.json과 같은 방식)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "studyflow.db")


def connect():
    """데이터베이스 연결을 하나 열어서 돌려준다.
    Flask는 요청마다 다른 스레드에서 실행되고, sqlite3 연결은 만든 스레드에서만 쓸 수 있다.
    그래서 연결을 계속 들고 있지 않고, 필요할 때마다 새로 열고 쓰고 닫는다. (로컬 파일이라 빠르다)"""
    connection = sqlite3.connect(DB_PATH)
    # 결과 한 줄(row)을 task["content"]처럼 이름으로 꺼낼 수 있게 한다
    connection.row_factory = sqlite3.Row
    return connection


def run(sql, params=()):
    """SQL 문장 하나를 실행하고, 변경 사항을 저장(commit)하고, 연결을 닫는다.
    돌려주는 값은 (결과 줄들의 리스트, 바뀐 줄 수)다.
    sql 안의 ?는 params의 값이 순서대로 들어갈 자리다. 값을 글자로 이어 붙이지 않고 이렇게 따로 넘겨야
    '); DROP TABLE tasks; --' 같은 입력으로 데이터베이스를 망가뜨리는 공격(SQL 인젝션)을 막을 수 있다"""
    # closing: with 블록이 끝나면 연결을 자동으로 닫아준다
    with contextlib.closing(connect()) as connection:
        # connection 자체를 with로 쓰면: 성공하면 commit(저장), 오류가 나면 rollback(취소)한다
        with connection:
            cursor = connection.execute(sql, params)
            rows = [dict(row) for row in cursor.fetchall()]
            return rows, cursor.rowcount


def init_db():
    """프로그램을 켤 때 한 번 실행한다. tasks 테이블이 없으면 만든다 (있으면 아무것도 하지 않는다)."""
    run("""
        CREATE TABLE IF NOT EXISTS tasks (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,  -- 할 일마다 자동으로 붙는 고유 번호
            content    TEXT NOT NULL,                      -- 할 일 내용
            date       TEXT,                               -- 하려는 날짜 "2026-10-19". 없어도 된다(NULL)
            done       INTEGER NOT NULL DEFAULT 0,         -- 완료 여부. 0이면 안 함, 1이면 함
            project_id INTEGER,                            -- 연결된 프로젝트 번호. 7단계에서 쓴다. 없어도 된다
            done_at    TEXT                                -- 체크한 시각 "2026-10-19T14:30:05". 안 끝냈으면 NULL
        )
    """)

    # 마이그레이션: 6단계 처음 버전으로 이미 만들어진 studyflow.db에는 done_at 칸이 없다.
    # CREATE TABLE IF NOT EXISTS는 테이블이 이미 있으면 아무것도 안 하므로, 칸이 없을 때만 따로 덧붙인다.
    # PRAGMA table_info: 테이블에 어떤 칸들이 있는지 알려주는 SQLite 명령
    columns, _ = run("PRAGMA table_info(tasks)")
    if "done_at" not in [column["name"] for column in columns]:
        run("ALTER TABLE tasks ADD COLUMN done_at TEXT")


def list_tasks(date):
    """그 날짜의 할 일을 돌려준다. 안 끝낸 것이 위, 끝낸 것이 아래이고 그 안에서는 만든 순서다.
    그 날짜에 잡혀 있던 할 일에 더해, 다른 날짜로 잡혀 있었지만 그날 끝낸 할 일도 포함한다.
    (예: 17일에 적은 할 일을 19일에 체크했다면, 19일을 볼 때도 "19일에 끝낸 일"로 나온다)
    substr(done_at, 1, 10): 체크한 시각 글자의 앞 10글자, 즉 날짜 부분"""
    rows, _ = run(
        "SELECT * FROM tasks "
        "WHERE date = ? OR (done = 1 AND substr(done_at, 1, 10) = ?) "
        "ORDER BY done, id",
        (date, date),
    )
    return rows


def list_overdue_tasks(today):
    """오늘 이전 날짜에 잡혀 있는데 끝내지 못한 할 일을 돌려준다. 날짜 순서대로."""
    rows, _ = run("SELECT * FROM tasks WHERE date < ? AND done = 0 ORDER BY date, id", (today,))
    return rows


def add_task(content, date):
    """할 일을 하나 추가하고, 만들어진 할 일(번호 포함)을 돌려준다."""
    with contextlib.closing(connect()) as connection:
        with connection:
            cursor = connection.execute(
                "INSERT INTO tasks (content, date) VALUES (?, ?)", (content, date)
            )
            # lastrowid: 방금 추가한 줄에 자동으로 붙은 번호
            row = connection.execute("SELECT * FROM tasks WHERE id = ?", (cursor.lastrowid,)).fetchone()
            return dict(row)


# 수정할 수 있는 칸의 이름들. 아래 update_task가 SQL 문장에 칸 이름을 직접 넣는데,
# 칸 이름은 ?로 안전하게 넘길 수 없다. 그래서 화면이 보낸 이름을 그대로 쓰지 않고, 이 목록에 있는 것만 쓴다
EDITABLE_COLUMNS = ("content", "date", "done", "done_at")


def update_task(task_id, changes):
    """changes({"done": 1} 처럼 바꿀 칸만 담은 딕셔너리)대로 할 일을 고친다. 그 번호의 할 일이 없으면 False."""
    if "done" in changes:
        # 체크하면 지금 시각을 기록하고, 체크를 풀면 기록을 지운다(None은 SQLite에서 NULL이 된다).
        # 화면이 보낸 값이 아니라 서버가 직접 정하므로, 시각을 속일 수 없다
        # isoformat(timespec="seconds"): 이 컴퓨터의 현재 시각을 "2026-10-19T14:30:05" 모양 글자로 만든다
        done_at = datetime.datetime.now().isoformat(timespec="seconds") if changes["done"] else None
        changes = {**changes, "done_at": done_at}

    columns = [column for column in EDITABLE_COLUMNS if column in changes]
    if not columns:
        return False
    # 예: "content = ?, done = ?"
    assignments = ", ".join(f"{column} = ?" for column in columns)
    values = [changes[column] for column in columns]
    _, changed = run(f"UPDATE tasks SET {assignments} WHERE id = ?", (*values, task_id))
    return changed > 0


def delete_task(task_id):
    """할 일을 지운다. 그 번호의 할 일이 없으면 False."""
    _, changed = run("DELETE FROM tasks WHERE id = ?", (task_id,))
    return changed > 0
