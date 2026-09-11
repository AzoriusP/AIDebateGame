[CmdletBinding()]
param(
    [switch]$CheckOnly,
    # Explicit opt-in: keep 8188 untouched and only coexist while its queue and
    # the GPU are idle. The ordinary launch still refuses a second service.
    [switch]$CoexistIfIdle,
    [ValidateRange(1024, 65535)]
    [int]$Port = 8189
)

$ErrorActionPreference = 'Stop'
$taskProject = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if ([IO.Path]::GetPathRoot($taskProject) -ne 'G:\') {
    throw 'Live2D task data must remain inside the G: project.'
}

$taskPortable = 'G:\MiniMax-H3\ComfyUI_windows_portable'
$taskApp = Join-Path $taskPortable 'ComfyUI'
$taskPython = Join-Path $taskPortable 'python_embeded\python.exe'
$taskMain = Join-Path $taskApp 'main.py'
$taskSharedModels = 'G:\MiniMax-H3\models'
$taskSharedAux = Join-Path $taskApp 'custom_nodes\comfyui_controlnet_aux\ckpts'
$taskWork = Join-Path $taskProject 'work\live2d\comfyui'
$taskInput = Join-Path $taskWork 'input'
$taskOutput = Join-Path $taskProject 'design\art-output\live2d-source'
$taskUser = Join-Path $taskWork 'user'
$taskTemp = Join-Path $taskWork 'temp'
$taskCache = Join-Path $taskWork 'cache'
$taskProfile = Join-Path $taskWork 'profile'
$taskLogs = Join-Path $taskWork 'logs'
$taskConfig = Join-Path $taskWork 'extra-model-paths.yaml'

foreach ($taskRequired in @($taskPython, $taskMain, $taskSharedModels,
    (Join-Path $taskApp 'custom_nodes\ComfyUI_IPAdapter_plus'),
    (Join-Path $taskApp 'custom_nodes\comfyui_controlnet_aux'))) {
    if (-not (Test-Path -LiteralPath $taskRequired)) {
        throw "Required existing G: tool was not found: $taskRequired"
    }
}

$taskEnvironment = [ordered]@{
    USERPROFILE = $taskProfile
    HOME = $taskProfile
    APPDATA = (Join-Path $taskProfile 'AppData\Roaming')
    LOCALAPPDATA = (Join-Path $taskProfile 'AppData\Local')
    TEMP = $taskTemp
    TMP = $taskTemp
    XDG_CACHE_HOME = $taskCache
    XDG_CONFIG_HOME = (Join-Path $taskWork 'config')
    XDG_STATE_HOME = (Join-Path $taskWork 'state')
    HF_HOME = (Join-Path $taskCache 'huggingface')
    HF_HUB_CACHE = (Join-Path $taskCache 'huggingface\hub')
    HF_DATASETS_CACHE = (Join-Path $taskCache 'huggingface\datasets')
    HUGGINGFACE_HUB_CACHE = (Join-Path $taskCache 'huggingface\hub')
    PIP_CACHE_DIR = (Join-Path $taskCache 'pip')
    UV_CACHE_DIR = (Join-Path $taskCache 'uv')
    TORCH_HOME = (Join-Path $taskCache 'torch')
    TORCHINDUCTOR_CACHE_DIR = (Join-Path $taskCache 'torchinductor')
    TRITON_CACHE_DIR = (Join-Path $taskCache 'triton')
    CUDA_CACHE_PATH = (Join-Path $taskCache 'cuda')
    NUMBA_CACHE_DIR = (Join-Path $taskCache 'numba')
    MPLCONFIGDIR = (Join-Path $taskCache 'matplotlib')
    U2NET_HOME = (Join-Path $taskCache 'u2net')
    AUX_TEMP_DIR = $taskTemp
    # These are existing inference weights belonging to the shared G: tool.
    # Reusing them avoids redownloading DWPose. New HF caches stay above.
    AUX_ANNOTATOR_CKPTS_PATH = $taskSharedAux
    AUX_ORT_PROVIDERS = 'CPUExecutionProvider'
    HF_HUB_OFFLINE = '1'
    TRANSFORMERS_OFFLINE = '1'
    HF_HUB_DISABLE_TELEMETRY = '1'
    DO_NOT_TRACK = '1'
    PYTHONDONTWRITEBYTECODE = '1'
    PYTHONNOUSERSITE = '1'
    PYTORCH_CUDA_ALLOC_CONF = 'garbage_collection_threshold:0.9,max_split_size_mb:512'
}

