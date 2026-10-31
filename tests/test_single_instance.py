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


# 1) 잠금을 잡은 채로 오래 버티는 "먼저 켜진 StudyFlow"
holder = run_child("print('HELD' if single_instance.acquire(%r) else 'DENIED', flush=True); time.sleep(120)" % lock_path)
try:
    first_line = holder.stdout.readline().strip()
    check("먼저 켠 쪽은 잠금을 잡는다", first_line == "HELD", first_line)

    # 2) 두 번째 실행들은 거절된다
    check("두 번째 실행(이 프로세스)은 거절된다", single_instance.acquire(lock_path) is False)
    second = run_child("print('HELD' if single_instance.acquire(%r) else 'DENIED', flush=True)" % lock_path)
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
    if single_instance.acquire(lock_path):
        released = True
        break
    time.sleep(0.1)
print(f"     (강제 종료 뒤 잠금이 풀리기까지 {time.time() - started:.2f}초)")
check("먼저 켠 쪽이 강제로 꺼진 뒤에는 다시 켤 수 있다 (잠금이 남지 않음)", released)

# 4) 이 프로세스가 지금 잠금을 잡고 있으니 다른 프로세스는 다시 거절된다
third = run_child("print('HELD' if single_instance.acquire(%r) else 'DENIED', flush=True)" % lock_path)
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

print("\n실패:", failures if failures else "없음")
sys.exit(1 if failures else 0)
