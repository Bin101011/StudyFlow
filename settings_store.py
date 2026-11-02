import datetime
import json
import os
import threading

# 이 파일이 있는 폴더. settings.json을 항상 같은 자리에 두기 위함
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SETTINGS_PATH = os.path.join(BASE_DIR, "settings.json")

# 슬라이더 설정들의 정의. 이름(key), 화면에 보일 이름(label), 범위(min~max), 눈금 간격(step), 기본값(default).
# 화면(설정 탭)은 이 목록을 받아서 슬라이더를 만든다. 그래서 설정을 추가하고 싶으면 여기에 한 줄만 더하면 된다
SLIDER_DEFINITIONS = [
    {"key": "fontSize", "label": "글자 크기", "min": 9, "max": 20, "step": 0.5, "default": 16, "unit": "px"},
    {"key": "monthCellHeight", "label": "월간 칸 높이", "min": 60, "max": 250, "step": 5, "default": 100, "unit": "px"},
    {"key": "timeSlotHeight", "label": "주간/일간 시간 칸 높이", "min": 14, "max": 60, "step": 2, "default": 24, "unit": "px"},
    {"key": "cellMaxWidth", "label": "칸 최대 너비", "min": 100, "max": 200, "step": 5, "default": 200, "unit": "px"},
    {"key": "eventGap", "label": "일정 블록 간격", "min": 0, "max": 5, "step": 0.5, "default": 1, "unit": "px"},
    {"key": "sidebarWidth", "label": "내 캘린더 목록 너비", "min": 120, "max": 300, "step": 5, "default": 200, "unit": "px"},
    # 글자 간격(자간). em은 "글자 크기의 몇 배"라서 글자 크기를 바꿔도 같은 비율로 유지된다. 0은 글꼴 기본, 음수는 좁게, 양수는 넓게 (기본값 0.015는 사용자가 정했다)
    {"key": "letterSpacing", "label": "글자 간격", "min": -0.05, "max": 0.1, "step": 0.005, "default": 0.015, "unit": "em"},
]

# Pomodoro 타이머(11단계)의 슬라이더 설정들. 모양은 위와 같지만 "화면 크기"가 아니라 설정 탭의 Pomodoro 칸에 따로 보인다.
# 시간 단위는 분. 긴 휴식은 집중을 N번 끝낼 때마다 한 번 들어간다
POMODORO_SLIDER_DEFINITIONS = [
    {"key": "pomodoroFocus", "label": "집중 시간", "min": 1, "max": 120, "step": 1, "default": 25, "unit": "분"},
    {"key": "pomodoroShortBreak", "label": "짧은 휴식", "min": 1, "max": 30, "step": 1, "default": 5, "unit": "분"},
    {"key": "pomodoroLongBreak", "label": "긴 휴식", "min": 1, "max": 60, "step": 1, "default": 15, "unit": "분"},
    {"key": "pomodoroLongEvery", "label": "긴 휴식까지 집중 횟수", "min": 2, "max": 8, "step": 1, "default": 4, "unit": "번"},
]

# 오늘 탭의 슬라이더 설정들. 설정 탭의 "오늘 탭" 칸에 따로 보인다.
# 시간표 너비: 오늘 탭 왼쪽 시간표 칸의 가로 길이. 기본값 400은 처음 만들 때의 값이고, 넓히면 겹친 블록의 제목이 덜 잘리지만 가운데 할 일 칸이 좁아진다
TODAY_SLIDER_DEFINITIONS = [
    {"key": "timelineWidth", "label": "시간표 너비", "min": 380, "max": 550, "step": 10, "default": 400, "unit": "px"},
]

# 숫자 슬라이더 설정 전체 (clean_settings와 default_settings가 같이 쓴다)
ALL_SLIDER_DEFINITIONS = SLIDER_DEFINITIONS + POMODORO_SLIDER_DEFINITIONS + TODAY_SLIDER_DEFINITIONS

# 슬라이더가 아닌 설정들
# 1) 일정을 추가할 때 미리 선택될 캘린더의 id (빈 글자면 "정하지 않음")
DEFAULT_CALENDAR_KEY = "defaultCalendarId"
# 2) "내 캘린더" 목록에서 체크를 꺼서 숨기기로 한 캘린더들의 id 리스트
HIDDEN_CALENDARS_KEY = "hiddenCalendarIds"

# 3) 종일 일정의 긴 제목을 줄바꿈해서 다 보여줄지 (True/False). 끄면 한 줄로 두고 길면 "…"로 줄인다
WRAP_ALL_DAY_KEY = "wrapAllDay"

# 4) Pomodoro 타이머가 끝났을 때 알림 소리를 낼지 (True/False)
POMODORO_SOUND_KEY = "pomodoroSound"

