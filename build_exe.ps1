# StudyFlow를 exe로 만든다. 결과는 dist\StudyFlow 폴더이다 (안에 StudyFlow.exe).
#
# 실행 방법 (PowerShell에서 이 폴더로 이동한 뒤):
#   powershell -ExecutionPolicy Bypass -File .\build_exe.ps1
#
# 처음 한 번은 .venv에 PyInstaller가 있어야 한다:
#   .\.venv\Scripts\python.exe -m pip install pyinstaller

$root = $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    Write-Host "python.exe not found: $python"
    Write-Host "Create .venv first (see README.md)."
    exit 1
}

# 다시 만들 때 PyInstaller는 dist\StudyFlow 폴더를 통째로 지우고 새로 만든다.
# exe를 그 폴더에서 써 왔다면 내 데이터(studyflow.db 등)도 같이 지워지므로, 있으면 멈춘다
$out = Join-Path $root "dist\StudyFlow"
$personal = @("studyflow.db", "settings.json", "credentials.json", "token.json", "events_cache.json", "db_backup", "notes_backup")
foreach ($name in $personal) {
    if (Test-Path (Join-Path $out $name)) {
        Write-Host "Stopped: dist\StudyFlow\$name exists (your data)."
        Write-Host "Move the StudyFlow folder somewhere else before building again."
        exit 1
    }
}

# 중간 작업 폴더(--workpath)는 프로젝트 안의 build 폴더가 아니라 %TEMP% 안에 둔다.
# build 폴더에도 StudyFlow.exe가 생기는데, 그건 _internal 폴더가 없는 반쪽짜리라서 켜면
# "Failed to load Python DLL ... 지정된 모듈을 찾을 수 없습니다" 오류가 난다. 헷갈리지 않게 아예 안 보이는 곳에 둔다
$work = Join-Path $env:TEMP "StudyFlow-pyinstaller"
$oldWork = Join-Path $root "build"
if (Test-Path (Join-Path $oldWork "StudyFlow\StudyFlow.exe")) {
    # 예전 방식으로 만들 때 남은 build 폴더 (우리가 만든 중간 파일만 들어 있다)
    Remove-Item -Recurse -Force $oldWork
}

# --noconfirm: 예전 결과 폴더를 지워도 되는지 묻지 않는다 (위에서 내 데이터가 없는 것을 확인했다)
& $python -m PyInstaller --noconfirm --workpath $work (Join-Path $root "StudyFlow.spec")
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed."
    exit 1
}
Write-Host "Done: $out\StudyFlow.exe"
Write-Host "Copy the whole dist\StudyFlow folder (StudyFlow.exe + _internal) where you want, and put credentials.json next to StudyFlow.exe."
Write-Host "Do not copy StudyFlow.exe alone: it cannot start without the _internal folder next to it."
# 결과 폴더를 탐색기로 열어서, 어느 StudyFlow.exe를 켜야 하는지 바로 보이게 한다
Start-Process explorer.exe $out
