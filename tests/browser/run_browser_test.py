"""화면 시험을 돌린다. 시험마다 시험 서버를 새로 띄우고, 끝나면 끈다.

실행 (프로젝트 폴더에서):
    .venv\\Scripts\\python.exe tests\\browser\\run_browser_test.py steps      steps_test.mjs 하나
    .venv\\Scripts\\python.exe tests\\browser\\run_browser_test.py all        전부 차례로

필요한 것: Node.js(node 명령), 그리고 Microsoft Edge(C:\\Program Files (x86)\\Microsoft\\Edge\\...). 시험이 안 보이는 헤드리스 Edge를 직접 띄워서
실제 마우스/키보드 입력을 흉내 낸다. 가짜 Google과 임시 DB를 쓰는 시험 서버(5057번 포트)에 접속하므로 진짜 Google과 내 데이터는 건드리지 않는다.

시험마다 서버를 새로 띄우는 이유: 이전 시험이 만든 계획/메모가 남아 있으면 엉뚱하게 실패하기 때문이다.
같은 5057번 포트를 쓰므로 시험을 동시에 돌리면 안 된다 (이 파일은 차례로 돌린다)."""
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
TESTS_DIR = os.path.dirname(HERE)
PROJECT_DIR = os.path.dirname(TESTS_DIR)
PORT = 5057

# 시험마다 맞는 시험 서버(시드 데이터가 다르다). 적혀 있지 않은 시험은 memo_server.py를 쓴다
SERVER_FOR = {"steps_test": "pro_server.py"}
DEFAULT_SERVER = "memo_server.py"


def port_in_use():
    with socket.socket() as probe:
        probe.settimeout(0.5)
        return probe.connect_ex(("127.0.0.1", PORT)) == 0


def wait_until_port_free(timeout=20):
    """포트가 비워질 때까지 기다린다. 가상환경의 python.exe는 실제 파이썬을 자식으로 띄우는 껍데기라서, 껍데기를 끈 뒤에도
    서버가 잠깐 더 살아 있다. 이걸 기다리지 않으면 다음 시험이 "죽어 가는 옛 서버"에 접속해서 준비됐다고 착각하고, 시험 도중에
    그 서버가 꺼져 'Failed to fetch'로 실패한다 (all로 연달아 돌릴 때 실제로 일어났다)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not port_in_use():
            return True
        time.sleep(0.3)
    return False


def stop_server(server):
    """우리가 띄운 서버를 껍데기와 그 자식까지 모두 끄고, 포트가 비워질 때까지 기다린다."""
    if os.name == "nt":
        # /T: 자식 프로세스까지, /F: 강제. 우리가 들고 있는 PID만 대상이라 다른 프로그램은 건드리지 않는다
        subprocess.run(["taskkill", "/PID", str(server.pid), "/T", "/F"], capture_output=True)
    else:
        server.terminate()
    try:
        server.wait(timeout=10)
    except subprocess.TimeoutExpired:
        server.kill()
    wait_until_port_free()


def wait_until_ready(timeout=30):
    """서버가 응답할 때까지 기다린 뒤, 막 떴을 때 첫 요청이 느린 것을 피하려고 한두 번 두드려 둔다."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/settings", timeout=5).read()
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/", timeout=5).read()
            return True
        except OSError:
            time.sleep(0.5)
    return False


def run_one(test_name):
    server_script = os.path.join(TESTS_DIR, SERVER_FOR.get(test_name, DEFAULT_SERVER))
    test_file = os.path.join(HERE, test_name + ".mjs")
    if not os.path.exists(test_file):
        print("그런 화면 시험이 없습니다:", test_name)
        return 1
    if not wait_until_port_free():
        print(f"{PORT}번 포트를 다른 프로그램이 계속 쓰고 있어서 시작하지 않습니다. 이전에 띄운 시험 서버가 남아 있다면 끄고 다시 하세요.")
        return 1

    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1", "PYTHONPATH": TESTS_DIR + os.pathsep + PROJECT_DIR}
    log_path = os.path.join(tempfile.gettempdir(), f"studyflow_test_server_{test_name}.log")
    print(f"=== {test_name}  (서버: {os.path.basename(server_script)}, 서버 기록: {log_path})", flush=True)
    with open(log_path, "w", encoding="utf-8") as log:
        # CREATE_NO_WINDOW: 검은 창을 띄우지 않는다 (윈도우 전용 옵션)
        server = subprocess.Popen([sys.executable, server_script], cwd=PROJECT_DIR, env=env, stdout=log, stderr=log,
                                  creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            if not wait_until_ready() or server.poll() is not None:
                # server.poll()이 None이 아니면 우리 서버는 이미 끝났다 = 응답한 것은 다른(옛) 서버였다
                print("시험 서버가 뜨지 않았습니다. 서버 기록을 보세요:", log_path)
                return 1
            # 시험이 한글을 출력하므로 UTF-8로 받는다. 시험 출력은 줄이 나오는 대로 바로 보여준다
            return subprocess.run(["node", test_file], cwd=PROJECT_DIR, env=env).returncode
        finally:
            stop_server(server)  # 우리가 띄운 프로세스를 우리가 들고 있으니, 포트로 찾을 필요 없이 이것만 정확히 끈다


def main():
    available = sorted(n[:-4] for n in os.listdir(HERE) if n.endswith(".mjs"))
    if len(sys.argv) < 2:
        print("사용법: run_browser_test.py <이름|all>\n시험:", ", ".join(available))
        return 1
    wanted = available if sys.argv[1] == "all" else [sys.argv[1]]
    results = {}
    for name in wanted:
        # 'steps'처럼 줄여 써도 되고 'steps_test.mjs' 전체를 써도 된다
        full = next((a for a in available if a in (name, name + "_test", name[:-4] if name.endswith(".mjs") else name)), name)
        results[full] = run_one(full)
    print("\n=== 결과")
    for name, code in results.items():
        print(("통과  " if code == 0 else "실패  ") + name)
    return 0 if all(code == 0 for code in results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
