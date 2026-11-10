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
import sys
import threading
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


def release():
    """잡고 있던 잠금을 푼다(잡은 적이 없으면 아무것도 안 한다). 프로그램을 끝내기 직전에 exit_now가 부른다.
    왜: os._exit를 불러도 윈도우가 프로세스를 실제로 거둬 가기까지 2초쯤 걸려서(측정), 그동안 다시 켠 쪽이 잠금을 기다렸다(N25)."""
    global _lock_file
    if _lock_file is None:
        return None
    try:
        _lock_file.seek(0)
        msvcrt.locking(_lock_file.fileno(), msvcrt.LK_UNLCK, 1)  # LK_UNLCK: 잠갔던 첫 1바이트를 푼다
    except OSError:
        pass  # 풀기에 실패해도 아래에서 파일을 닫으면 풀린다
    try:
        _lock_file.close()
    except OSError:
        pass
    _lock_file = None
    return None


# 창 안 브라우저(WebView2)의 작업 폴더 이름. 실행마다 "webview_profile-날짜시각-프로세스번호"로 새로 만든다.
#
# 왜 실행마다 새 폴더인가(docs/review-2026-11.md의 N25): 창을 닫아도 그 브라우저는 몇 초 더 살아 있으면서 작업 폴더를 쥐고 있다.
# 폴더가 하나뿐이면 닫자마자 다시 켤 때 새 창이 아직 쓰이는 중인(반쯤 지워진) 폴더로 시작해서 화면만 뜨고 달력이 비었고,
# 놓을 때까지 기다리게 하면 창이 2초쯤 늦게 떴다. 새 폴더를 쓰면 기다릴 필요가 없다.
# 남은 옛 폴더는 다음에 켤 때 remove_old_webview_profiles가 뒤에서 지운다. 이 폴더들은 창을 닫으면 버리는 임시 폴더라 지워도 잃는 것이 없다
PROFILE_PREFIX = "webview_profile"


def new_webview_profile(root):
    """이번 실행이 쓸 새 작업 폴더의 경로를 정한다 (만들기는 pywebview가 한다)."""
    stamp = time.strftime("%Y%m%d-%H%M%S")
    # time_ns로 같은 초에 두 번 불러도 이름이 겹치지 않게 한다
    return os.path.join(root, f"{PROFILE_PREFIX}-{stamp}-{os.getpid()}-{time.time_ns() % 1000000}")


def remove_old_webview_profiles(root, keep):
    """root 안의 옛 작업 폴더(webview_profile, webview_profile-…)를 keep만 빼고 지운다.
    앞 브라우저가 아직 쥐고 있는 파일은 기다리지 않고 남겨 둔다(다음에 켤 때 다시 지운다). 오류로 멈추지 않는다."""
    try:
        names = os.listdir(root)
    except OSError:
        return None
    for name in names:
        # 실수 방지: 이 용도의 폴더 이름만 지운다 (같은 폴더에 다른 것이 있어도 건드리지 않게)
        if name != PROFILE_PREFIX and not name.startswith(PROFILE_PREFIX + "-"):
            continue
        path = os.path.join(root, name)
        if os.path.normcase(os.path.abspath(path)) == os.path.normcase(os.path.abspath(keep)) or not os.path.isdir(path):
            continue
        # ignore_errors: 쥐고 있는 파일은 건너뛰고 나머지만 지운다
        shutil.rmtree(path, ignore_errors=True)
    return None


# 창 안 서버의 "접수 대기 자리" 수 (아래 widen_server_backlog)
SERVER_BACKLOG = 64


def widen_server_backlog():
    """pywebview가 띄우는 창 안 서버가 동시에 들어온 연결을 거절하지 않게, 접수를 기다리는 자리(backlog)를 5개에서 64개로 늘린다.
    pywebview는 파이썬 기본 서버(wsgiref의 WSGIServer)를 쓰는데, 이 서버는 접수(accept) 전의 연결을 5개까지만 줄 세운다.
    화면은 켜자마자 CSS·JS 파일 8~9개를 한꺼번에 요청한다. 그 순간 서버가 조금이라도 늦으면(켤 때 뒤에서 하는 일 등) 6번째부터
    Windows가 연결을 바로 거절하고, app.js를 못 받으면 메뉴만 보이고 달력이 비고 "동기화 확인 중..."에서 멈춘다
    (docs/review-2026-11.md의 N36. 2026-11-10 진짜 앱에서 임시 기록으로 잡았다: 5개만 서버에 오고 나머지는 서버에 닿기 전에 실패).
    클래스의 값을 바꾸므로 서버가 만들어지기 전(webview.start 전)에 불러야 한다. 이 프로그램에서 이 서버 종류는 창 안 서버 하나뿐이다."""
    from wsgiref.simple_server import WSGIServer
    WSGIServer.request_queue_size = SERVER_BACKLOG


# 창을 닫은 뒤 화면 요청(노트·메모 저장 등)이 끝나기를 기다리는 최대 시간(초)
REQUEST_WAIT_SECONDS = 5


def wait_for_other_threads(timeout=REQUEST_WAIT_SECONDS):
    """데몬이 아닌 다른 스레드(화면 요청을 처리하는 스레드 등)가 끝나기를 최대 timeout초 기다린다.
    창을 닫는 순간 화면이 보낸 노트·하루 메모 저장이 중간에 끊기지 않게 하려는 것이다.
    그래도 안 끝난 스레드의 이름 목록을 돌려준다 (다 끝났으면 빈 목록)."""
    deadline = time.monotonic() + timeout
    for thread in threading.enumerate():
        if thread is threading.current_thread() or thread.daemon:
            continue
        thread.join(max(0.0, deadline - time.monotonic()))
    return [t.name for t in threading.enumerate() if t is not threading.current_thread() and not t.daemon and t.is_alive()]


def exit_now(code=0):
    """파이썬의 종료 뒤처리를 건너뛰고 프로그램을 바로 끝낸다.

    왜(docs/review-2026-11.md의 N25): 창을 닫은 뒤 파이썬이 끝나는 절차에서 pywebview가 쓰는 .NET 연결 도구(pythonnet)가
    .NET을 "완전 종료"하는 데 3~6초가 걸렸다(측정). 그동안 두 번 켜기 방지 잠금이 풀리지 않아서, 닫고 바로 다시 켜면 그만큼 늦게 떴다.
    os._exit는 그 절차 없이 프로세스를 끝내고, 메모리·파일·잠금은 윈도우가 거둬 간다.
    그 전에 반드시 wait_for_other_threads로 화면 요청이 끝나기를 기다려야 한다. 출력(로그)은 여기서 비우고 끝낸다.
    두 번 켜기 방지 잠금도 여기서 직접 푼다. 이때는 저장할 것이 다 끝났고 브라우저 작업 폴더도 실행마다 따로라서, 새 StudyFlow가 바로 켜져도 부딪히지 않는다."""
    for stream in (sys.stdout, sys.stderr):
        try:
            if stream is not None:
                stream.flush()
        except Exception:
            pass
    release()
    os._exit(code)


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
