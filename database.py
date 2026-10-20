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


# 우선순위 탭의 중요도, 긴급도 범위는 -PRIORITY_LIMIT ~ PRIORITY_LIMIT (7×7 칸). 처음에는 5였다가 칸이 너무 작아 3으로 줄였다
PRIORITY_LIMIT = 3


def init_db():
    """프로그램을 켤 때 한 번 실행한다. tasks, projects 테이블이 없으면 만든다 (있으면 아무것도 하지 않는다)."""
    run("""
        CREATE TABLE IF NOT EXISTS projects (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            name           TEXT NOT NULL,                      -- 프로젝트 이름
            deadline       TEXT,                               -- 마감일 "2026-12-31". 없어도 된다(NULL)
            color          TEXT NOT NULL,                      -- 카드와 할 일에 붙는 색 "#4a7cff"
            progress_mode  TEXT NOT NULL DEFAULT 'auto',       -- 진행률 방식. 'auto'(할 일 완료 비율) 또는 'manual'(직접 입력)
            manual_percent INTEGER NOT NULL DEFAULT 0          -- 직접 입력한 %. 'manual'일 때만 쓴다
        )
    """)
    run("""
        CREATE TABLE IF NOT EXISTS tasks (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,  -- 할 일마다 자동으로 붙는 고유 번호
            content    TEXT NOT NULL,                      -- 할 일 내용
            date       TEXT,                               -- 하려는 날짜 "2026-10-19". 없어도 된다(NULL)
            done       INTEGER NOT NULL DEFAULT 0,         -- 완료 여부. 0이면 안 함, 1이면 함
            project_id INTEGER,                            -- 연결된 프로젝트(projects.id). 없어도 된다
            done_at    TEXT,                               -- 체크한 시각 "2026-10-19T14:30:05". 안 끝냈으면 NULL
            deadline   TEXT,                               -- 마감일 "2026-11-10". 언제까지 끝내야 하는지. 없어도 된다
            parent_id  INTEGER                             -- 상위 단계(tasks.id). 하위 단계일 때만 값이 있다
        )
    """)

    # D-day: "기말고사까지 D-50"처럼 이름과 날짜만 있는 작은 표. 프로젝트의 마감일과는 별개다 (시험은 프로젝트가 아니므로)
    run("""
        CREATE TABLE IF NOT EXISTS ddays (
            id    INTEGER PRIMARY KEY AUTOINCREMENT,
            name  TEXT NOT NULL,   -- 이름 "기말고사"
            date  TEXT NOT NULL,   -- 그날 "2026-12-10"
            color TEXT NOT NULL    -- 알약 앞의 색 동그라미 "#e8590c"
        )
    """)

    # 마이그레이션: 이미 만들어진 studyflow.db의 tasks 테이블에는 나중에 추가한 칸이 없을 수 있다.
    # CREATE TABLE IF NOT EXISTS는 테이블이 이미 있으면 아무것도 안 하므로, 없는 칸만 따로 덧붙인다.
    # PRAGMA table_info: 테이블에 어떤 칸들이 있는지 알려주는 SQLite 명령
    columns, _ = run("PRAGMA table_info(tasks)")
    existing = [column["name"] for column in columns]
    # importance(중요도), urgency(긴급도): 우선순위 탭(12단계)에서 평가한 -5~5 정수. 평가 안 한 할 일은 둘 다 NULL
    for name, column_type in (("done_at", "TEXT"), ("deadline", "TEXT"), ("parent_id", "INTEGER"),
                              ("importance", "INTEGER"), ("urgency", "INTEGER")):
        if name not in existing:
            run(f"ALTER TABLE tasks ADD COLUMN {name} {column_type}")

    # 범위가 줄어들기 전(-5~5)에 평가해 둔 값이 있으면 새 범위 안으로 맞춘다. MAX/MIN은 두 값 중 큰/작은 쪽을 고른다.
    # 이미 범위 안인 값은 그대로이고, 평가 안 한(NULL) 할 일은 건드리지 않는다
    run(
        "UPDATE tasks SET importance = MAX(?, MIN(?, importance)), urgency = MAX(?, MIN(?, urgency)) "
        "WHERE importance IS NOT NULL AND urgency IS NOT NULL",
        (-PRIORITY_LIMIT, PRIORITY_LIMIT, -PRIORITY_LIMIT, PRIORITY_LIMIT),
    )