# 노트 탭(13단계): Obsidian vault 폴더의 경로, 마지막으로 연 노트(vault 안의 상대 경로)
VAULT_PATH_KEY = "vaultPath"
LAST_NOTE_KEY = "lastNote"
MAX_SETTING_TEXT = 500  # 경로 글자 수 한계 (이상한 값이 와도 설정 파일이 부풀지 않게)

# 월간 캘린더의 표시 줄 수(몇 주를 보여줄지): 6줄 또는 7줄. 7줄이면 5주짜리 달은 다음 달 2주, 6주짜리 달은 다음 달 1주가 붙는다.
# 그 달이 필요한 주 수보다 줄어들지는 않는다(화면이 max로 정한다). 기본 6줄은 예전 화면과 같은 모양이다
MONTH_ROWS_KEY = "monthRows"
MONTH_ROWS_ALLOWED = (6, 7)
MONTH_ROWS_DEFAULT = 6

# 프로젝트 탭의 카드 배치: 카드를 몇 열로 늘어놓을지 (2, 3, 4열. 1열은 없앴다. 창이 좁으면 화면이 알아서 1열로 보여준다)
PROJECT_COLUMNS_KEY = "projectColumns"
PROJECT_COLUMNS_ALLOWED = (2, 3, 4)
PROJECT_COLUMNS_DEFAULT = 2

# 프로젝트 탭의 폴더 배치: 폴더를 한 줄(1열)로 쌓을지, 두 줄(2열)로 나눠 놓을지. 2열은 카드 열 수가 4일 때만 화면이 적용한다
PROJECT_FOLDER_COLUMNS_KEY = "projectFolderColumns"
PROJECT_FOLDER_COLUMNS_ALLOWED = (1, 2)
PROJECT_FOLDER_COLUMNS_DEFAULT = 1

# StudyFlow에서 만든 캘린더의 id들. 이것만 "완전히 지우기"를 보여 준다(다른 캘린더는 "목록에서 빼기"). 이 컴퓨터에서 만든 것만 기억한다
CREATED_CALENDARS_KEY = "createdCalendarIds"
MAX_CREATED_CALENDARS = 200

# 5) 사용자가 끌어서 옮겨 둔 타이머 위젯의 위치 ({"x": 왼쪽에서, "y": 위에서}, 단위 px). None이면 원래 자리(상단 바 가운데)
POMODORO_POSITION_KEY = "pomodoroPosition"
# 이상한 값이 들어와도 화면 밖 아주 먼 곳으로 가지 않게 하는 한계. 실제 화면 안으로 맞추는 일은 화면(app.js)이 한다
MAX_POSITION = 20000

# 6) 오늘 탭 시간표의 확대 정도: 한 시간의 세로 길이(px). 두 손가락으로 벌리거나 오므리면(또는 +/- 버튼) 바뀌고 껐다 켜도 유지된다.
# 범위와 기본값은 화면(app.js의 TL_HOUR_MIN/MAX/DEFAULT)과 같아야 한다
TIMELINE_HOUR_PX_KEY = "timelineHourPx"
TIMELINE_HOUR_PX_MIN = 36
TIMELINE_HOUR_PX_MAX = 160
TIMELINE_HOUR_PX_DEFAULT = 64

# 저장 파일을 읽고 쓰는 동안 다른 요청이 끼어들지 못하게 하는 열쇠
_lock = threading.Lock()

# 깨진 settings.json을 옆으로 옮겨 두었다는 안내. 다음 설정 읽기(/api/settings)가 한 번 화면에 전하고 비운다
_broken_notice = None


class SettingsUnreadable(Exception):
    """settings.json이 있는데 읽지 못했다(다른 프로그램이 잡고 있는 등).
    이때 기본값을 주거나 저장하면 진짜 설정을 기본값으로 덮어쓰게 되므로, 읽기와 저장을 모두 거부한다."""


UNREADABLE_MESSAGE = "설정 파일(settings.json)을 읽지 못했습니다. 다른 프로그램이 쓰고 있을 수 있어요. 잠시 뒤 StudyFlow를 껐다 켜 보세요."


def default_settings():
    """모든 설정의 기본값을 딕셔너리로 만든다."""
    settings = {d["key"]: d["default"] for d in ALL_SLIDER_DEFINITIONS}
    settings[DEFAULT_CALENDAR_KEY] = ""
    settings[HIDDEN_CALENDARS_KEY] = []
    settings[WRAP_ALL_DAY_KEY] = True
    settings[POMODORO_SOUND_KEY] = True
    settings[POMODORO_POSITION_KEY] = None
    settings[VAULT_PATH_KEY] = ""
    settings[LAST_NOTE_KEY] = ""
    settings[PROJECT_COLUMNS_KEY] = PROJECT_COLUMNS_DEFAULT
    settings[PROJECT_FOLDER_COLUMNS_KEY] = PROJECT_FOLDER_COLUMNS_DEFAULT
    settings[CREATED_CALENDARS_KEY] = []
    settings[TIMELINE_HOUR_PX_KEY] = TIMELINE_HOUR_PX_DEFAULT
    settings[MONTH_ROWS_KEY] = MONTH_ROWS_DEFAULT
    return settings


