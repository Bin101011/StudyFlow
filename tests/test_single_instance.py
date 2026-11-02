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

# 6b) 끝내기 직전에 잠금을 직접 푼다 (N25). os._exit를 불러도 윈도우가 프로세스를 실제로 거둬 가기까지 2초쯤 걸려서(측정),
#     그동안 잠금이 남아 다시 켠 쪽이 기다렸다. release()로 풀면, 그 프로세스가 아직 살아 있어도 다른 실행이 바로 잡을 수 있어야 한다
release_path = os.path.join(tempfile.mkdtemp(prefix="studyflow_lock_"), "studyflow.lock")
releaser = run_child("single_instance.acquire(%r); single_instance.release(); print('RELEASED', flush=True); time.sleep(30)" % release_path)
try:
    check("(직접 풀기) 앞 프로그램이 잠금을 풀었다고 알린다", releaser.stdout.readline().strip() == "RELEASED")
    started = time.time()
    check("앞 프로그램이 아직 살아 있어도, 잠금을 직접 풀었으면 바로 켤 수 있다", single_instance.acquire(release_path, wait_seconds=0) is True, f"{time.time() - started:.1f}초")
    check("release를 두 번 불러도 오류가 없다", single_instance.release() is None and single_instance.release() is None)
finally:
    releaser.kill()
    releaser.wait(timeout=30)

# exit_now는 끝내기 직전에 잠금을 푼다 (os._exit는 가짜로 바꿔서 이 시험 프로세스가 끝나지 않게 한다)
exit_path = os.path.join(tempfile.mkdtemp(prefix="studyflow_lock_"), "studyflow.lock")
exiter = run_child(
    "single_instance.acquire(%r)\n"
    "single_instance.os._exit = lambda code: print('EXIT', code, flush=True)\n"
    "single_instance.exit_now(); time.sleep(30)" % exit_path
)
try:
    check("(exit_now) os._exit까지 간다", exiter.stdout.readline().strip() == "EXIT 0")
    check("exit_now 뒤에는 그 프로세스가 아직 살아 있어도 바로 켤 수 있다", single_instance.acquire(exit_path, wait_seconds=0) is True)
finally:
    exiter.kill()
    exiter.wait(timeout=30)

# 7) 창 안 브라우저(WebView2)의 작업 폴더 (N25).
#    창을 닫은 뒤 앞 StudyFlow의 브라우저가 몇 초 더 살아 있으면서 작업 폴더를 쥐고 있다. 같은 폴더로 새 창을 켜면 화면만 뜨고 달력이 비었고,
#    놓을 때까지 기다리면 창이 늦게 떴다. 그래서 실행마다 새 폴더를 쓰고, 남은 옛 폴더는 기다리지 않고 지울 수 있는 것만 지운다
def make_profile(root, name):
    profile = os.path.join(root, name)
    os.makedirs(os.path.join(profile, "EBWebView", "Default", "Cache"))
    for part in ("EBWebView/lockfile", "EBWebView/Local State", "EBWebView/Default/Cache/data_0"):
        with open(os.path.join(profile, part), "w") as f:
            f.write("x")
    return profile


root = tempfile.mkdtemp(prefix="studyflow_lock_")
first_profile = single_instance.new_webview_profile(root)
second_profile = single_instance.new_webview_profile(root)
check("실행마다 새 작업 폴더 이름(webview_profile-…)을 root 안에 만든다",
      os.path.dirname(first_profile) == root and os.path.basename(first_profile).startswith("webview_profile-") and first_profile != second_profile, f"{first_profile} {second_profile}")

current = make_profile(root, os.path.basename(first_profile))       # 지금 켜는 StudyFlow가 쓸 폴더
old_version = make_profile(root, "webview_profile")                  # 예전 방식(이름 하나)으로 남은 폴더
old_free = make_profile(root, "webview_profile-20261102-1-111")      # 앞 실행이 남긴, 이제 아무도 안 쓰는 폴더
old_held = make_profile(root, "webview_profile-20261102-2-222")      # 앞 실행의 브라우저가 아직 쥐고 있는 폴더
mine = make_profile(root, "my_data")                                 # 이름이 다른 폴더 (절대 지우면 안 됨)
look_alike = make_profile(root, "webview_profileX")                  # 비슷하지만 다른 이름

# 앞 브라우저 흉내: lockfile을 쥐고 있다 (파이썬의 open은 다른 프로그램의 삭제를 막는다 = WebView2의 lockfile과 같다)
browser = run_child("f = open(%r, 'a'); print('HELD', flush=True); time.sleep(60)" % os.path.join(old_held, "EBWebView", "lockfile"))
try:
    check("(앞 브라우저 흉내) lockfile을 쥐고 있다", browser.stdout.readline().strip() == "HELD")
    started = time.time()
    single_instance.remove_old_webview_profiles(root, keep=current)
    took = time.time() - started
    check("남은 옛 폴더 정리는 쥐고 있는 폴더를 기다리지 않는다(1초 안)", took < 1, f"{took:.1f}초")
    check("아무도 안 쓰는 옛 폴더는 지운다(예전 이름 webview_profile 포함)", not os.path.exists(old_free) and not os.path.exists(old_version), f"{os.path.exists(old_free)} {os.path.exists(old_version)}")
    check("지금 쓸 폴더는 지우지 않는다", os.path.exists(os.path.join(current, "EBWebView", "Local State")))
    check("앞 브라우저가 쥐고 있는 파일은 남는다(다음에 지움)", os.path.exists(os.path.join(old_held, "EBWebView", "lockfile")))
    check("이름이 다른 폴더는 지우지 않는다", os.path.exists(os.path.join(mine, "EBWebView", "Local State")) and os.path.exists(os.path.join(look_alike, "EBWebView", "Local State")))
finally:
    browser.kill()
    browser.wait(timeout=30)
time.sleep(0.5)
single_instance.remove_old_webview_profiles(root, keep=current)
check("앞 브라우저가 끝난 뒤 다음 정리 때 그 폴더도 지운다", not os.path.exists(old_held))
check("root가 없어도 오류 없이 지나간다", single_instance.remove_old_webview_profiles(os.path.join(root, "no_such"), keep=current) is None)

print("\n실패:", failures if failures else "없음")
sys.exit(1 if failures else 0)
