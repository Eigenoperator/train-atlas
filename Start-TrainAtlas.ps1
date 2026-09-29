$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$runtimeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$runtimePath = if ($runtimeCommand) { $runtimeCommand.Source } elseif (Test-Path -LiteralPath 'D:\nodejs\node.exe') { 'D:\nodejs\node.exe' } else { throw '请安装 Node.js 22.13 或更新版本，然后重新运行此脚本。' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\vinext\dist\cli.js'))) {
    throw '缺少项目依赖，请先在此目录运行 npm ci。'
}
Write-Host '铁路足迹：http://localhost:3001/  （按 Ctrl+C 停止服务）'
& $runtimePath (Join-Path $PSScriptRoot 'node_modules\vinext\dist\cli.js') dev --host 127.0.0.1 --port 3001
