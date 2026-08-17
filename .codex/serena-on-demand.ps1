[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('on', 'off', 'status')]
    [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'
$ConfigPath = Join-Path $PSScriptRoot 'config.toml'
$ProjectPath = Split-Path -Parent $PSScriptRoot
$HostAddress = '127.0.0.1'
$Port = 9121

function Set-SerenaEnabled {
    param([bool]$Enabled)

    $content = [System.IO.File]::ReadAllText($ConfigPath)
    $pattern = [regex]::new('(?m)^enabled\s*=\s*(?:true|false)\s*$')
    if (-not $pattern.IsMatch($content)) {
        throw "No enabled setting was found in $ConfigPath"
    }

    $value = if ($Enabled) { 'true' } else { 'false' }
    $updated = $pattern.Replace($content, "enabled = $value", 1)
    [System.IO.File]::WriteAllText($ConfigPath, $updated, [System.Text.UTF8Encoding]::new($false))
}

function Test-SerenaListening {
    return $null -ne (Get-NetTCPConnection -State Listen -LocalAddress $HostAddress -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Get-SerenaHostProcesses {
    $escapedProject = [regex]::Escape($ProjectPath)
    Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'serena.exe' -and
        $_.CommandLine -and
        $_.CommandLine -match '(?i)start-mcp-server' -and
        $_.CommandLine -match '(?i)streamable-http' -and
        $_.CommandLine -match "(?i)--port(?:=|\s+)$Port(?:\s|$)" -and
        $_.CommandLine -match $escapedProject
    }
}

function Stop-ProcessTree {
    param([int[]]$RootIds)

    $all = @(Get-CimInstance Win32_Process)
    $selected = [System.Collections.Generic.HashSet[int]]::new()
    foreach ($rootId in $RootIds) {
        [void]$selected.Add($rootId)
    }

    do {
        $added = $false
        foreach ($process in $all) {
            if ($selected.Contains([int]$process.ParentProcessId) -and -not $selected.Contains([int]$process.ProcessId)) {
                [void]$selected.Add([int]$process.ProcessId)
                $added = $true
            }
        }
    } while ($added)

    $ids = @($selected) | Sort-Object -Descending
    if ($ids.Count -gt 0) {
        Stop-Process -Id $ids -Force -ErrorAction SilentlyContinue
    }
}

switch ($Action) {
    'on' {
        if (-not (Test-SerenaListening)) {
            $serenaCommand = Get-Command serena.exe -ErrorAction Stop
            $arguments = @(
                'start-mcp-server',
                '--transport', 'streamable-http',
                '--host', $HostAddress,
                '--port', "$Port",
                '--context', 'codex',
                '--project', $ProjectPath,
                '--enable-web-dashboard', 'false',
                '--open-web-dashboard', 'false'
            )
            Start-Process -FilePath $serenaCommand.Source -ArgumentList $arguments -WindowStyle Hidden

            $ready = $false
            for ($attempt = 0; $attempt -lt 100; $attempt++) {
                Start-Sleep -Milliseconds 100
                if (Test-SerenaListening) {
                    $ready = $true
                    break
                }
            }
            if (-not $ready) {
                Set-SerenaEnabled -Enabled $false
                throw "Serena did not start on http://${HostAddress}:$Port/mcp"
            }
        }

        Set-SerenaEnabled -Enabled $true
        Write-Output "Serena is ON at http://${HostAddress}:$Port/mcp"
        Write-Output 'Restart or reopen the Codex task that needs Serena so it reloads MCP configuration.'
    }

    'off' {
        Set-SerenaEnabled -Enabled $false
        $roots = @(Get-SerenaHostProcesses | ForEach-Object { [int]$_.ProcessId })
        Stop-ProcessTree -RootIds $roots
        Write-Output 'Serena is OFF. New Codex tasks will not start or connect to it.'
    }

    'status' {
        $enabledLine = Select-String -LiteralPath $ConfigPath -Pattern '^enabled\s*=\s*(true|false)\s*$' | Select-Object -First 1
        $configured = if ($enabledLine) { $enabledLine.Matches[0].Groups[1].Value } else { 'unknown' }
        $listening = Test-SerenaListening
        $processCount = @(Get-SerenaHostProcesses).Count
        Write-Output "Configured enabled: $configured"
        Write-Output "Listening: $listening"
        Write-Output "Shared Serena instances: $processCount"
        Write-Output "Endpoint: http://${HostAddress}:$Port/mcp"
    }
}
