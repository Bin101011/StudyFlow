"""Obsidian vault(노트가 모인 폴더)의 .md 파일을 읽고 쓰는 곳.

노트는 사용자의 원본 데이터라서, 이 파일은 "절대 vault 밖을 건드리지 않고, 쓰다가 실패해도 파일이 깨지지 않고,
Obsidian에서 그 사이에 고친 내용을 덮어쓰지 않는 것"을 가장 우선한다.
- 경로: vault 안의 .md 파일만. 점(.)으로 시작하는 폴더(.obsidian 등)와 라이브러리 폴더는 목록에도 안 나오고 열 수도 없다
- 저장: 같은 폴더의 임시 파일에 먼저 쓴 뒤 바꿔치기(os.replace)해서, 쓰는 도중 꺼져도 원본이 반쯤 쓰인 채 남지 않는다
- 충돌: 노트를 열 때의 수정 시각을 기억했다가, 저장할 때 달라져 있으면(Obsidian에서 고쳤다) 덮어쓰지 않고 알린다
- 백업: 프로그램을 켠 뒤 어떤 노트를 처음 저장하기 직전의 내용을 notes_backup 폴더에 한 번 복사해 둔다
- 줄바꿈(LF/CRLF)과 BOM은 원래 파일 그대로 유지한다
"""
import datetime
import os
import re
import shutil
import threading

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKUP_DIR = os.path.join(BASE_DIR, "notes_backup")

# 노트를 찾을 때 안으로 들어가지 않는 폴더 이름. 점(.)으로 시작하는 폴더(.obsidian, .git, .venv 등)는 이름과 상관없이 항상 건너뛴다.
# (vault가 문서 폴더 같은 넓은 곳일 때 라이브러리 폴더 속의 README.md 같은 것들이 노트처럼 보이지 않게 한다)
EXCLUDED_DIR_NAMES = {"node_modules", "__pycache__", "site-packages"}
MAX_NOTES = 5000                  # 목록에 담는 노트 수의 한계. 넘으면 잘렸다고 알린다
MAX_NOTE_BYTES = 2 * 1024 * 1024  # 이보다 큰 노트는 화면에서 열지 않는다
MAX_NAME_LENGTH = 150             # 폴더/파일 이름 한 조각의 길이 한계
BOM = b"\xef\xbb\xbf"             # 일부 프로그램이 UTF-8 파일 맨 앞에 붙이는 표시

# 파일/폴더 이름에 쓸 수 없는 글자 (윈도우 기준). 슬래시(/)는 폴더 구분이라 따로 처리한다
INVALID_NAME_CHARS = re.compile(r'[<>:"|?*\\\x00-\x1f]')

# 저장하는 동안 다른 요청이 끼어들지 못하게 하는 열쇠
_lock = threading.Lock()
# 이번 실행에서 이미 백업해 둔 노트들
_backed_up = set()


