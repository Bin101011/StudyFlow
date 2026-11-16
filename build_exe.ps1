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

# --noconfirm: 예전 결과 폴더를 지워도 되는지 묻지 않는다 (위에서 내 데이터가 없는 것을 확인했다)
& $python -m PyInstaller --noconfirm (Join-Path $root "StudyFlow.spec")
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed."
    exit 1
}
Write-Host "Done: $out\StudyFlow.exe"
Write-Host "Copy the whole dist\StudyFlow folder where you want, and put credentials.json next to StudyFlow.exe."