# "하위 단계가 하나도 없는 할 일"만 고르는 조건. t는 tasks 표의 별명이다.
# 하위 단계가 있는 단계는 제목 역할만 하고, 실제로 하고 체크하는 것은 그 아래 하위 단계들이다.
# 그래서 오늘 탭 목록과 프로젝트 진행률 계산에서는 하위 단계가 없는 것만 센다.
# NOT EXISTS (SELECT ...): "이 조건에 맞는 줄이 하나도 없다"는 뜻. 여기서는 t를 부모로 삼는 줄이 없다는 뜻이다
NO_CHILDREN = "NOT EXISTS (SELECT 1 FROM tasks c WHERE c.parent_id = t.id)"


def list_tasks(date):
    """그 날짜의 할 일을 돌려준다. 안 끝낸 것이 위, 끝낸 것이 아래이고 그 안에서는 만든 순서다.
    그 날짜에 잡혀 있던 할 일에 더해, 다른 날짜로 잡혀 있었지만 그날 끝낸 할 일도 포함한다.
    (예: 17일에 적은 할 일을 19일에 체크했다면, 19일을 볼 때도 "19일에 끝낸 일"로 나온다)
    substr(done_at, 1, 10): 체크한 시각 글자의 앞 10글자, 즉 날짜 부분

    LEFT JOIN: tasks 옆에 projects 표를 붙여서, 각 할 일이 어느 프로젝트(이름, 색)인지 한 번에 가져온다.
    "t.project_id = p.id"가 맞는 줄끼리 이어 붙이고, 프로젝트가 없는 할 일(LEFT)은 그 칸이 비어(NULL) 있는 채로 남는다.
    t, p는 표 이름 tasks, projects의 짧은 별명이다.
    같은 방식으로 상위 단계(pt)의 내용도 붙여서, 하위 단계가 "어느 단계 아래의 일인지" 화면에 보여줄 수 있게 한다.
    하위 단계를 가진 단계(제목 역할)는 목록에서 뺀다."""
    rows, _ = run(
        "SELECT t.*, p.name AS project_name, p.color AS project_color, pt.content AS parent_content "
        "FROM tasks t LEFT JOIN projects p ON p.id = t.project_id "
        "LEFT JOIN tasks pt ON pt.id = t.parent_id "
        f"WHERE (t.date = ? OR (t.done = 1 AND substr(t.done_at, 1, 10) = ?)) AND {NO_CHILDREN} "
        "ORDER BY t.done, t.id",
        (date, date),
    )
    return rows


def list_overdue_tasks(today):
    """오늘 이전 날짜에 잡혀 있는데 끝내지 못한 할 일을 돌려준다. 날짜 순서대로.
    날짜가 없는(NULL) 프로젝트 단계는 "날짜 < 오늘"이 성립하지 않으므로 여기에 나오지 않는다."""
    rows, _ = run(
        "SELECT t.*, p.name AS project_name, p.color AS project_color, pt.content AS parent_content "
        "FROM tasks t LEFT JOIN projects p ON p.id = t.project_id "
        "LEFT JOIN tasks pt ON pt.id = t.parent_id "
        f"WHERE t.date < ? AND t.done = 0 AND {NO_CHILDREN} ORDER BY t.date, t.id",
        (today,),
    )
    return rows


def list_open_tasks():
    """우선순위 탭에 보여줄 할 일: 아직 안 끝냈고 하위 단계가 없는 모든 할 일 (날짜가 있든 없든, 지난 것이든 먼 미래든).
    평가한 것(importance, urgency가 있음)과 안 한 것(NULL)이 섞여 있고, 나누는 일은 화면이 한다."""
    rows, _ = run(
        "SELECT t.*, p.name AS project_name, p.color AS project_color, pt.content AS parent_content "
        "FROM tasks t LEFT JOIN projects p ON p.id = t.project_id "
        "LEFT JOIN tasks pt ON pt.id = t.parent_id "
        f"WHERE t.done = 0 AND {NO_CHILDREN} ORDER BY t.id"
    )
    return rows


def get_task(task_id):
    """할 일 하나를 돌려준다. 없으면 None."""
    rows, _ = run("SELECT * FROM tasks WHERE id = ?", (task_id,))
    return rows[0] if rows else None


def add_task(content, date, project_id=None, parent_id=None):
    """할 일을 하나 추가하고, 만들어진 할 일(번호 포함)을 돌려준다. date, project_id, parent_id는 없어도(None) 된다.
    parent_id가 있으면 그 단계 아래의 하위 단계가 된다."""
    with contextlib.closing(connect()) as connection:
        with connection:
            cursor = connection.execute(
                "INSERT INTO tasks (content, date, project_id, parent_id) VALUES (?, ?, ?, ?)",
                (content, date, project_id, parent_id),
            )
            # lastrowid: 방금 추가한 줄에 자동으로 붙은 번호
            row = connection.execute("SELECT * FROM tasks WHERE id = ?", (cursor.lastrowid,)).fetchone()
            return dict(row)


