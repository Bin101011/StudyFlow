# StudyFlow가 이미 켜져 있는지 확인하는 파일.
#
# 왜 필요한가: 바로가기를 두 번 누르면 창이 두 개 뜨고, 두 창이 같은 파일(settings.json, events_cache.json, token.json)을 서로 덮어쓴다.
# 특히 설정은 창이 들고 있는 값을 통째로 저장하므로, 한 창에서 바꾼 설정을 다른 창이 옛 값으로 되돌릴 수 있다.
#
# 어떻게: "잠금 파일"을 하나 만들고, 프로그램이 켜져 있는 동안 그 파일의 일부를 잠가 둔다(msvcrt.locking, 윈도우 기능).
# 이미 잠겨 있으면 다른 StudyFlow가 켜져 있다는 뜻이다. 프로그램이 끝나면(오류로 갑자기 꺼져도) 윈도우가 잠금을 알아서 풀어 주므로
# "꺼졌는데 잠금이 남아서 영영 못 켜는" 일이 없다.
import os

try:
    import msvcrt  # 윈도우에만 있는 도구. 다른 운영체제에서는 가져오기가 실패하므로 막지 않고 그냥 켠다
except ImportError:
    msvcrt = None

# 잠금 파일을 프로그램이 끝날 때까지 열어 둔다. 파일을 닫으면 잠금이 풀리므로 변수에 담아 두어야 한다
_lock_file = None


def acquire(lock_path):
    """이 프로그램이 하나만 켜지도록 lock_path의 잠금을 잡는다.
    잡았으면 True, 이미 다른 StudyFlow가 잡고 있으면 False를 돌려준다.
    잠금 파일을 아예 만들 수 없는 경우(읽기 전용 폴더 등)에는 사용자가 못 쓰게 되면 안 되므로 True를 돌려주고 그냥 켠다."""
    global _lock_file
    if msvcrt is None:
        return True
    try:
        lock_file = open(lock_path, "a+")  # a+: 없으면 만들고, 있으면 내용을 지우지 않고 연다
    except OSError:
        return True
    try:
        lock_file.seek(0)
        # LK_NBLCK: 기다리지 않는 잠금. 이미 누가 잠갔으면 기다리지 않고 바로 OSError가 난다. 파일의 첫 1바이트만 잠근다
        msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        lock_file.close()
        return False
    _lock_file = lock_file
    return True


def show_already_running_message():
    """"이미 켜져 있다"는 안내 상자를 띄운다. 바로가기로 켜면 터미널(검은 창)이 없어서, 글자만 출력하면 사용자가 아무것도 못 본다."""
    try:
        import ctypes

        # MessageBoxW(창, 내용, 제목, 종류): 0x40은 'i' 정보 아이콘 + 확인 버튼
        ctypes.windll.user32.MessageBoxW(
            0,
            "StudyFlow가 이미 켜져 있습니다.\n\n창이 안 보이면 작업 표시줄을 확인해 보세요. 방금 닫았다면 몇 초 뒤에 다시 실행하세요.",
            "StudyFlow",
            0x40,
        )
    except Exception:
        pass  # 안내 상자가 안 떠도 프로그램을 끄는 것은 그대로다