def clean_settings(raw, base=None):
    """받은 값에서 알고 있는 설정만 골라, 숫자는 허용 범위 안으로 맞춰서 돌려준다.
    파일이 망가졌거나 이상한 값이 와도 프로그램이 멈추지 않게 하는 안전장치다.
    base(지금 저장된 설정)를 주면 raw에 없거나 틀린 값은 base의 값을 그대로 쓴다. 안 주면 기본값으로 채운다."""
    settings = dict(base) if base is not None else default_settings()
    if not isinstance(raw, dict):
        return settings

    for d in ALL_SLIDER_DEFINITIONS:
        value = raw.get(d["key"])
        # bool은 파이썬에서 숫자의 한 종류라서 따로 걸러낸다
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            settings[d["key"]] = max(d["min"], min(d["max"], value))  # min~max 범위 밖이면 끝값으로

    calendar_id = raw.get(DEFAULT_CALENDAR_KEY)
    if isinstance(calendar_id, str):
        settings[DEFAULT_CALENDAR_KEY] = calendar_id

    hidden = raw.get(HIDDEN_CALENDARS_KEY)
    if isinstance(hidden, list):
        # 글자로 된 id만 남긴다
        settings[HIDDEN_CALENDARS_KEY] = [item for item in hidden if isinstance(item, str)]

    wrap = raw.get(WRAP_ALL_DAY_KEY)
    if isinstance(wrap, bool):  # 켜기/끄기 값은 true/false만 인정한다
        settings[WRAP_ALL_DAY_KEY] = wrap

    sound = raw.get(POMODORO_SOUND_KEY)
    if isinstance(sound, bool):
        settings[POMODORO_SOUND_KEY] = sound

    position = raw.get(POMODORO_POSITION_KEY)
    if position is None and POMODORO_POSITION_KEY in raw:
        # null은 "원래 자리로 되돌리기"라는 뜻이다 (base에 위치가 있어도 지운다)
        settings[POMODORO_POSITION_KEY] = None
    elif isinstance(position, dict):
        x, y = position.get("x"), position.get("y")
        # 숫자(bool 제외)이고 한계 안일 때만 인정한다. nan, 무한대는 비교가 거짓이 되어 걸러진다
        if all(isinstance(v, (int, float)) and not isinstance(v, bool) and -MAX_POSITION <= v <= MAX_POSITION for v in (x, y)):
            settings[POMODORO_POSITION_KEY] = {"x": round(x), "y": round(y)}

    hour_px = raw.get(TIMELINE_HOUR_PX_KEY)
    # 숫자(bool 제외)면 범위 안으로 맞춘다. nan, 무한대는 비교가 거짓이라 걸러진다
    if isinstance(hour_px, (int, float)) and not isinstance(hour_px, bool) and hour_px == hour_px and abs(hour_px) != float("inf"):
        settings[TIMELINE_HOUR_PX_KEY] = round(max(TIMELINE_HOUR_PX_MIN, min(TIMELINE_HOUR_PX_MAX, hour_px)))

    month_rows = raw.get(MONTH_ROWS_KEY)
    if isinstance(month_rows, int) and not isinstance(month_rows, bool) and month_rows in MONTH_ROWS_ALLOWED:
        settings[MONTH_ROWS_KEY] = month_rows

    columns = raw.get(PROJECT_COLUMNS_KEY)
    # bool은 파이썬에서 정수의 한 종류(True == 1)라서 따로 걸러낸다
    if isinstance(columns, int) and not isinstance(columns, bool) and columns in PROJECT_COLUMNS_ALLOWED:
        settings[PROJECT_COLUMNS_KEY] = columns

    folder_columns = raw.get(PROJECT_FOLDER_COLUMNS_KEY)
    if isinstance(folder_columns, int) and not isinstance(folder_columns, bool) and folder_columns in PROJECT_FOLDER_COLUMNS_ALLOWED:
        settings[PROJECT_FOLDER_COLUMNS_KEY] = folder_columns

    created = raw.get(CREATED_CALENDARS_KEY)
    if isinstance(created, list):
        # 글자로 된 id만, 너무 길거나 많지 않게 남긴다 (설정 파일이 부풀지 않게)
        settings[CREATED_CALENDARS_KEY] = [item for item in created if isinstance(item, str) and 0 < len(item) <= MAX_SETTING_TEXT][:MAX_CREATED_CALENDARS]

    for key in (VAULT_PATH_KEY, LAST_NOTE_KEY):
        text = raw.get(key)
        if isinstance(text, str) and len(text) <= MAX_SETTING_TEXT:
            settings[key] = text.strip()
    return settings


