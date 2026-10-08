# BOOFVIZ: what the music player (Spotify first) tells Windows (its media session, SMTC),
# as one JSON line per change on stdout, plus a heartbeat every 2 s.
# Started by src/main/smtc.ts with Windows PowerShell 5.1:
#   powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File smtc.ps1 -ParentPid <pid>
# Keep this file plain ASCII: PowerShell 5.1 reads BOM-less scripts in the ANSI code page.
param([int]$ParentPid = 0)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }

function NowMs { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }

# Compressed JSON with every non-ASCII character escaped (\uXXXX), so the console code page can't garble titles.
function Emit($o) {
  $json = ConvertTo-Json -InputObject $o -Compress
  $sb = New-Object System.Text.StringBuilder
  foreach ($c in $json.ToCharArray()) {
    if ([int]$c -lt 128) { [void]$sb.Append($c) } else { [void]$sb.Append([char]92).Append('u').Append(([int]$c).ToString('x4')) }
  }
  [Console]::Out.WriteLine($sb.ToString())
  [Console]::Out.Flush()
}

function Fail($message, [bool]$fatal) {
  Emit ([ordered]@{ ok = $false; fatal = $fatal; error = "$message"; sampleEpochMs = (NowMs) })
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  # WindowsRuntimeSystemExtensions.AsTask<TResult>(IAsyncOperation<TResult>): await WinRT calls as .NET tasks.
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
  $awaitProps = $asTask.MakeGenericMethod($propsType)
  $task = $asTask.MakeGenericMethod($managerType).Invoke($null, @($managerType::RequestAsync()))
  if (-not $task.Wait(10000)) { throw 'RequestAsync timed out' }
  $manager = $task.Result
  if ($null -eq $manager) { throw 'no session manager' }
} catch {
  # No WinRT media sessions here (older Windows, or blocked): BOOFVIZ falls back to the Web API.
  Fail $_ $true
  exit 2
}

# Album art: the cover the app hands Windows (the one in the volume flyout). Optional: without it, covers come from the Web API.
$artOk = $true
try {
  $streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $awaitStream = $asTask.MakeGenericMethod($streamType)
} catch { $artOk = $false }

# The cover as a data: URL, or $null.
function ReadArt($ref) {
  $t = $awaitStream.Invoke($null, @($ref.OpenReadAsync()))
  if (-not $t.Wait(3000)) { return $null }
  $ras = $t.Result
  if ($null -eq $ras -or $ras.Size -le 0 -or $ras.Size -gt 2000000) { return $null }
  $type = "$($ras.ContentType)"
  if ($type -notmatch '^image/[a-z+.-]+$') { $type = 'image/jpeg' }
  $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($ras)
  $ms = New-Object System.IO.MemoryStream
  $net.CopyTo($ms)
  $net.Dispose()
  $bytes = $ms.ToArray()
  if ($bytes.Length -eq 0) { return $null }
  return "data:$type;base64," + [Convert]::ToBase64String($bytes)
}

# Quit with BOOFVIZ, even if it never got to kill us.
$parent = $null
if ($ParentPid -gt 0) {
  try { $parent = [System.Diagnostics.Process]::GetProcessById($ParentPid) } catch { exit 0 }
}

