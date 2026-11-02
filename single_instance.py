# StudyFlow가 이미 켜져 있는지 확인하는 파일.
#
# 왜 필요한가: 바로가기를 두 번 누르면 창이 두 개 뜨고, 두 창이 같은 파일(settings.json, events_cache.json, token.json)을 서로 덮어쓴다.
# 특히 설정은 창이 들고 있는 값을 통째로 저장하므로, 한 창에서 바꾼 설정을 다른 창이 옛 값으로 되돌릴 수 있다.
#
# 어떻게: "잠금 파일"을 하나 만들고, 프로그램이 켜져 있는 동안 그 파일의 일부를 잠가 둔다(msvcrt.locking, 윈도우 기능).
# 이미 잠겨 있으면 다른 StudyFlow가 켜져 있다는 뜻이다. 프로그램이 끝나면(오류로 갑자기 꺼져도) 윈도우가 잠금을 알아서 풀어 주므로
# "꺼졌는데 잠금이 남아서 영영 못 켜는" 일이 없다.
import os
import shutil
import time

try:
    import msvcrt  # 윈도우에만 있는 도구. 다른 운영체제에서는 가져오기가 실패하므로 막지 않고 그냥 켠다
except ImportError:
    msvcrt = None

# 잠금 파일을 프로그램이 끝날 때까지 열어 둔다. 파일을 닫으면 잠금이 풀리므로 변수에 담아 두어야 한다
_lock_file = None

# 이미 잠겨 있을 때 다시 시도하며 기다리는 최대 시간(초).
# 창을 닫아도 앞 StudyFlow는 창 안의 브라우저(WebView2)가 끝나기를 최대 3초 기다리고 그 작업 폴더를 지운 뒤에야 끝난다.
# 그 사이에 다시 켜면 바로 "이미 켜져 있습니다"가 떴다(docs/review-2026-11.md의 N25). 그래서 잠깐 기다렸다가 다시 잡아 본다.
# 잠금을 앞 프로그램이 더 일찍 풀게 하지 않는 이유: 새 창이 지워지는 중인 그 작업 폴더를 쓰게 될 수 있어서다
WAIT_SECONDS = 5
RETRY_INTERVAL = 0.2


def acquire(lock_path, wait_seconds=WAIT_SECONDS):
    """이 프로그램이 하나만 켜지도록 lock_path의 잠금을 잡는다.
    잡았으면 True, 이미 다른 StudyFlow가 잡고 있으면 False를 돌려준다. 잠겨 있으면 최대 wait_seconds초 동안 다시 시도한다.
    잠금 파일을 아예 만들 수 없는 경우(읽기 전용 폴더 등)에는 사용자가 못 쓰게 되면 안 되므로 True를 돌려주고 그냥 켠다."""
    global _lock_file
    if msvcrt is None:
        return True
    try:
        lock_file = open(lock_path, "a+")  # a+: 없으면 만들고, 있으면 내용을 지우지 않고 연다
    except OSError:
        return True
    deadline = time.monotonic() + wait_seconds  # monotonic: 컴퓨터 시계를 바꿔도 거꾸로 가지 않는 시각. 기다린 시간을 잴 때 쓴다
    while True:
        try:
            lock_file.seek(0)
            # LK_NBLCK: 기다리지 않는 잠금. 이미 누가 잠갔으면 기다리지 않고 바로 OSError가 난다. 파일의 첫 1바이트만 잠근다
            msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
            break
        except OSError:
            if time.monotonic() >= deadline:
                lock_file.close()
                return False
            time.sleep(RETRY_INTERVAL)
    _lock_file = lock_file
    return True


# 창 안 브라우저의 작업 폴더를 비울 때 기다리는 최대 시간(초). 앞 브라우저가 이 안에 끝나지 않으면 그냥 켠다
PROFILE_WAIT_SECONDS = 10
PROFILE_FOLDER_NAME = "webview_profile"


def clear_webview_profile(profile_path, wait_seconds=PROFILE_WAIT_SECONDS):
    """창 안 브라우저(WebView2)의 작업 폴더를 켜기 직전에 비운다.

    왜: 창을 닫으면 pywebview가 브라우저가 끝나기를 3초까지만 기다린 뒤 이 폴더를 지운다. 브라우저가 더 오래 살아 있으면
    폴더가 반쯤만 지워진 채 앞 StudyFlow가 끝나고, 그때 새로 켜면 새 창이 아직 쓰이는 중인 폴더로 시작해서 화면만 뜨고
    달력이 비었다(docs/review-2026-11.md의 N25). 그래서 앞 브라우저가 폴더를 놓을 때까지(= 지워질 때까지) 다시 시도한다.
    이 폴더는 원래 창을 닫을 때마다 지우는 임시 폴더라 지워도 잃는 것이 없다.

    다 지웠으면(또는 원래 없었으면) True, 시간 안에 못 지웠으면 False를 돌려준다(그래도 켜기는 계속한다)."""
    # 실수 방지: 이 용도의 전용 폴더가 아니면 절대 지우지 않는다 (경로를 잘못 넘겨 내 데이터를 지우는 일이 없게)
    if os.path.basename(os.path.normpath(profile_path)) != PROFILE_FOLDER_NAME:
        return False
    deadline = time.monotonic() + wait_seconds
    while True:
        if not os.path.exists(profile_path):
            return True
        try:
            shutil.rmtree(profile_path)
            return True
        except OSError:
            # 앞 브라우저가 아직 파일을 쥐고 있다(WinError 32). 조금 뒤 남은 것을 다시 지워 본다
            if time.monotonic() >= deadline:
                return False
            time.sleep(RETRY_INTERVAL)


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
