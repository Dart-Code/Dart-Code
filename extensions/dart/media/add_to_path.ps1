# Add-Path helper adapter from https://stackoverflow.com/a/69239861
param(
	[Parameter(Mandatory, Position = 0)]
	[string] $LiteralPath
)

Set-StrictMode -Version 1; $ErrorActionPreference = 'Stop'

$regPath = 'registry::HKEY_CURRENT_USER\Environment'

# Note the use of the .GetValue() method to ensure that the *unexpanded* value is returned.
$currDirs = (Get-Item -LiteralPath $regPath).GetValue('Path', '', 'DoNotExpandEnvironmentNames') -split ';' -ne ''

if ($LiteralPath -in $currDirs) {
	Write-Host "Already present in the persistent user-level Path: $LiteralPath"
	exit 12345;
}

$newValue = ($currDirs + $LiteralPath) -join ';'

# Update the registry.
Set-ItemProperty -Type ExpandString -LiteralPath $regPath Path $newValue

# Broadcast WM_SETTINGCHANGE to get the Windows shell to reload the
# updated environment, via a dummy [Environment]::SetEnvironmentVariable() operation.
$dummyName = [guid]::NewGuid().ToString()
[Environment]::SetEnvironmentVariable($dummyName, 'foo', 'User')
[Environment]::SetEnvironmentVariable($dummyName, [NullString]::value, 'User')

Write-Host "Added successfully:  $LiteralPath"
exit 0;