# 수정할 수 있는 칸의 이름들. 아래 update_row가 SQL 문장에 칸 이름을 직접 넣는데,
# 칸 이름은 ?로 안전하게 넘길 수 없다. 그래서 화면이 보낸 이름을 그대로 쓰지 않고, 이 목록에 있는 것만 쓴다
EDITABLE_COLUMNS = ("content", "date", "done", "done_at", "deadline", "importance", "urgency")


def update_task(task_id, changes):
    """changes({"done": 1} 처럼 바꿀 칸만 담은 딕셔너리)대로 할 일을 고친다. 그 번호의 할 일이 없으면 False."""
    if "done" in changes:
        # 체크하면 지금 시각을 기록하고, 체크를 풀면 기록을 지운다(None은 SQLite에서 NULL이 된다).
        # 화면이 보낸 값이 아니라 서버가 직접 정하므로, 시각을 속일 수 없다
        # isoformat(timespec="seconds"): 이 컴퓨터의 현재 시각을 "2026-10-19T14:30:05" 모양 글자로 만든다
        done_at = datetime.datetime.now().isoformat(timespec="seconds") if changes["done"] else None
        changes = {**changes, "done_at": done_at}

    return update_row("tasks", EDITABLE_COLUMNS, task_id, changes)


def update_row(table, allowed_columns, row_id, changes):
    """table의 row_id번 줄에서 changes에 들어 있는 칸만 고친다. 그 번호의 줄이 없으면 False.
    table과 allowed_columns는 이 파일 안의 고정된 값만 넘긴다. (SQL 문장에 직접 들어가므로 화면이 보낸 값을 쓰면 안 된다)"""
    columns = [column for column in allowed_columns if column in changes]
    if not columns:
        return False
    # 예: "content = ?, done = ?"
    assignments = ", ".join(f"{column} = ?" for column in columns)
    values = [changes[column] for column in columns]
    _, changed = run(f"UPDATE {table} SET {assignments} WHERE id = ?", (*values, row_id))
    return changed > 0


def delete_task(task_id):
    """할 일을 지운다. 그 번호의 할 일이 없으면 False.
    하위 단계가 있는 단계를 지우면 그 아래 하위 단계들도 함께 지운다. (상위가 없는 채로 남으면 어디에서도 안 보이기 때문이다)"""
    _, changed = run("DELETE FROM tasks WHERE id = ? OR parent_id = ?", (task_id, task_id))
    return changed > 0


# ---------- 프로젝트 ----------

def list_projects():
    """모든 프로젝트를 마감일이 가까운 순으로 돌려준다. 마감일이 없는 것은 맨 뒤.
    각 프로젝트에 연결된 할 일의 전체 개수(total)와 끝낸 개수(done_count)도 함께 센다.
    하위 단계가 있는 단계는 제목 역할이라 세지 않고 그 아래 하위 단계들을 센다. (LEFT JOIN의 ON 조건에 NO_CHILDREN을 넣어서,
    조건에 안 맞는 할 일은 "없는 셈"이 되고 프로젝트 줄 자체는 그대로 남는다)

    GROUP BY p.id: 프로젝트 하나당 한 줄로 묶는다. COUNT(t.id)는 묶인 할 일의 개수, SUM(t.done)은 done 값(0 또는 1)의 합,
    즉 끝낸 개수다. 할 일이 하나도 없는 프로젝트는 SUM이 NULL이 되어서 COALESCE(…, 0)으로 0을 대신 쓴다.
    ORDER BY p.deadline IS NULL: 마감일이 없는 줄이 뒤로 가게 한다 (IS NULL이 참이면 1이라서 0인 것들 다음에 온다)"""
    rows, _ = run(
        "SELECT p.*, COUNT(t.id) AS total, COALESCE(SUM(t.done), 0) AS done_count "
        f"FROM projects p LEFT JOIN tasks t ON t.project_id = p.id AND {NO_CHILDREN} "
        "GROUP BY p.id "
        "ORDER BY p.deadline IS NULL, p.deadline, p.id"
    )
    return rows


