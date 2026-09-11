param(
    [int]$Port = 8790,
    [string]$Python = 'G:\MiniMax-H3\ComfyUI_windows_portable\python_embeded\python.exe'
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$previewUrl = "http://127.0.0.1:$Port/static/live2d-preview.html?source=male-master"
try {
    $response = Invoke-WebRequest -Uri $previewUrl -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -eq 200 -and $response.Content.Contains('Live2D 制作验收')) {
        Write-Output $previewUrl
        return
    }
} catch { }
if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
    throw '没有找到 G 盘 Python；请使用 -Python 指定已有 Python 的完整路径。'
}
$logRoot = Join-Path $projectRoot 'work\live2d\logs'
$env:TEMP = Join-Path $projectRoot 'work\live2d\tmp'
$env:TMP = $env:TEMP
$env:PYTHONDONTWRITEBYTECODE = '1'
New-Item -ItemType Directory -Path $logRoot,$env:TEMP -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$serverArgs = @('-m', 'http.server', "$Port", '--bind', '127.0.0.1', '--directory', ('"' + (Join-Path $projectRoot 'demo') + '"'))
$previewProcess = Start-Process -FilePath $Python -ArgumentList $serverArgs -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot "preview-$stamp.stdout.log") -RedirectStandardError (Join-Path $logRoot "preview-$stamp.stderr.log")
for ($attempt = 0; $attempt -lt 15; $attempt++) {
    if ($previewProcess.HasExited) { throw "预览服务未启动，请查看 $logRoot 中的日志。" }
    try {
        $response = Invoke-WebRequest -Uri $previewUrl -UseBasicParsing -TimeoutSec 1
        if ($response.StatusCode -eq 200 -and $response.Content.Contains('Live2D 制作验收')) {
            Write-Output $previewUrl
            return
        }
    } catch { }
    Start-Sleep -Milliseconds 200
}
throw "预览服务尚未就绪，请查看 $logRoot 中的日志。"
