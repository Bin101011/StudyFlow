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
]

# 슬라이더가 아닌 설정 두 가지
# 1) 일정을 추가할 때 미리 선택될 캘린더의 id (빈 글자면 "정하지 않음")
DEFAULT_CALENDAR_KEY = "defaultCalendarId"
# 2) "내 캘린더" 목록에서 체크를 꺼서 숨기기로 한 캘린더들의 id 리스트
HIDDEN_CALENDARS_KEY = "hiddenCalendarIds"

# 저장 파일을 읽고 쓰는 동안 다른 요청이 끼어들지 못하게 하는 열쇠
_lock = threading.Lock()


def default_settings():
    """모든 설정의 기본값을 딕셔너리로 만든다."""
    settings = {d["key"]: d["default"] for d in SLIDER_DEFINITIONS}
    settings[DEFAULT_CALENDAR_KEY] = ""
    settings[HIDDEN_CALENDARS_KEY] = []
    return settings


def clean_settings(raw):
    """받은 값에서 알고 있는 설정만 골라, 숫자는 허용 범위 안으로 맞춰서 돌려준다.
    파일이 망가졌거나 이상한 값이 와도 프로그램이 멈추지 않게 하는 안전장치다."""
    settings = default_settings()
    if not isinstance(raw, dict):
        return settings

    for d in SLIDER_DEFINITIONS:
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
    return settings


def load_settings():
    """settings.json을 읽어서 돌려준다. 파일이 없거나 읽을 수 없으면 기본값을 돌려준다."""
    with _lock:
        try:
            with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
                return clean_settings(json.load(f))
        # ValueError: JSON 형식이 깨졌거나(JSONDecodeError) 글자 인코딩이 이상한(UnicodeDecodeError) 경우를 모두 포함한다
        except (OSError, ValueError):
            return default_settings()


def save_settings(raw):
    """설정을 정리해서 settings.json에 저장하고, 저장된 값을 돌려준다."""
    settings = clean_settings(raw)
    with _lock:
        # 임시 파일에 먼저 쓰고 한 번에 바꿔치기(os.replace)한다.
        # 쓰는 도중에 프로그램이 꺼져도 settings.json이 반쯤 쓰인 채로 남지 않는다
        temp_path = SETTINGS_PATH + ".tmp"
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(settings, f, ensure_ascii=False, indent=2)
        os.replace(temp_path, SETTINGS_PATH)
    return settings