def _move_broken_file():
    """깨진 settings.json을 같은 폴더의 settings.broken-날짜-시각.json으로 옮기고 그 경로를 돌려준다.
    옮기지 않으면 다음 저장이 덮어써서 옛 내용을 영영 볼 수 없다 (손으로 되살릴 기회를 남긴다)."""
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    base = os.path.join(os.path.dirname(SETTINGS_PATH), "settings.broken-" + stamp)
    path, number = base + ".json", 1
    while os.path.exists(path):  # 같은 초에 두 번 깨지는 일은 드물지만, 그래도 앞의 사본을 덮지 않게 번호를 붙인다
        number += 1
        path = f"{base}-{number}.json"
    os.rename(SETTINGS_PATH, path)
    return path


def _read_locked():
    """settings.json을 읽어 정리한 값을 돌려준다. _lock을 쥔 채로 불러야 한다.
    - 파일이 없으면(처음 실행) 기본값
    - 내용이 깨졌으면(정전으로 빈 파일이 된 경우 등) 그 파일을 옆으로 옮겨 두고 기본값
    - 그 밖의 이유로 읽지 못하면 SettingsUnreadable"""
    global _broken_notice
    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
            return clean_settings(json.load(f))
    except FileNotFoundError:
        return default_settings()
    # ValueError: JSON 형식이 깨졌거나(JSONDecodeError) 글자 인코딩이 이상한(UnicodeDecodeError) 경우를 모두 포함한다
    except ValueError:
        try:
            moved = _move_broken_file()
        except OSError as error:
            raise SettingsUnreadable(UNREADABLE_MESSAGE) from error
        print(f"[설정 파일 깨짐] {moved}로 옮겨 두고 기본값으로 시작합니다")
        _broken_notice = f"설정 파일이 깨져 있어서 기본값으로 시작했습니다. 옛 파일은 {os.path.basename(moved)}로 남겨 두었습니다."
        return default_settings()
    except OSError as error:
        print(f"[설정 읽기 실패] {error}")
        raise SettingsUnreadable(UNREADABLE_MESSAGE) from error


def _write_locked(settings):
    """정리된 설정을 settings.json에 쓴다. _lock을 쥔 채로 불러야 한다."""
    # 임시 파일에 먼저 쓰고 한 번에 바꿔치기(os.replace)한다.
    # 쓰는 도중에 프로그램이 꺼져도 settings.json이 반쯤 쓰인 채로 남지 않는다
    temp_path = SETTINGS_PATH + ".tmp"
    with open(temp_path, "w", encoding="utf-8") as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)
    os.replace(temp_path, SETTINGS_PATH)


def load_settings():
    """settings.json을 읽어서 돌려준다. 파일이 없거나 깨졌으면 기본값, 읽지 못하면 SettingsUnreadable."""
    with _lock:
        return _read_locked()


def pop_broken_notice():
    """깨진 설정 파일을 옮겨 두었다는 안내를 한 번 꺼낸다 (없으면 None)."""
    global _broken_notice
    with _lock:
        notice, _broken_notice = _broken_notice, None
    return notice


def save_settings(raw):
    """받은 값을 지금 저장된 설정에 합쳐서 settings.json에 저장하고, 저장된 설정 전체를 돌려준다.
    받은 값에 없는 설정이나 틀린 값은 저장된 값을 그대로 둔다(일부만 보내도 나머지가 기본값으로 지워지지 않는다).
    지금 설정을 읽지 못하면 덮어쓰지 않고 SettingsUnreadable을 낸다."""
    with _lock:
        settings = clean_settings(raw, base=_read_locked())
        _write_locked(settings)
    return settings


def add_created_calendar(calendar_id):
    """StudyFlow가 만든 캘린더의 id를 기록한다. 캘린더를 만든 서버가 바로 적어 두므로,
    그 뒤 화면의 설정 저장이 실패하거나 앱이 꺼져도 그 캘린더를 StudyFlow에서 "삭제"할 수 있다."""
    with _lock:
        settings = _read_locked()
        ids = [i for i in settings[CREATED_CALENDARS_KEY] if i != calendar_id] + [calendar_id]
        # 개수 한계를 넘으면 오래된 것부터 뺀다 (새로 만든 것이 잘리지 않게)
        settings = clean_settings({CREATED_CALENDARS_KEY: ids[-MAX_CREATED_CALENDARS:]}, base=settings)
        _write_locked(settings)
