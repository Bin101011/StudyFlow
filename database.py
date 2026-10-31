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


# DB 백업: studyflow.db는 할 일, 프로젝트, 메모의 유일한 사본이다(Git에도 안 올라간다). 그래서 하루에 한 번 복사본을 남겨 둔다.
# 복사본은 DB 파일 옆의 db_backup 폴더에 날짜 이름(studyflow-20261031.db)으로 쌓이고, 최근 KEEP_BACKUPS개만 남긴다.
# 복원하려면: 프로그램을 끄고, db_backup의 원하는 날짜 파일을 studyflow.db라는 이름으로 복사해 덮어쓴 뒤 다시 켠다.
BACKUP_FOLDER_NAME = "db_backup"
BACKUP_PREFIX = "studyflow-"
KEEP_BACKUPS = 14


def backup_db():
    """오늘 날짜의 백업이 아직 없으면 지금 DB를 복사해 둔다. 만든 파일의 경로를 돌려주고, 이미 있거나 만들 수 없으면 None이다.
    실패해도 프로그램이 멈추면 안 되므로 오류는 글자로 남기기만 한다.

    파일을 그냥 복사하면 그 순간 DB에 쓰는 중일 때 반쯤 쓰인 파일이 복사될 수 있다. 그래서 SQLite의 backup 기능을 쓴다.
    이 기능은 쓰는 중이어도 어느 한 순간의 온전한 모습을 복사한다.
    임시 이름(.tmp)으로 먼저 만든 뒤 이름을 바꾸므로, 복사하다 꺼져도 깨진 파일이 백업인 척 남지 않는다."""
    if not os.path.exists(DB_PATH):
        return None  # 처음 켜서 아직 DB가 없다
    backup_dir = os.path.join(os.path.dirname(DB_PATH), BACKUP_FOLDER_NAME)
    target = os.path.join(backup_dir, BACKUP_PREFIX + datetime.date.today().strftime("%Y%m%d") + ".db")
    if os.path.exists(target):
        return None  # 오늘 것은 이미 있다

    temp = target + ".tmp"
    try:
        os.makedirs(backup_dir, exist_ok=True)
        with contextlib.closing(sqlite3.connect(DB_PATH)) as source, contextlib.closing(sqlite3.connect(temp)) as copy:
            source.backup(copy)
        os.replace(temp, target)
        # 날짜 이름이라 글자 순서가 곧 날짜 순서다. 가장 오래된 것부터 지워서 최근 KEEP_BACKUPS개만 남긴다
        names = sorted(n for n in os.listdir(backup_dir) if n.startswith(BACKUP_PREFIX) and n.endswith(".db"))
        for name in names[:-KEEP_BACKUPS]:
            os.remove(os.path.join(backup_dir, name))
    except (OSError, sqlite3.Error) as error:
        print(f"[DB 백업 실패] {error}")
        return None
    finally:
        with contextlib.suppress(OSError):
            os.remove(temp)  # 실패해서 남은 임시 파일이 있으면 치운다 (성공했다면 이미 이름이 바뀌어 없다)
    return target


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

    # 프로젝트 폴더: 프로젝트가 많아졌을 때 묶어서 보려는 한 단계짜리 폴더. 폴더 안에 폴더는 없다
    run("""
        CREATE TABLE IF NOT EXISTS folders (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            name      TEXT NOT NULL,                  -- 폴더 이름 "2학기"
            collapsed INTEGER NOT NULL DEFAULT 0      -- 접어 둔 폴더인지. 0이면 펼침, 1이면 접힘
        )
    """)

    # 하루 메모: 오늘 탭에서 날짜마다 하나씩 적는 자유 메모. 날짜가 곧 번호(PRIMARY KEY)라서 하루에 메모가 하나뿐이다.
    # 내용을 모두 지우면 줄 자체를 지운다 (빈 메모를 남겨 두지 않는다)
    run("""
        CREATE TABLE IF NOT EXISTS day_memos (
            date    TEXT PRIMARY KEY,   -- 그날 "2026-10-19"
            content TEXT NOT NULL       -- 메모 내용
        )
    """)

    # 시간표의 "내 계획" 블록: 오늘 탭의 시간표에 "몇 시부터 몇 시까지 뭘 하겠다"고 적어 두는 블록. Google에는 보내지 않는다.
    # 시각은 그날 0시부터 몇 분이 지났는지(0~1440)로 저장한다 (예: 16:30 = 990). 하루 안에서만 만든다
    run("""
        CREATE TABLE IF NOT EXISTS time_blocks (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            date      TEXT NOT NULL,      -- 그날 "2026-10-28"
            start_min INTEGER NOT NULL,   -- 시작 (0시부터 몇 분째인지)
            end_min   INTEGER NOT NULL,   -- 끝 (포함하지 않는다)
            title     TEXT NOT NULL,      -- 블록에 적은 글. 할 일과 연결된 블록은 만들 때의 할 일 이름이 들어 있다
            task_id   INTEGER             -- 연결된 할 일(tasks.id). 없어도 된다
        )
    """)
    run("CREATE INDEX IF NOT EXISTS idx_time_blocks_date ON time_blocks (date)")
    # 이미 지워진 할 일에 연결된 채 남아 있는 블록을 정리한다. 할 일을 지울 때 블록을 같이 지우지 않던 옛 동작 때문에 생긴 것들이다
    run("DELETE FROM time_blocks WHERE task_id IS NOT NULL AND task_id NOT IN (SELECT id FROM tasks)")

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

    # sort_order: 오늘 탭의 할 일 목록에서 사용자가 끌어서 정한 순서(1, 2, 3…). 정한 적 없으면 NULL이고, NULL인 것은 정한 것들 뒤에 만든 순서로 온다.
    # 할 일의 날짜가 바뀌면 NULL로 되돌린다(그 날짜의 맨 뒤로 가도록). 새로 만든 할 일도 NULL이라 맨 뒤에 붙는다
    if "sort_order" not in existing:
        run("ALTER TABLE tasks ADD COLUMN sort_order INTEGER")
    # step_order: 프로젝트 탭에서 사용자가 끌어서 정한 단계 순서(같은 상위 단계 아래, 또는 맨 위 단계들끼리 1, 2, 3…).
    # 정한 적 없으면 NULL이고, NULL인 것은 정한 것들 뒤에 마감일 순으로 온다 (app.py의 build_step_tree)
    if "step_order" not in existing:
        run("ALTER TABLE tasks ADD COLUMN step_order INTEGER")
    # 할 일 메모: 할 일 줄 아래에 작은 글씨로 보이는 자유 메모. 이미 있던 할 일은 빈 글자("")로 시작한다 (DEFAULT '')
    if "memo" not in existing:
        run("ALTER TABLE tasks ADD COLUMN memo TEXT NOT NULL DEFAULT ''")

    # projects 표에도 folder_id(들어 있는 폴더, 없으면 NULL)를 덧붙인다
    columns, _ = run("PRAGMA table_info(projects)")
    if "folder_id" not in [column["name"] for column in columns]:
        run("ALTER TABLE projects ADD COLUMN folder_id INTEGER")
    # 프로젝트 메모: 프로젝트 카드에 붙이는 자유 메모. 이미 있던 프로젝트들은 빈 글자("")로 시작한다 (DEFAULT '')
    if "memo" not in [column["name"] for column in columns]:
        run("ALTER TABLE projects ADD COLUMN memo TEXT NOT NULL DEFAULT ''")

    # 인덱스(색인): 책 뒤의 "찾아보기"처럼, 표 전체를 처음부터 끝까지 훑지 않고 원하는 줄을 바로 찾게 해 주는 장치다.
    # 특히 parent_id가 중요하다. NO_CHILDREN("하위 단계가 있는가?")이 할 일 한 줄마다 "나를 부모로 삼는 줄이 있나?"를 묻는데,
    # 인덱스가 없으면 그때마다 표 전체를 훑어서 할 일이 늘수록 제곱으로 느려진다 (3,000개에서 우선순위 탭이 0.8초, 9,000개에서 10초).
    # 인덱스가 있으면 같은 일이 0.01초 안쪽이다. 끝낸 할 일도 지우지 않고 쌓이므로 오래 쓸수록 필요해진다.
    # 칸을 덧붙이는 마이그레이션이 모두 끝난 뒤에 만들어야 한다 (옛 DB에는 parent_id 칸이 이때까지 없을 수 있다).
    # IF NOT EXISTS라서 이미 있으면 아무것도 안 한다. 인덱스는 데이터를 바꾸지 않으므로 지워도 안전하다
    run("CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks (parent_id)")
    run("CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks (date)")
    run("CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks (project_id)")

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
        # 안 끝낸 것이 위, 끝낸 것이 아래. 그 안에서는 사용자가 정한 순서(sort_order), 정한 적 없는 것(NULL)은 그 뒤에 만든 순서로.
        # "t.sort_order IS NULL"은 NULL이면 1, 아니면 0이라서 순서를 정한 것들이 먼저 온다
        "ORDER BY t.done, t.sort_order IS NULL, t.sort_order, t.id",
        (date, date),
    )
    return rows