class NoteError(Exception):
    """사용자에게 이유를 보여줄 수 있는 오류. status는 HTTP 응답 번호다."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class NoteConflict(NoteError):
    """저장하려는 사이에 파일이 다른 곳에서 바뀌었다. mtime은 지금 파일의 수정 시각이다."""

    def __init__(self, mtime):
        super().__init__("이 노트가 다른 곳(Obsidian 등)에서 바뀌었습니다.", 409)
        self.mtime = mtime


def _is_skipped_dir(name):
    return name.startswith(".") or name in EXCLUDED_DIR_NAMES


def vault_root(vault_path):
    """설정에 적힌 vault 폴더를 실제 경로로 바꿔 돌려준다. 폴더가 아니면 오류."""
    if not vault_path:
        raise NoteError("Obsidian vault 폴더가 정해지지 않았습니다. 설정 탭에서 정해주세요.")
    root = os.path.realpath(os.path.expanduser(vault_path))
    if not os.path.isdir(root):
        raise NoteError("폴더를 찾을 수 없습니다: " + vault_path)
    return root


def mtime_of(stat_result):
    """수정 시각을 글자로 돌려준다. 나노초 단위의 아주 큰 정수라서, 화면(JavaScript)이 숫자로 받으면 끝자리가 깎인다. 그래서 글자로 주고받는다."""
    return str(stat_result.st_mtime_ns)


def resolve_note(root, relative_path, must_exist=True):
    """"폴더/노트.md" 같은 상대 경로를 실제 파일 경로로 바꾼다. vault 밖이거나 이상한 경로면 오류.
    화면이 보낸 경로를 그대로 믿지 않고 여기서 항상 다시 검사한다."""
    if not isinstance(relative_path, str) or not relative_path.strip():
        raise NoteError("노트 경로가 없습니다.")
    parts = relative_path.split("/")
    for part in parts:
        if part in ("", ".", "..") or _is_skipped_dir(part) or INVALID_NAME_CHARS.search(part) or len(part) > MAX_NAME_LENGTH:
            raise NoteError("잘못된 노트 경로입니다.")
    if not parts[-1].lower().endswith(".md"):
        raise NoteError("마크다운(.md) 노트만 열 수 있습니다.")

    # realpath: 바로가기(심볼릭 링크)까지 따라가서 진짜 위치를 구한다. 그 위치가 vault 안인지 마지막으로 확인한다
    target = os.path.realpath(os.path.join(root, *parts))
    try:
        inside = os.path.commonpath([root, target]) == root
    except ValueError:  # 드라이브가 다르면 비교할 수 없다 = 밖이다
        inside = False
    if not inside:
        raise NoteError("vault 밖의 파일은 열 수 없습니다.")
    if must_exist and not os.path.isfile(target):
        raise NoteError("노트를 찾을 수 없습니다.", 404)
    return target


def list_notes(vault_path):
    """vault 안의 모든 .md 노트를 돌려준다: ([{"path": "폴더/이름.md", "mtime": 글자}, ...], 잘렸는지).
    경로는 윈도우에서도 항상 슬래시(/)로 쓴다."""
    root = vault_root(vault_path)
    notes = []
    truncated = False
    for current, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if not _is_skipped_dir(d)]  # 건너뛸 폴더는 안으로 들어가지 않는다
        for name in files:
            if name.startswith(".") or not name.lower().endswith(".md"):
                continue
            if len(notes) >= MAX_NOTES:
                truncated = True
                break
            full = os.path.join(current, name)
            try:
                mtime = mtime_of(os.stat(full))
            except OSError:
                continue  # 목록을 만드는 사이에 지워진 파일
            notes.append({"path": os.path.relpath(full, root).replace(os.sep, "/"), "mtime": mtime})
        if truncated:
            break
    notes.sort(key=lambda n: n["path"].casefold())
    return notes, truncated


def _decode(raw):
    """파일의 바이트를 글자로 바꾼다. (BOM이 있었는지, 글자)를 돌려준다. 줄바꿈은 \\n으로 통일한다."""
    has_bom = raw.startswith(BOM)
    if has_bom:
        raw = raw[len(BOM):]
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise NoteError("UTF-8 글자 형식이 아닌 파일이라 열 수 없습니다.")
    return has_bom, text.replace("\r\n", "\n")


def read_note(vault_path, relative_path):
    """노트 한 개를 읽는다: {"path", "content", "mtime"}"""
    path = resolve_note(vault_root(vault_path), relative_path)
    with open(path, "rb") as f:
        stat_result = os.fstat(f.fileno())  # 읽기 전에 수정 시각을 잰다 (읽는 사이에 바뀌었다면 다음 저장 때 충돌로 알아챈다)
        if stat_result.st_size > MAX_NOTE_BYTES:
            raise NoteError("노트가 너무 커서 열 수 없습니다 (2MB 초과).")
        raw = f.read()
    _, text = _decode(raw)
    return {"path": relative_path, "content": text, "mtime": mtime_of(stat_result)}


def stat_note(vault_path, relative_path):
    """노트의 지금 수정 시각만 돌려준다. 화면이 "Obsidian에서 바뀌었나?" 하고 주기적으로 확인할 때 쓴다."""
    path = resolve_note(vault_root(vault_path), relative_path)
    return mtime_of(os.stat(path))


def _backup_once(path, relative_path):
    """이번 실행에서 이 노트를 처음 저장하기 직전이라면, 지금 파일 내용을 notes_backup에 복사해 둔다."""
    if path in _backed_up:
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    shutil.copy2(path, os.path.join(BACKUP_DIR, stamp + "_" + relative_path.replace("/", "__")))
    _backed_up.add(path)


def save_note(vault_path, relative_path, content, base_mtime):
    """노트를 저장하고 새 수정 시각을 돌려준다.
    base_mtime은 화면이 노트를 읽을 때 받은 수정 시각이다. 파일이 그 사이에 다른 곳에서 바뀌었으면 덮어쓰지 않고 NoteConflict를 낸다.
    (단, 바뀐 내용이 지금 저장하려는 내용과 똑같다면 잃을 것이 없으니 충돌로 보지 않는다)"""
    if not isinstance(content, str):
        raise NoteError("노트 내용이 글자가 아닙니다.")
    if len(content.encode("utf-8")) > MAX_NOTE_BYTES:
        raise NoteError("노트가 너무 커서 저장할 수 없습니다 (2MB 초과).")

    with _lock:
        path = resolve_note(vault_root(vault_path), relative_path)
        current = mtime_of(os.stat(path))
        with open(path, "rb") as f:
            raw = f.read()
        has_bom = raw.startswith(BOM)
        crlf = b"\r\n" in raw  # 원래 파일이 윈도우식 줄바꿈이었으면 그대로 유지한다

        data = content.replace("\r\n", "\n")
        if current != str(base_mtime):
            try:
                _, on_disk = _decode(raw)
            except NoteError:
                on_disk = None
            if on_disk == data:
                return current
            raise NoteConflict(current)

        _backup_once(path, relative_path)
        if crlf:
            data = data.replace("\n", "\r\n")
        out = (BOM if has_bom else b"") + data.encode("utf-8")

        # 임시 파일은 점(.)으로 시작하는 .tmp 파일이라 Obsidian이 노트로 보지 않는다
        temp = os.path.join(os.path.dirname(path), "." + os.path.basename(path) + ".studyflow.tmp")
        try:
            with open(temp, "wb") as f:
                f.write(out)
            os.replace(temp, path)
        finally:
            if os.path.exists(temp):
                os.remove(temp)
        return mtime_of(os.stat(path))


def create_note(vault_path, relative_path):
    """새 빈 노트를 만든다. "폴더/이름"처럼 쓰면 폴더도 없을 때 만든다. 이미 있으면 오류(덮어쓰지 않는다).
    .md를 안 붙였으면 붙여준다. 만들어진 노트의 {"path", "mtime"}를 돌려준다."""
    relative_path = (relative_path or "").strip().strip("/")
    if not relative_path:
        raise NoteError("노트 이름을 입력하세요.")
    if not relative_path.lower().endswith(".md"):
        relative_path += ".md"

    with _lock:
        root = vault_root(vault_path)
        path = resolve_note(root, relative_path, must_exist=False)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        try:
            # "x" 모드: 파일이 이미 있으면 실패한다. 확인하고 만드는 사이에 끼어드는 일이 없다
            with open(path, "x", encoding="utf-8"):
                pass
        except FileExistsError:
            raise NoteError("같은 이름의 노트가 이미 있습니다.", 409)
        return {"path": relative_path, "mtime": mtime_of(os.stat(path))}
