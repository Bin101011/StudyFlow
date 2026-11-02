"""이중 실행 방지(single_instance.py) 시험. 프로세스를 여러 개 띄워서 진짜로 잠금이 서로를 막는지 본다."""
import os
import subprocess
import sys
import tempfile
import time

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_DIR)
import single_instance  # noqa: E402

failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + (f"  [{detail}]" if detail and not condition else ""))
    if not condition:
        failures.append(name)


lock_path = os.path.join(tempfile.mkdtemp(prefix="studyflow_lock_"), "studyflow.lock")


def run_child(code):
    """파이썬 프로세스를 띄워 code를 실행한다. 시작 직후 첫 줄을 읽을 수 있게 Popen을 돌려준다."""
    return subprocess.Popen(
        [sys.executable, "-c", "import sys; sys.path.insert(0, %r); import single_instance, time\n%s" % (PROJECT_DIR, code)],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=PROJECT_DIR,
    )


# 0) 창을 닫은 직후 다시 켜기 (docs/review-2026-11.md의 N25). 창은 사라져도 앞 프로그램은 WebView2 정리 때문에 1~3초 더 살아 있다.
#    그동안 다시 켜면 "이미 켜져 있습니다"로 거절하지 말고, 앞 프로그램이 끝나기를 잠깐 기다렸다가 켜져야 한다
quick_path = os.path.join(tempfile.mkdtemp(prefix="studyflow_lock_"), "studyflow.lock")
closing = run_child("print('HELD' if single_instance.acquire(%r) else 'DENIED', flush=True); time.sleep(1.5)" % quick_path)
first_line = closing.stdout.readline().strip()
check("(닫는 중) 먼저 켠 쪽은 잠금을 잡는다", first_line == "HELD", first_line)
started = time.time()
again = run_child("print('HELD' if single_instance.acquire(%r) else 'DENIED', flush=True)" % quick_path)
out, _ = again.communicate(timeout=30)
took = time.time() - started
print(f"     (닫는 중에 다시 켠 쪽이 켜지기까지 {took:.2f}초)")
check("닫는 중에 다시 켜면 거절하지 않고, 앞 프로그램이 끝난 뒤 켜진다", out.strip() == "HELD", f"{out.strip()} {took:.1f}초")
check("그 기다림은 앞 프로그램이 끝날 때까지 정도다(5초 안)", took < 5, f"{took:.1f}초")
closing.wait(timeout=30)

# 1) 잠금을 잡은 채로 오래 버티는 "먼저 켜진 StudyFlow"
holder = run_child("print('HELD' if single_instance.acquire(%r) else 'DENIED', flush=True); time.sleep(120)" % lock_path)
try:
    first_line = holder.stdout.readline().strip()
    check("먼저 켠 쪽은 잠금을 잡는다", first_line == "HELD", first_line)

    # 2) 두 번째 실행들은 거절된다. 진짜로 켜져 있으면 정해진 시간만 기다리고 거절한다(영원히 기다리지 않음)
    started = time.time()
    denied = single_instance.acquire(lock_path) is False
    took = time.time() - started
    check("진짜로 켜져 있으면 잠깐(약 5초) 기다린 뒤 거절된다", denied and 4 <= took <= 8, f"{denied} {took:.1f}초")
    check("기다리지 않게 하면 바로 거절된다", single_instance.acquire(lock_path, wait_seconds=0) is False)
    second = run_child("print('HELD' if single_instance.acquire(%r, wait_seconds=0) else 'DENIED', flush=True)" % lock_path)
    out, _ = second.communicate(timeout=30)
    check("두 번째 실행(다른 프로세스)도 거절된다", out.strip() == "DENIED", out.strip())

    # 3) 먼저 켠 쪽을 강제로 끈다(오류로 갑자기 꺼진 경우). 윈도우가 잠금을 풀어 주므로 다시 켤 수 있어야 한다
    holder.kill()
    holder.wait(timeout=30)
finally:
    if holder.poll() is None:
        holder.kill()
# 윈도우는 죽은 프로세스의 잠금을 "시스템 자원 상황에 따라" 잠시 뒤에 풀어 준다. 그래서 바로 안 풀려도 5초 안에는 풀려야 한다
# (실제로는 사용자가 바로가기를 다시 누르기까지 걸리는 시간이 있고, 안내 상자도 "몇 초 뒤에 다시 실행하세요"라고 알려 준다)
started = time.time()
released = False
while time.time() - started < 5:
    if single_instance.acquire(lock_path, wait_seconds=0):
        released = True
        break
    time.sleep(0.1)
print(f"     (강제 종료 뒤 잠금이 풀리기까지 {time.time() - started:.2f}초)")
check("먼저 켠 쪽이 강제로 꺼진 뒤에는 다시 켤 수 있다 (잠금이 남지 않음)", released)

