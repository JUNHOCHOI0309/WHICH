$ErrorActionPreference = "Stop"

$node = (Get-Command node).Source
$server = Join-Path $PSScriptRoot "local-renderer.mjs"
$taskName = "WHICH HyperFrames Renderer"
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$server`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 0) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Local renderer for WHICH Marketing Studio" -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output "Installed: $taskName"