def list_tasks_between(start, end):
    """start 이상, end 미만 날짜로 잡혀 있는 할 일들을 날짜, 안 끝낸 것 먼저, 만든 순서로 돌려준다. (캘린더 탭에 날짜별로 보여주려는 것)
    그 날짜에 "하려고 정한" 할 일(date)만 센다. 날짜 없는 프로젝트 단계나 마감일(deadline)은 여기에 나오지 않는다.
    하위 단계를 가진 단계는 제목 역할이라서 오늘 탭 목록과 같이 뺀다(NO_CHILDREN). 끝낸 할 일도 포함한다(끝낸 개수를 보여주려고).
    t.date >= ? AND t.date < ?: "2026-10-19" 같은 글자는 글자 순서가 곧 날짜 순서라서 그대로 비교할 수 있다"""
    rows, _ = run(
        "SELECT t.id, t.content, t.date, t.done, p.name AS project_name, p.color AS project_color "
        "FROM tasks t LEFT JOIN projects p ON p.id = t.project_id "
        f"WHERE t.date >= ? AND t.date < ? AND {NO_CHILDREN} "
        "ORDER BY t.date, t.done, t.id",
        (start, end),
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


def list_inbox_tasks():
    """"할 일 목록(수집함)"에 보여줄 할 일: 날짜도 프로젝트도 없고 아직 안 끝낸 할 일을 만든 순서대로 돌려준다.
    오늘 탭 오른쪽 패널에서 날짜를 정해 주려고 모아 둔 것이다. 프로젝트에 연결된 단계는 프로젝트 카드에서 다루므로 여기에 나오지 않는다.
    (날짜를 정하면 date가 채워져서 이 목록에서 빠지고 그날의 할 일이 된다. 날짜를 다시 빼면 이 목록으로 돌아온다)"""
    rows, _ = run(
        "SELECT * FROM tasks WHERE project_id IS NULL AND date IS NULL AND parent_id IS NULL AND done = 0 ORDER BY id"
    )
    return rows


def list_open_tasks():
    """우선순위 탭에 보여줄 할 일: 아직 안 끝낸 "큰 단위"의 할 일들 (날짜가 있든 없든, 지난 것이든 먼 미래든).
    큰 단위란 맨 위 단계(parent_id가 없는 것)다. 하위 단계(예: "책 읽기" 아래의 "1장", "2장")는 따로 보여주지 않고,
    그 하위 단계를 가진 상위 단계("책 읽기") 하나로 묶어서 보여준다. 평가(importance, urgency)도 상위 단계에 붙는다.
    - 하위 단계가 없는 단계: 자기가 안 끝났으면 나온다
    - 하위 단계가 있는 단계: 하위 단계 중 하나라도 안 끝났으면 나온다 (자기 done 값은 쓰지 않는다. 하위 단계 상태로 계산한다)
    child_total, child_done은 하위 단계의 전체/끝낸 개수이고, 마감일이 없는 상위 단계는 안 끝낸 하위 단계 중 가장 빠른 마감일을 대신 쓴다.
    평가한 것(importance, urgency가 있음)과 안 한 것(NULL)이 섞여 있고, 나누는 일은 화면이 한다."""
    # 안쪽 SELECT에서 개수를 계산하고, 바깥 SELECT에서 그 개수로 걸러낸다
    rows, _ = run(
        "SELECT * FROM ("
        "  SELECT t.*, p.name AS project_name, p.color AS project_color, "
        "         (SELECT COUNT(*) FROM tasks c WHERE c.parent_id = t.id) AS child_total, "
        "         (SELECT COUNT(*) FROM tasks c WHERE c.parent_id = t.id AND c.done = 1) AS child_done, "
        "         (SELECT MIN(c.deadline) FROM tasks c WHERE c.parent_id = t.id AND c.done = 0 AND c.deadline IS NOT NULL) AS child_deadline "
        "  FROM tasks t LEFT JOIN projects p ON p.id = t.project_id "
        "  WHERE t.parent_id IS NULL"
        ") WHERE (child_total = 0 AND done = 0) OR (child_total > 0 AND child_done < child_total) "
        "ORDER BY id"
    )
    for row in rows:
        row["deadline"] = row["deadline"] or row["child_deadline"]
        row["parent_content"] = None  # 맨 위 단계라서 상위 단계가 없다 (화면 코드와의 호환용)
    return rows


def reorder_tasks(date, ids):
    """그 날짜의 할 일들의 순서를 ids에 적힌 순서(1, 2, 3…)로 정한다. ids에 없는 할 일(끝낸 것 등)은 건드리지 않는다.
    날짜가 date가 아닌 할 일은 무시한다(다른 날의 순서를 망가뜨리지 않으려는 안전장치). 바꾼 개수를 돌려준다.
    여러 줄을 고치므로 한 번의 거래(transaction)로 묶어서, 중간에 실패해도 순서가 반쯤만 바뀌지 않게 한다."""
    changed = 0
    with contextlib.closing(connect()) as connection:
        with connection:
            for position, task_id in enumerate(ids, start=1):
                cursor = connection.execute(
                    "UPDATE tasks SET sort_order = ? WHERE id = ? AND date = ?", (position, task_id, date)
                )
                changed += cursor.rowcount
    return changed


def reorder_steps(project_id, parent_id, ids):
    """프로젝트 단계들의 순서를 ids에 적힌 순서(1, 2, 3…)로 정한다. parent_id가 None이면 맨 위 단계들끼리, 있으면 그 단계의 하위 단계들끼리다.
    ids 중 그 프로젝트의 그 묶음에 속하지 않는 것은 무시한다(다른 묶음의 순서를 망가뜨리지 않으려는 안전장치). 바꾼 개수를 돌려준다.
    "parent_id IS ?"는 값이 None일 때 "IS NULL"처럼 동작한다 ("= NULL"은 SQLite에서 항상 거짓이라 쓸 수 없다).
    reorder_tasks와 같이 한 번의 거래로 묶는다."""
    changed = 0
    with contextlib.closing(connect()) as connection:
        with connection:
            for position, task_id in enumerate(ids, start=1):
                cursor = connection.execute(
                    "UPDATE tasks SET step_order = ? WHERE id = ? AND project_id = ? AND parent_id IS ?",
                    (position, task_id, project_id, parent_id),
                )
                changed += cursor.rowcount
    return changed


def clear_step_order(project_id):
    """그 프로젝트의 모든 단계(하위 단계 포함)에서 직접 정한 순서를 지운다. 그러면 단계들이 다시 마감일 순으로 보인다. 지운 개수를 돌려준다."""
    _, changed = run("UPDATE tasks SET step_order = NULL WHERE project_id = ? AND step_order IS NOT NULL", (project_id,))
    return changed


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
EDITABLE_COLUMNS = ("content", "date", "done", "done_at", "deadline", "importance", "urgency", "memo")


def update_task(task_id, changes):
    """changes({"done": 1} 처럼 바꿀 칸만 담은 딕셔너리)대로 할 일을 고친다. 그 번호의 할 일이 없으면 False."""
    if "done" in changes:
        # 체크하면 지금 시각을 기록하고, 체크를 풀면 기록을 지운다(None은 SQLite에서 NULL이 된다).
        # 화면이 보낸 값이 아니라 서버가 직접 정하므로, 시각을 속일 수 없다
        # isoformat(timespec="seconds"): 이 컴퓨터의 현재 시각을 "2026-10-19T14:30:05" 모양 글자로 만든다
        done_at = datetime.datetime.now().isoformat(timespec="seconds") if changes["done"] else None
        changes = {**changes, "done_at": done_at}

    updated = update_row("tasks", EDITABLE_COLUMNS, task_id, changes)
    # 날짜가 바뀌면 시간표에 배치해 둔 계획 블록 중 그 날짜가 아닌 것은 지운다("내일로", "목록으로", "빼기" 등).
    # 블록은 하루 안의 시각이라 다른 날로 옮겨진 할 일에는 의미가 없고, 남겨 두면 할 일이 없는 날에 계획만 남기 때문이다.
    # 같은 날짜로 다시 정하면 그 날짜의 블록은 그대로 둔다. 날짜를 비우면(None) 모든 블록을 지운다
    if updated and "date" in changes:
        # 날짜가 바뀌면 이전 날짜에서 정했던 순서도 의미가 없으므로 비운다(새 날짜의 맨 뒤에서 시작한다)
        run("UPDATE tasks SET sort_order = NULL WHERE id = ?", (task_id,))
        if changes["date"] is None:
            run("DELETE FROM time_blocks WHERE task_id = ?", (task_id,))
        else:
            run("DELETE FROM time_blocks WHERE task_id = ? AND date != ?", (task_id, changes["date"]))
    # 하위 단계를 가진 단계를 "완료"하면(우선순위 탭의 완료 메뉴) 아직 안 끝낸 하위 단계도 함께 끝낸 것으로 한다.
    # 하위 단계가 없는 할 일은 해당 줄이 없어서 아무 일도 일어나지 않는다
    if updated and changes.get("done"):
        run("UPDATE tasks SET done = 1, done_at = ? WHERE parent_id = ? AND done = 0", (changes["done_at"], task_id))
    return updated


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
    # 시간표에 배치해 둔 계획 블록도 함께 지운다 (할 일이 사라졌는데 시간표에 남아 있으면 안 되므로). 하위 단계의 블록도 같다.
    # 할 일을 지우기 전에 해야 한다: 지운 뒤에는 어느 블록이 이 할 일의 것인지 찾을 수 없다
    run(
        "DELETE FROM time_blocks WHERE task_id = ? OR task_id IN (SELECT id FROM tasks WHERE parent_id = ?)",
        (task_id, task_id),
    )
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


def add_project(name, deadline, color, progress_mode, manual_percent, folder_id=None, memo=""):
    """프로젝트를 하나 추가하고, 만들어진 프로젝트(번호 포함)를 돌려준다. folder_id는 넣을 폴더(없으면 None), memo는 카드에 붙일 메모다."""
    with contextlib.closing(connect()) as connection:
        with connection:
            cursor = connection.execute(
                "INSERT INTO projects (name, deadline, color, progress_mode, manual_percent, folder_id, memo) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (name, deadline, color, progress_mode, manual_percent, folder_id, memo),
            )
            row = connection.execute("SELECT * FROM projects WHERE id = ?", (cursor.lastrowid,)).fetchone()
            return dict(row)


# 프로젝트에서 고칠 수 있는 칸들 (EDITABLE_COLUMNS와 같은 이유로 고정된 목록)
EDITABLE_PROJECT_COLUMNS = ("name", "deadline", "color", "progress_mode", "manual_percent", "folder_id", "memo")


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
            # 함께 지워지는 할 일의 시간표 블록도 지운다 (할 일이 먼저 지워지면 어느 블록인지 찾을 수 없으니 먼저 한다)
            connection.execute(
                "DELETE FROM time_blocks WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ? AND date IS NULL)",
                (project_id,),
            )
            connection.execute("DELETE FROM tasks WHERE project_id = ? AND date IS NULL", (project_id,))
            connection.execute(
                "UPDATE tasks SET project_id = NULL, parent_id = NULL WHERE project_id = ?", (project_id,)
            )
            cursor = connection.execute("DELETE FROM projects WHERE id = ?", (project_id,))
            return cursor.rowcount > 0


# ---------- 프로젝트 폴더 ----------

def list_folders():
    """모든 폴더를 만든 순서대로 돌려준다. 폴더마다 안에 든 프로젝트 수(project_count)도 센다.
    LEFT JOIN: 프로젝트가 하나도 없는 빈 폴더도 줄이 남는다"""
    rows, _ = run(
        "SELECT f.*, COUNT(p.id) AS project_count "
        "FROM folders f LEFT JOIN projects p ON p.folder_id = f.id "
        "GROUP BY f.id ORDER BY f.id"
    )
    return rows


def get_folder(folder_id):
    """폴더 하나를 돌려준다. 없으면 None."""
    rows, _ = run("SELECT * FROM folders WHERE id = ?", (folder_id,))
    return rows[0] if rows else None


def add_folder(name):
    """폴더를 하나 추가하고, 만들어진 폴더(번호 포함)를 돌려준다."""
    with contextlib.closing(connect()) as connection:
        with connection:
            cursor = connection.execute("INSERT INTO folders (name) VALUES (?)", (name,))
            row = connection.execute("SELECT * FROM folders WHERE id = ?", (cursor.lastrowid,)).fetchone()
            return dict(row)


# 폴더에서 고칠 수 있는 칸들 (다른 EDITABLE_* 목록과 같은 이유로 고정된 목록)
EDITABLE_FOLDER_COLUMNS = ("name", "collapsed")


def update_folder(folder_id, changes):
    """폴더의 changes에 든 칸만 고친다. 그 번호의 폴더가 없으면 False."""
    return update_row("folders", EDITABLE_FOLDER_COLUMNS, folder_id, changes)


def delete_folder(folder_id):
    """폴더를 지운다. 없으면 False. 안에 든 프로젝트는 지우지 않고 "폴더 없음"으로 돌려놓는다(folder_id를 비운다).
    두 문장이 모두 성공하거나 모두 취소되도록 한 번의 거래(transaction)로 묶는다."""
    with contextlib.closing(connect()) as connection:
        with connection:
            connection.execute("UPDATE projects SET folder_id = NULL WHERE folder_id = ?", (folder_id,))
            cursor = connection.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
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


# ---------- 시간표의 "내 계획" 블록 ----------

# 블록을 읽는 SELECT. 할 일과 연결된 블록은 할 일의 지금 이름과 완료 여부를 같이 가져온다.
# 연결된 할 일을 지우면 블록도 함께 지워진다(delete_task, delete_project). LEFT JOIN은 혹시 연결이 끊긴 블록이 있어도
# 읽다가 오류가 나지 않게 하는 안전장치다. 그때는 t.id가 비어서 task_id가 NULL이 되고 제목은 블록에 저장해 둔 글(b.title)이 쓰인다
TIME_BLOCK_SELECT = """
    SELECT b.id, b.date, b.start_min, b.end_min,
           COALESCE(t.content, b.title) AS title,
           t.id AS task_id, t.done AS task_done
    FROM time_blocks b LEFT JOIN tasks t ON t.id = b.task_id
"""


def list_time_blocks(date):
    """그날의 계획 블록들을 시작 시각 순서로 돌려준다."""
    rows, _ = run(TIME_BLOCK_SELECT + " WHERE b.date = ? ORDER BY b.start_min, b.id", (date,))
    return rows


def get_time_block(block_id):
    """블록 하나를 돌려준다. 없으면 None."""
    rows, _ = run(TIME_BLOCK_SELECT + " WHERE b.id = ?", (block_id,))
    return rows[0] if rows else None


def add_time_block(date, start_min, end_min, title, task_id=None):
    """계획 블록을 하나 만들고, 만들어진 블록(번호 포함)을 돌려준다."""
    with contextlib.closing(connect()) as connection:
        with connection:
            cursor = connection.execute(
                "INSERT INTO time_blocks (date, start_min, end_min, title, task_id) VALUES (?, ?, ?, ?, ?)",
                (date, start_min, end_min, title, task_id),
            )
            block_id = cursor.lastrowid
    return get_time_block(block_id)


# 블록에서 고칠 수 있는 칸들 (EDITABLE_COLUMNS와 같은 이유로 고정된 목록. 날짜와 연결된 할 일은 바꾸지 않는다)
EDITABLE_TIME_BLOCK_COLUMNS = ("start_min", "end_min", "title")


def update_time_block(block_id, changes):
    """블록의 changes에 든 칸만 고친다. 그 번호의 블록이 없으면 False."""
    return update_row("time_blocks", EDITABLE_TIME_BLOCK_COLUMNS, block_id, changes)


def delete_time_block(block_id):
    """블록을 지운다. 없으면 False."""
    _, changed = run("DELETE FROM time_blocks WHERE id = ?", (block_id,))
    return changed > 0


# ---------- 하루 메모 ----------

def get_day_memo(date):
    """그날의 메모 내용을 돌려준다. 메모가 없으면 빈 글자."""
    rows, _ = run("SELECT content FROM day_memos WHERE date = ?", (date,))
    return rows[0]["content"] if rows else ""


def set_day_memo(date, content):
    """그날의 메모를 저장한다. 내용이 비어 있으면(공백뿐인 경우도) 메모를 지운다."""
    if content.strip() == "":
        run("DELETE FROM day_memos WHERE date = ?", (date,))
        return
    # ON CONFLICT ... DO UPDATE: 그 날짜의 메모가 이미 있으면 새로 만들지 않고 내용만 바꾼다 (없으면 새로 만든다)
    run(
        "INSERT INTO day_memos (date, content) VALUES (?, ?) "
        "ON CONFLICT(date) DO UPDATE SET content = excluded.content",
        (date, content),
    )
