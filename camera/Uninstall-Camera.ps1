#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$target = Join-Path $env:ProgramFiles 'Ultracam Virtual Camera'
# Do not unregister another installation that may have replaced this one.
foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)) {
 $hive=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::ClassesRoot,$view)
 try {
  foreach ($id in @('{5c2cd55c-92ad-4999-8666-912bd3e70010}','{5c2cd55c-92ad-4999-8666-912bd3e70020}')) {
   $key=$hive.OpenSubKey("CLSID\$id\InprocServer32")
   if($key) { try { $existing=[string]$key.GetValue(''); if($existing -and -not $existing.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Une autre installation UnityCapture est active. Aucune desinscription effectuee.' } } finally {$key.Dispose()} }
  }
 } finally {$hive.Dispose()}
}
foreach ($item in @(@{ Tool = "$env:WINDIR\System32\regsvr32.exe"; Dll = 'UnityCaptureFilter64.dll' },@{ Tool = "$env:WINDIR\SysWOW64\regsvr32.exe"; Dll = 'UnityCaptureFilter32.dll' })) {
 $dll=Join-Path $target $item.Dll
 if(Test-Path $dll) {
  $proc=Start-Process $item.Tool -ArgumentList @('/u','/s',('"'+$dll+'"')) -Wait -PassThru
  if($proc.ExitCode -ne 0) { throw "Echec de desinstallation : $($item.Dll)" }
 }
}
Get-NetFirewallRule -Name 'UltracamStudioLocal' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Write-Host 'Camera desinscrite. Les fichiers du composant sont conserves dans Program Files.'