# 4) 이 프로세스가 지금 잠금을 잡고 있으니 다른 프로세스는 다시 거절된다
third = run_child("print('HELD' if single_instance.acquire(%r, wait_seconds=0) else 'DENIED', flush=True)" % lock_path)
out, _ = third.communicate(timeout=30)
check("잠금을 새로 잡은 뒤에는 다시 다른 실행이 거절된다", out.strip() == "DENIED", out.strip())

# 5) 잠금 파일을 만들 수 없는 곳이면 막지 않고 켠다 (폴더가 없는 경로)
check("잠금 파일을 못 만드는 곳이면 막지 않는다", single_instance.acquire(os.path.join(tempfile.gettempdir(), "no_such_dir_xyz", "x.lock")) is True)

# 6) 이미 내용이 있는 파일을 지우지 않는다
other = os.path.join(tempfile.mkdtemp(prefix="studyflow_lock_"), "keep.lock")
with open(other, "w") as f:
    f.write("keep")
holder2 = run_child("single_instance.acquire(%r); print('x', flush=True)" % other)
holder2.communicate(timeout=30)
with open(other) as f:
    check("잠금을 잡아도 파일 내용을 지우지 않는다", f.read() == "keep")

# 7) 창 안 브라우저(WebView2)의 작업 폴더 비우기 (N25 두 번째 부분).
#    창을 닫은 뒤 앞 StudyFlow의 브라우저가 3초 넘게 살아 있으면 pywebview가 폴더를 반쯤만 지우고 끝난다(로그: WinError 32 ...\EBWebView\lockfile).
#    그때 새 창이 켜지면 화면만 뜨고 달력이 비었다. 새로 켤 때 브라우저가 폴더를 놓을 때까지 기다렸다가 깨끗이 비워야 한다
def make_profile(root):
    profile = os.path.join(root, "webview_profile")
    os.makedirs(os.path.join(profile, "EBWebView", "Default", "Cache"))
    for name in ("EBWebView/lockfile", "EBWebView/Local State", "EBWebView/Default/Cache/data_0"):
        with open(os.path.join(profile, name), "w") as f:
            f.write("x")
    return profile


check("작업 폴더가 없으면 바로 통과", single_instance.clear_webview_profile(os.path.join(tempfile.mkdtemp(prefix="studyflow_lock_"), "webview_profile")) is True)
profile = make_profile(tempfile.mkdtemp(prefix="studyflow_lock_"))
check("아무도 안 쓰는 작업 폴더는 비운다", single_instance.clear_webview_profile(profile) is True and not os.path.exists(profile))

# 앞 브라우저가 lockfile을 1.5초 더 쥐고 있다가 끝나는 상황 (파이썬의 open은 다른 프로그램의 삭제를 막는다 = WebView2의 lockfile과 같다)
profile = make_profile(tempfile.mkdtemp(prefix="studyflow_lock_"))
browser = run_child("f = open(%r, 'a'); print('HELD', flush=True); time.sleep(1.5)" % os.path.join(profile, "EBWebView", "lockfile"))
check("(앞 브라우저 흉내) lockfile을 쥐고 있다", browser.stdout.readline().strip() == "HELD")
started = time.time()
cleared = single_instance.clear_webview_profile(profile)
took = time.time() - started
print(f"     (앞 브라우저가 작업 폴더를 놓을 때까지 {took:.2f}초 기다림)")
check("앞 브라우저가 놓을 때까지 기다렸다가 작업 폴더를 깨끗이 비운다", cleared is True and not os.path.exists(profile) and took >= 1, f"{cleared} {took:.1f}초 {os.path.exists(profile)}")
browser.wait(timeout=30)

# 끝내 놓지 않으면 정해진 시간 뒤 포기하고(False) 켜기는 계속한다. 오류로 멈추지 않는다
profile = make_profile(tempfile.mkdtemp(prefix="studyflow_lock_"))
browser = run_child("f = open(%r, 'a'); print('HELD', flush=True); time.sleep(60)" % os.path.join(profile, "EBWebView", "lockfile"))
try:
    browser.stdout.readline()
    started = time.time()
    cleared = single_instance.clear_webview_profile(profile, wait_seconds=1)
    took = time.time() - started
    check("끝내 놓지 않으면 정해진 시간 뒤 False(멈추지 않음)", cleared is False and took < 3, f"{cleared} {took:.1f}초")
finally:
    browser.kill()
    browser.wait(timeout=30)

# 실수 방지: 이름이 webview_profile이 아닌 폴더는 지우지 않는다 (내 데이터가 든 폴더를 잘못 넘겨도 안전하게)
other_dir = tempfile.mkdtemp(prefix="studyflow_lock_")
with open(os.path.join(other_dir, "keep.txt"), "w") as f:
    f.write("keep")
check("이름이 webview_profile이 아닌 폴더는 지우지 않는다", single_instance.clear_webview_profile(other_dir) is False and os.path.exists(os.path.join(other_dir, "keep.txt")))

print("\n실패:", failures if failures else "없음")
sys.exit(1 if failures else 0)
