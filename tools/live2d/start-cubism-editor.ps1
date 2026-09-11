[CmdletBinding()]
param(
    [switch]$CheckOnly,
    [string]$PsdPath,
    [ValidateRange(1024, 32768)]
    [int]$MemoryMB = 4096
)

$ErrorActionPreference = 'Stop'
$taskProject = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')).TrimEnd('\')
$taskExpectedProject = 'G:\WBSpace\AIDebate'
$taskEditor = 'G:\Tools\Live2D\CubismEditor-5.3.04'
if (-not $taskProject.Equals($taskExpectedProject, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Run the launcher from its intended project: $taskExpectedProject"
}

function Assert-ProjectDirectory {
    param([string]$Directory)
    $taskFullDirectory = [IO.Path]::GetFullPath($Directory).TrimEnd('\')
    if (-not $taskFullDirectory.StartsWith($taskProject + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Task files must remain inside the G: project: $taskFullDirectory"
    }
    # A junction inside the project could otherwise send task files to C:.
    $taskAncestor = $taskFullDirectory
    while ($taskAncestor -and $taskAncestor.Length -ge $taskProject.Length) {
        if (Test-Path -LiteralPath $taskAncestor) {
            $taskItem = Get-Item -LiteralPath $taskAncestor -Force
            if (-not $taskItem.PSIsContainer) { throw "Expected a directory: $taskAncestor" }
            if ($taskItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Task storage must not pass through a junction or symbolic link: $taskAncestor"
            }
        }
        $taskAncestor = [IO.Path]::GetDirectoryName($taskAncestor)
    }
}

function ConvertTo-WindowsArgument {
    param([AllowEmptyString()][string]$Value)
    if ($Value -notmatch '[\s"]' -and $Value.Length -gt 0) { return $Value }
    # Escape quotes and trailing backslashes according to Windows argv rules.
    $taskQuoted = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $taskQuoted = [regex]::Replace($taskQuoted, '(\\+)$', '$1$1')
    return '"' + $taskQuoted + '"'
}

$taskProfile = Join-Path $taskProject 'work\live2d\editor-profile'
$taskTemp = Join-Path $taskProfile 'temp'
$taskDocuments = Join-Path $taskProfile 'Documents'
$taskDesktop = Join-Path $taskProfile 'Desktop'
$taskRecent = Join-Path $taskProfile 'AppData\Roaming\Microsoft\Windows\Recent'
$taskLogs = Join-Path $taskProject 'work\live2d\logs'
$taskJava = Join-Path $taskEditor 'app\jre\bin\java.exe'
$taskJavaw = Join-Path $taskEditor 'app\jre\bin\javaw.exe'
$taskOriginalLauncher = Join-Path $taskEditor 'CubismEditor5.bat'
$taskMainClass = 'com.live2d.cubism.CECubismEditorApp'

foreach ($taskRequired in @($taskJava, $taskJavaw, $taskOriginalLauncher)) {
    if (-not (Test-Path -LiteralPath $taskRequired -PathType Leaf)) {
        throw "Required original Cubism file was not found: $taskRequired"
    }
}

# Read the official launcher as data; do not execute or alter it.
$taskOriginalText = Get-Content -LiteralPath $taskOriginalLauncher -Raw
$taskClasspathMatch = [regex]::Match($taskOriginalText, '(?m)^set CLASS_PATH=([^\r\n]+)')
$taskNativeMatch = [regex]::Match($taskOriginalText, '(?m)^set NATIVE_PATH=([^\r\n]+)')
if (-not $taskClasspathMatch.Success -or -not $taskNativeMatch.Success -or
    -not $taskOriginalText.Contains($taskMainClass)) {
    throw 'The original Cubism launcher does not contain the expected Java configuration.'
}

$taskJars = @($taskClasspathMatch.Groups[1].Value.Trim().Split(';') | ForEach-Object {
    $taskFile = [IO.Path]::GetFullPath((Join-Path $taskEditor $_))
    if (-not $taskFile.StartsWith($taskEditor + '\', [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $taskFile -PathType Leaf)) {
        throw "Invalid or missing original Cubism classpath entry: $taskFile"
    }
    $taskFile
})
$taskNativeDirectories = @($taskNativeMatch.Groups[1].Value.Trim().Split(';') | ForEach-Object {
    $taskDirectory = [IO.Path]::GetFullPath((Join-Path $taskEditor $_))
    if (-not $taskDirectory.StartsWith($taskEditor + '\', [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $taskDirectory -PathType Container)) {
        throw "Invalid or missing original Cubism native directory: $taskDirectory"
    }
    $taskDirectory
})

$taskResolvedPsd = $null
if ($PsdPath) {
    if ([IO.Path]::IsPathRooted($PsdPath)) {
        $taskResolvedPsd = [IO.Path]::GetFullPath($PsdPath)
    } else {
        $taskResolvedPsd = [IO.Path]::GetFullPath((Join-Path $taskProject $PsdPath))
    }
    Assert-ProjectDirectory ([IO.Path]::GetDirectoryName($taskResolvedPsd))
    if ([IO.Path]::GetExtension($taskResolvedPsd) -ine '.psd' -or
        -not (Test-Path -LiteralPath $taskResolvedPsd -PathType Leaf)) {
        throw "PsdPath must be an existing PSD inside this project: $taskResolvedPsd"
    }
    if ((Get-Item -LiteralPath $taskResolvedPsd -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "PsdPath must not be a symbolic link: $taskResolvedPsd"
    }
}

$taskEnvironment = [ordered]@{
    APPDATA = (Join-Path $taskProfile 'AppData\Roaming')
    LOCALAPPDATA = (Join-Path $taskProfile 'AppData\Local')
    USERPROFILE = $taskProfile
    HOMEDRIVE = 'G:'
    HOMEPATH = $taskProfile.Substring(2)
    TEMP = $taskTemp
    TMP = $taskTemp
    TMPDIR = $taskTemp
    XDG_CACHE_HOME = (Join-Path $taskProfile 'AppData\Local\cache')
    XDG_CONFIG_HOME = (Join-Path $taskProfile 'AppData\Roaming')
}
# Windows expands its Shell Folder paths against USERPROFILE. Swing needs an
# existing Desktop before its first shell lookup; creating it later can leave a
# failed shell lookup cached in the running Editor.
foreach ($taskDirectory in @($taskProfile, $taskTemp, $taskDocuments, $taskDesktop, $taskRecent, $taskLogs,
    $taskEnvironment.APPDATA, $taskEnvironment.LOCALAPPDATA, $taskEnvironment.XDG_CACHE_HOME)) {
    Assert-ProjectDirectory $taskDirectory
    New-Item -ItemType Directory -Path $taskDirectory -Force | Out-Null
}

$taskStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$taskStdout = Join-Path $taskLogs "cubism-editor-$taskStamp.stdout.log"
$taskStderr = Join-Path $taskLogs "cubism-editor-$taskStamp.stderr.log"
$taskArguments = @(
    '-classpath', ($taskJars -join ';'),
    "-Djava.library.path=$($taskNativeDirectories -join ';')",
    "-Duser.home=$taskProfile",
    "-Djava.io.tmpdir=$taskTemp",
    "-Djna.tmpdir=$taskTemp",
    '-Djogamp.gluegen.UseTempJarCache=false',
    '-Dsun.java2d.d3d=false',
    '-Duser.language=en',
    '-Djava.locale.providers=COMPAT,SPI',
    '-XX:-UsePerfData',
    "-XX:ErrorFile=$taskLogs\cubism-jvm-error-%p.log",
    "-XX:HeapDumpPath=$taskLogs",
    "-Xmx${MemoryMB}m",
    '-showversion',
    $taskMainClass
)
if ($taskResolvedPsd) { $taskArguments += $taskResolvedPsd }

# Serialize launch checks so two callers cannot both pass the process check.
$taskMutex = New-Object Threading.Mutex($false, 'Local\AIDebate-CubismEditor-G-Launcher')
$taskMutexHeld = $false
$taskPreviousEnvironment = @{}
$taskRemovedJavaOptions = @{}
try {
    try { $taskMutexHeld = $taskMutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $taskMutexHeld = $true }
    if (-not $taskMutexHeld) { throw 'Another Cubism launch check is in progress.' }

    # Fail closed if process inspection is unavailable; never kill an existing Editor.
    $taskCandidates = @(Get-CimInstance -ClassName Win32_Process -Filter `
        "Name='java.exe' OR Name='javaw.exe' OR Name='CubismEditor5.exe'" -ErrorAction Stop)
    $taskExisting = @($taskCandidates | Where-Object {
        ($_.CommandLine -and $_.CommandLine.Contains($taskMainClass)) -or
        ($_.Name -eq 'CubismEditor5.exe') -or
        (-not $_.CommandLine -and $_.ExecutablePath -and
            $_.ExecutablePath.StartsWith($taskEditor + '\', [StringComparison]::OrdinalIgnoreCase))
    } | Select-Object ProcessId, Name, ExecutablePath)

    $taskPlan = [ordered]@{
        started = $false
        check_only = [bool]$CheckOnly
        project = $taskProject
        editor = $taskEditor
        executable = $taskJavaw
        working_directory = $taskEditor
        original_launcher = $taskOriginalLauncher
        classpath_entries_verified = $taskJars.Count
        profile = $taskProfile
        documents = $taskDocuments
        desktop = $taskDesktop
        recent = $taskRecent
        psd = $taskResolvedPsd
        environment = $taskEnvironment
        arguments = $taskArguments
        stdout_log = $taskStdout
        stderr_log = $taskStderr
        existing_editor_processes = $taskExisting
        original_editor_files_modified = $false
    }
    foreach ($taskEntry in $taskEnvironment.GetEnumerator()) {
        $taskPreviousEnvironment[$taskEntry.Key] = [Environment]::GetEnvironmentVariable($taskEntry.Key, 'Process')
        [Environment]::SetEnvironmentVariable($taskEntry.Key, $taskEntry.Value, 'Process')
    }
    # Inherited Java options could silently override our storage settings.
    foreach ($taskOptionName in @('JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS')) {
        $taskRemovedJavaOptions[$taskOptionName] = [Environment]::GetEnvironmentVariable($taskOptionName, 'Process')
        [Environment]::SetEnvironmentVariable($taskOptionName, $null, 'Process')
    }
    $taskPreviousEnvironment['PATH'] = [Environment]::GetEnvironmentVariable('PATH', 'Process')
    [Environment]::SetEnvironmentVariable('PATH',
        (($taskNativeDirectories -join ';') + ';' + $taskPreviousEnvironment['PATH']), 'Process')

    if ($CheckOnly) {
        # Validate the bundled JVM and its effective paths without loading Cubism.
        $taskProbeArguments = @('-XX:-UsePerfData', "-Duser.home=$taskProfile",
            "-Djava.io.tmpdir=$taskTemp", "-Djna.tmpdir=$taskTemp", '-XshowSettings:properties', '-version')
        $taskProbeOut = Join-Path $taskLogs "cubism-jvm-check-$taskStamp.stdout.log"
        $taskProbeErr = Join-Path $taskLogs "cubism-jvm-check-$taskStamp.stderr.log"
        $taskProbe = Start-Process -FilePath $taskJava -ArgumentList `
            (($taskProbeArguments | ForEach-Object { ConvertTo-WindowsArgument $_ }) -join ' ') `
            -WorkingDirectory $taskEditor -WindowStyle Hidden -RedirectStandardOutput $taskProbeOut `
            -RedirectStandardError $taskProbeErr -Wait -PassThru
        if ($taskProbe.ExitCode -ne 0) { throw "Bundled JVM validation failed. Read $taskProbeErr" }
        $taskProbeText = Get-Content -LiteralPath $taskProbeErr -Raw
        foreach ($taskProperty in @("user.home = $taskProfile", "java.io.tmpdir = $taskTemp", "jna.tmpdir = $taskTemp")) {
            if (-not $taskProbeText.Contains($taskProperty)) {
                throw "Bundled JVM did not confirm the requested G: setting: $taskProperty"
            }
        }
        $taskPlan['jvm_validation'] = 'passed'
        $taskPlan['jvm_validation_log'] = $taskProbeErr
        $taskPlan['ready_to_start'] = ($taskExisting.Count -eq 0)
    } else {
        if ($taskExisting.Count -gt 0) {
            throw "Cubism Editor is already running (PID: $($taskExisting.ProcessId -join ', ')). Close it before launching another instance."
        }
        $taskProcess = Start-Process -FilePath $taskJavaw -ArgumentList `
            (($taskArguments | ForEach-Object { ConvertTo-WindowsArgument $_ }) -join ' ') `
            -WorkingDirectory $taskEditor -WindowStyle Hidden -RedirectStandardOutput $taskStdout `
            -RedirectStandardError $taskStderr -PassThru
        $taskPlan['started'] = $true
        $taskPlan['process_id'] = $taskProcess.Id
        $taskPlan['started_at'] = (Get-Date).ToString('o')
    }

    $taskPlanJson = $taskPlan | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText((Join-Path $taskLogs "cubism-launch-$taskStamp.json"),
        $taskPlanJson + "`n", [Text.UTF8Encoding]::new($false))
    $taskPlanJson
} finally {
    foreach ($taskEntry in $taskPreviousEnvironment.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($taskEntry.Key, $taskEntry.Value, 'Process')
    }
    foreach ($taskEntry in $taskRemovedJavaOptions.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($taskEntry.Key, $taskEntry.Value, 'Process')
    }
    if ($taskMutexHeld) { $taskMutex.ReleaseMutex() }
    $taskMutex.Dispose()
}
