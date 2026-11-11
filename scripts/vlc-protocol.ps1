param([string]$rawUrl)
if (-not $rawUrl) { exit }

# Remove vlc:// or vlc: prefix
$url = $rawUrl -replace '^vlc:/*', ''

# Correct scheme if browser stripped colon or slashed
if ($url -match '^http/([^/].*)') {
    $url = 'http://' + $matches[1]
} elseif ($url -match '^https/([^/].*)') {
    $url = 'https://' + $matches[1]
} elseif ($url -notmatch '^https?://') {
    $url = 'http://' + $url
}

# Locate VLC
$vlcPaths = @(
    "C:\Program Files\VideoLAN\VLC\vlc.exe",
    "C:\Program Files (x86)\VideoLAN\VLC\vlc.exe",
    "$env:LOCALAPPDATA\Programs\VLC\vlc.exe"
)

$targetVlc = $null
foreach ($path in $vlcPaths) {
    if (Test-Path $path) {
        $targetVlc = $path
        break
    }
}

if (-not $targetVlc) {
    $found = Get-Command vlc.exe -ErrorAction SilentlyContinue
    if ($found) {
        $targetVlc = $found.Source
    }
}

if ($targetVlc) {
    Start-Process $targetVlc -ArgumentList @($url)
}