foreach ($taskDirectory in @($taskWork, $taskInput, $taskOutput, $taskUser, $taskTemp, $taskLogs,
    (Join-Path $taskWork 'custom_nodes')) + @($taskEnvironment.Values | Where-Object { $_ -like 'G:\*' })) {
    if (-not (Test-Path -LiteralPath $taskDirectory)) {
        if (-not ([IO.Path]::GetFullPath($taskDirectory).StartsWith($taskProject + '\', [StringComparison]::OrdinalIgnoreCase))) {
            throw "The launcher will not create paths outside this project: $taskDirectory"
        }
        New-Item -ItemType Directory -Path $taskDirectory -Force | Out-Null
    }
}

# Extra search paths only; never rewrite the shared tool's configuration.
$taskYaml = @"
aiddebate_shared_models:
  base_path: G:/MiniMax-H3/models
  checkpoints: checkpoints
  clip_vision: clip_vision
  controlnet: controlnet
  vae: vae
  loras: loras
  text_encoders: text_encoders
  diffusion_models: diffusion_models
aiddebate_shared_extensions:
  base_path: G:/MiniMax-H3/ComfyUI_windows_portable/ComfyUI
  custom_nodes: custom_nodes
  ipadapter: models/ipadapter
"@
[IO.File]::WriteAllText($taskConfig, $taskYaml, [Text.UTF8Encoding]::new($false))

$taskArguments = @(
    '-B', '-s', $taskMain,
    '--listen', '127.0.0.1', '--port', [string]$Port,
    '--base-directory', $taskWork,
    '--input-directory', $taskInput,
    '--output-directory', $taskOutput,
    '--temp-directory', $taskTemp,
    '--user-directory', $taskUser,
    '--database-url', ('sqlite:///' + ((Join-Path $taskUser 'comfyui.db') -replace '\\', '/')),
    '--extra-model-paths-config', $taskConfig,
    '--disable-pinned-memory', '--disable-async-offload', '--disable-auto-launch', '--disable-api-nodes',
    '--disable-all-custom-nodes', '--whitelist-custom-nodes',
    'ComfyUI_IPAdapter_plus', 'comfyui_controlnet_aux'
)
if ($CoexistIfIdle) {
    # This installed version has no --normalvram flag; NORMAL_VRAM is default.
    # Keep smart memory management on to avoid unnecessary model offloads.
    # Pose stays on CPU; VAE uses GPU tiled decoding after a CPU native crash.
    $taskArguments += @('--disable-dynamic-vram', '--reserve-vram', '2')
}

$taskListening = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
$taskBlockers = @()
$taskCoexistEvidence = @()
if (@($taskListening | Where-Object { $_.Port -eq $Port }).Count) {
    $taskBlockers += "Port $Port is already in use. The launcher will not replace that process."
}
if ($Port -ne 8188 -and @($taskListening | Where-Object { $_.Port -eq 8188 }).Count) {
    if (-not $CoexistIfIdle) {
        $taskBlockers += 'Port 8188 is running. Use -CoexistIfIdle to request a checked concurrent launch without changing that service.'
    } else {
        try {
            for ($taskSample = 0; $taskSample -lt 2; $taskSample++) {
                if ($taskSample -gt 0) { Start-Sleep -Seconds 2 }
                $taskExistingQueue = Invoke-RestMethod -Uri 'http://127.0.0.1:8188/queue' -TimeoutSec 10
                $taskExistingStats = Invoke-RestMethod -Uri 'http://127.0.0.1:8188/system_stats' -TimeoutSec 10
                $taskGpuCsv = & nvidia-smi '--id=0' '--query-gpu=memory.free,utilization.gpu' '--format=csv,noheader,nounits'
                if ($LASTEXITCODE -ne 0) { throw 'Could not read current GPU activity.' }
                $taskGpuFields = ([string]$taskGpuCsv).Split(',')
                if ($taskGpuFields.Count -ne 2) { throw 'Unexpected GPU status response.' }
                $taskGpuFreeMiB = [double]::Parse($taskGpuFields[0].Trim(), [Globalization.CultureInfo]::InvariantCulture)
                $taskGpuUtilization = [double]::Parse($taskGpuFields[1].Trim(), [Globalization.CultureInfo]::InvariantCulture)
                $taskRunning = @($taskExistingQueue.queue_running).Count
                $taskPending = @($taskExistingQueue.queue_pending).Count
                $taskCoexistEvidence += [ordered]@{
                    checked_at = [DateTimeOffset]::Now.ToString('o')
                    running = $taskRunning
                    pending = $taskPending
                    gpu_free_mib = $taskGpuFreeMiB
                    gpu_utilization_percent = $taskGpuUtilization
                    existing_api_free_bytes = $taskExistingStats.devices[0].vram_free
                    ram_free_bytes = $taskExistingStats.system.ram_free
                }
                if ($taskRunning -gt 0 -or $taskPending -gt 0) { throw 'The existing 8188 queue is not idle.' }
                if ($taskGpuUtilization -gt 20) { throw 'GPU activity is above the idle launch threshold (20%).' }
                if ($taskGpuFreeMiB -lt 4096 -or $taskExistingStats.devices[0].vram_free -lt 4GB) {
                    throw 'Less than 4 GiB VRAM is available for the checked concurrent launch.'
                }
                if ($taskExistingStats.system.ram_free -lt 8GB) { throw 'Less than 8 GiB system RAM is available for CPU offload.' }
            }
        } catch {
            $taskBlockers += "Coexistence preflight failed: $($_.Exception.Message)"
        }
    }
}

$taskPlan = [ordered]@{
    started = $false
    project = $taskProject
    python = $taskPython
    arguments = $taskArguments
    environment = $taskEnvironment
    browser_url = "http://127.0.0.1:$Port"
    output = $taskOutput
    stdout_log = (Join-Path $taskLogs 'comfyui.stdout.log')
    stderr_log = (Join-Path $taskLogs 'comfyui.stderr.log')
    blockers = $taskBlockers
    shared_configuration_modified = $false
    downloads_enabled = $false
    coexist_if_idle = [bool]$CoexistIfIdle
    coexistence_preflight = $taskCoexistEvidence
    coexistence_limits = 'Start-time checks only; separate services do not coordinate future jobs. Use one image per batch and recheck 8188 before submitting.'
}

$taskPreviousEnvironment = @{}
try {
    foreach ($taskEntry in $taskEnvironment.GetEnumerator()) {
        $taskPreviousEnvironment[$taskEntry.Key] = [Environment]::GetEnvironmentVariable($taskEntry.Key, 'Process')
        [Environment]::SetEnvironmentVariable($taskEntry.Key, $taskEntry.Value, 'Process')
    }
    if ($CheckOnly) {
        # argparse exits before ComfyUI imports torch, initializes CUDA, or starts
        # the server; this checks actual installed CLI compatibility only.
        $taskHelp = & $taskPython @taskArguments '--help' 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Installed ComfyUI rejected its launch arguments: $taskHelp" }
        [IO.File]::WriteAllLines((Join-Path $taskLogs 'validated-cli-help.txt'), [string[]]$taskHelp, [Text.UTF8Encoding]::new($false))
        $taskPlan['cli_help_validation'] = 'passed'
    } else {
        if ($taskBlockers.Count) { throw ($taskBlockers -join "`n") }
        # Start-Process joins its argument list; quote paths explicitly for Windows.
        $taskQuotedArguments = $taskArguments | ForEach-Object {
            if ($_ -match '[\s"]') { '"' + $_.Replace('"', '\"') + '"' } else { $_ }
        }
        $taskProcess = Start-Process -FilePath $taskPython -ArgumentList $taskQuotedArguments -WorkingDirectory $taskWork `
            -WindowStyle Hidden -RedirectStandardOutput $taskPlan.stdout_log -RedirectStandardError $taskPlan.stderr_log -PassThru
        $taskPlan['started'] = $true
        $taskPlan['process_id'] = $taskProcess.Id
    }
} finally {
    foreach ($taskEntry in $taskPreviousEnvironment.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($taskEntry.Key, $taskEntry.Value, 'Process')
    }
}

$taskPlanJson = $taskPlan | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText((Join-Path $taskWork 'launch-plan.json'), $taskPlanJson + "`n", [Text.UTF8Encoding]::new($false))
$taskPlanJson
