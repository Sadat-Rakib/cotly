$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'wrangler|workerd' }
foreach ($p in $procs) {
  Write-Output ("killing {0}: {1}" -f $p.ProcessId, $p.Name)
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2
$left = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 8787,8788,8789 }
if ($left) { $left | ForEach-Object { Write-Output ("still listening: port {0} pid {1}" -f $_.LocalPort, $_.OwningProcess) } }
else { Write-Output "ports 8787-8789 free" }