def list_project_tasks():
    """프로젝트에 연결된 모든 할 일을 돌려준다. 안 끝낸 것이 위, 끝낸 것이 아래이고 그 안에서는 만든 순서다."""
    rows, _ = run("SELECT * FROM tasks WHERE project_id IS NOT NULL ORDER BY done, id")
    return rows


def get_project(project_id):
    """프로젝트 하나를 돌려준다. 없으면 None."""
    rows, _ = run("SELECT * FROM projects WHERE id = ?", (project_id,))
    return rows[0] if rows else None


def add_project(name, deadline, color, progress_mode, manual_percent):
    """프로젝트를 하나 추가하고, 만들어진 프로젝트(번호 포함)를 돌려준다."""
    with contextlib.closing(connect()) as connection:
        with connection:
            cursor = connection.execute(
                "INSERT INTO projects (name, deadline, color, progress_mode, manual_percent) VALUES (?, ?, ?, ?, ?)",
                (name, deadline, color, progress_mode, manual_percent),
            )
            row = connection.execute("SELECT * FROM projects WHERE id = ?", (cursor.lastrowid,)).fetchone()
            return dict(row)


# 프로젝트에서 고칠 수 있는 칸들 (EDITABLE_COLUMNS와 같은 이유로 고정된 목록)
EDITABLE_PROJECT_COLUMNS = ("name", "deadline", "color", "progress_mode", "manual_percent")


def update_project(project_id, changes):
    """프로젝트의 changes에 든 칸만 고친다. 그 번호의 프로젝트가 없으면 False."""
    return update_row("projects", EDITABLE_PROJECT_COLUMNS, project_id, changes)


def delete_project(project_id):
    """프로젝트를 지운다. 없으면 False.
    연결된 할 일은 이렇게 처리한다:
    - 날짜가 있는 할 일은 지우지 않고 프로젝트 연결만 끊는다. 이미 그날의 기록(오늘 탭)에 들어 있는 것이라서다.
    - 날짜가 없는 할 일은 프로젝트 카드 안에서만 보이던 단계라서, 프로젝트와 함께 지운다.
      (연결만 끊으면 어디에서도 보이지 않는 채로 남기 때문이다)
    - 연결만 끊고 남기는 할 일은 상위 단계와의 관계(parent_id)도 끊는다. 상위 단계가 지워졌을 수 있기 때문이다.
    세 문장이 모두 성공하거나 모두 취소되도록 한 번의 거래(transaction)로 묶는다."""
    with contextlib.closing(connect()) as connection:
        with connection:
            connection.execute("DELETE FROM tasks WHERE project_id = ? AND date IS NULL", (project_id,))
            connection.execute(
                "UPDATE tasks SET project_id = NULL, parent_id = NULL WHERE project_id = ?", (project_id,)
            )
            cursor = connection.execute("DELETE FROM projects WHERE id = ?", (project_id,))
            return cursor.rowcount > 0


# ---------- D-day ----------

def list_ddays():
    """모든 D-day를 날짜가 빠른 순서로 돌려준다. (오늘 이후/이전을 나누는 것은 화면이 한다. 서버는 화면의 "오늘"을 모르기 때문이다)"""
    rows, _ = run("SELECT * FROM ddays ORDER BY date, id")
    return rows


def get_dday(dday_id):
    """D-day 하나를 돌려준다. 없으면 None."""
    rows, _ = run("SELECT * FROM ddays WHERE id = ?", (dday_id,))
    return rows[0] if rows else None


def add_dday(name, date, color):
    """D-day를 하나 추가하고, 만들어진 D-day(번호 포함)를 돌려준다."""
    with contextlib.closing(connect()) as connection:
        with connection:
            cursor = connection.execute(
                "INSERT INTO ddays (name, date, color) VALUES (?, ?, ?)", (name, date, color)
            )
            row = connection.execute("SELECT * FROM ddays WHERE id = ?", (cursor.lastrowid,)).fetchone()
            return dict(row)


# D-day에서 고칠 수 있는 칸들 (EDITABLE_COLUMNS와 같은 이유로 고정된 목록)
EDITABLE_DDAY_COLUMNS = ("name", "date", "color")


def update_dday(dday_id, changes):
    """D-day의 changes에 든 칸만 고친다. 그 번호의 D-day가 없으면 False."""
    return update_row("ddays", EDITABLE_DDAY_COLUMNS, dday_id, changes)


def delete_dday(dday_id):
    """D-day를 지운다. 없으면 False."""
    _, changed = run("DELETE FROM ddays WHERE id = ?", (dday_id,))
    return changed > 0