$last = ''
$lastEmit = 0
$errors = 0
$cmdTask = $null
try { $cmdTask = [Console]::In.ReadLineAsync() } catch { $cmdTask = $null }
$artKey = ''
$artLoops = 0
$artDone = $false
$artNew = $false
$art = $null
while ($true) {
  if ($null -ne $parent) {
    $gone = $false
    try { $gone = $parent.HasExited } catch { $parent = $null }
    if ($gone) { exit 0 }
  }
  $o = [ordered]@{ ok = $true; app = $null; title = ''; artist = ''; album = ''; status = 'closed'; positionMs = $null; startMs = $null; endMs = $null; updatedEpochMs = $null }
  $failed = $false
  try {
    # Spotify first; another player (a browser, TIDAL, Apple Music...) when it is the one playing.
    $spot = $null
    foreach ($s in $manager.GetSessions()) {
      # -match is case-insensitive: Spotify.exe, or the Store app's SpotifyAB.SpotifyMusic_...!Spotify
      if ("$($s.SourceAppUserModelId)" -match 'spotify') { $spot = $s; break }
    }
    $cur = $null
    try { $cur = $manager.GetCurrentSession() } catch { }
    $session = $spot
    if ($null -ne $cur -and ($null -eq $spot -or ("$($spot.GetPlaybackInfo().PlaybackStatus)" -ne 'Playing' -and "$($cur.GetPlaybackInfo().PlaybackStatus)" -eq 'Playing'))) { $session = $cur }
    # Playback commands from BOOFVIZ, one per line on stdin.
    if ($null -ne $cmdTask -and $cmdTask.IsCompleted) {
      $line = $null
      try { $line = $cmdTask.Result } catch { }
      if ($null -eq $line) { $cmdTask = $null } else { $cmdTask = [Console]::In.ReadLineAsync() }
      if ($null -ne $session -and $null -ne $line) {
        switch ("$line".Trim()) {
          'play' { [void]$session.TryPlayAsync() }
          'pause' { [void]$session.TryPauseAsync() }
          'next' { [void]$session.TrySkipNextAsync() }
          'previous' { [void]$session.TrySkipPreviousAsync() }
        }
      }
    }
    if ($null -ne $session) {
      $o.app = "$($session.SourceAppUserModelId)"
      # Playing, Paused, Stopped, Closed, Opened or Changing.
      $o.status = "$($session.GetPlaybackInfo().PlaybackStatus)".ToLowerInvariant()
      $task = $awaitProps.Invoke($null, @($session.TryGetMediaPropertiesAsync()))
      if (-not $task.Wait(3000)) { throw 'media properties timed out' }
      $p = $task.Result
      if ($null -ne $p) {
        $o.title = "$($p.Title)"
        $o.artist = "$($p.Artist)"
        $o.album = "$($p.AlbumTitle)"
        # Read the cover once per song, a moment after it shows (apps can update it just after the title), retrying a few times.
        $key = "$($o.title)|$($o.artist)|$($o.album)"
        if ($key -ne $artKey) { $artKey = $key; $artLoops = 0; $artDone = $false }
        $artLoops++
        if ($artOk -and -not $artDone -and $artLoops -ge 3 -and $artLoops -le 20 -and $o.status -ne 'changing' -and $null -ne $p.Thumbnail) {
          try {
            $a = ReadArt $p.Thumbnail
            if ($a) { $art = $a; $artDone = $true; $artNew = $true }
          } catch { }
        }
      }
      # Position at LastUpdatedTime; apps update it on play, pause and seek (not continuously).
      $t = $session.GetTimelineProperties()
      if ($null -ne $t -and $t.EndTime.Ticks -gt 0 -and $t.LastUpdatedTime.Year -ge 2000) {
        $o.positionMs = [long]$t.Position.TotalMilliseconds
        $o.startMs = [long]$t.StartTime.TotalMilliseconds
        $o.endMs = [long]$t.EndTime.TotalMilliseconds
        $o.updatedEpochMs = $t.LastUpdatedTime.ToUnixTimeMilliseconds()
      }
    }
    $errors = 0
  } catch {
    # Usually the session closing mid-read: try again next time round.
    $failed = $true
    $errors++
  }
  $now = NowMs
  if ($failed) {
    # Still failing after a few seconds: quit, and BOOFVIZ starts a fresh reader.
    if ($errors -ge 10) {
      Fail 'media session unreadable' $false
      exit 1
    }
  } else {
    $json = ConvertTo-Json -InputObject $o -Compress
    if ($json -ne $last -or $now - $lastEmit -ge 2000 -or $artNew) {
      $last = $json
      $lastEmit = $now
      $o.sampleEpochMs = $now
      # The cover rides along once, on the sample after it was read.
      if ($artNew) { $o.art = $art; $artNew = $false }
      Emit $o
    }
  }
  $sleep = 1000
  if ($o.app) { $sleep = 300 }
  Start-Sleep -Milliseconds $sleep
}
